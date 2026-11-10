import { headers } from 'next/headers';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware, APIError, getAuthoritativeSessionFromCtx } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getDatabase, getPool } from '../db';
import * as schema from '../db/auth-schema';
import { readInvitation, acceptInvitation } from './invitations';
import { enqueueAuthEmail, getMailStatus } from './mail';
import { safeAuthLogger } from './auth-logging';
import { recordAuthProof, readIdentitySecurity } from './security';
import { hasFreshProof } from './security-model';
import { successfulAuthProofs } from './auth-security-hooks';

export function daybookAuth() {
  const config = process.env;
  if (!config.DATABASE_URL || !config.BETTER_AUTH_SECRET || !config.DAYBOOK_SITE_URL)
    throw new Error('La autenticación de Daybook aún no está configurada.');
  const database = getDatabase();
  return betterAuth({
    appName: 'Daybook Ticket',
    baseURL: config.DAYBOOK_SITE_URL,
    secret: config.BETTER_AUTH_SECRET,
    logger: safeAuthLogger,
    database: drizzleAdapter(drizzle(getPool(), { schema }), { provider: 'pg', schema, transaction: true }),
    trustedOrigins: [new URL(config.DAYBOOK_SITE_URL).origin],
    plugins: [
      twoFactor({
        issuer: 'Daybook Ticket',
        skipVerificationOnEnable: false,
        twoFactorCookieMaxAge: 300,
        backupCodeOptions: { amount: 10, length: 12, storeBackupCodes: 'encrypted' },
        accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 900 },
      }),
    ],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        const member = await database
          .prepare(
            `SELECT id,"ownerId" FROM members WHERE "userId"=$1 ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END,CASE WHEN "organizationId"='daybook' THEN 0 ELSE 1 END,"organizationId",id LIMIT 1`,
          )
          .bind(user.id)
          .first<{ id: string; ownerId: string }>();
        if (!member) return;
        if (!(await getMailStatus('')).configured)
          throw new APIError('SERVICE_UNAVAILABLE', {
            message: 'La recuperación por correo está pendiente de configuración. Contacta con tu administrador.',
          });
        await enqueueAuthEmail(database, member.ownerId, member.id, url);
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 50,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 5 },
        '/request-password-reset': { window: 300, max: 3 },
        '/two-factor/*': { window: 60, max: 5 },
        '/verify-password': { window: 60, max: 5 },
      },
    },
    // Vercel sets this header at its edge; never trust the old Sites/Cloudflare identity headers.
    advanced: { cookiePrefix: 'daybook', ipAddress: { ipAddressHeaders: ['x-vercel-forwarded-for'] } },
    hooks: {
      before: createAuthMiddleware(async ctx => {
        if (ctx.path.startsWith('/two-factor/') && ctx.body?.trustDevice)
          throw new APIError('BAD_REQUEST', { message: 'Verifica el segundo factor en cada inicio de sesión.' });
        if (ctx.path === '/two-factor/enable' && ctx.body?.method && ctx.body.method !== 'totp')
          throw new APIError('BAD_REQUEST', { message: 'Usa una aplicación autenticadora.' });
        if (['/two-factor/disable', '/two-factor/generate-backup-codes', '/change-password'].includes(ctx.path)) {
          const current = await getAuthoritativeSessionFromCtx(ctx);
          if (!current) throw new APIError('UNAUTHORIZED', { message: 'Inicia sesión para continuar.' });
          const member = await database
            .prepare(
              `SELECT "ownerId" FROM members WHERE "userId"=$1 AND status='active' ORDER BY CASE WHEN "organizationId"='daybook' THEN 0 ELSE 1 END,id LIMIT 1`,
            )
            .bind(current.user.id)
            .first<{ ownerId: string }>();
          const state = await readIdentitySecurity({
            ownerId: member?.ownerId || '',
            userId: current.user.id,
            sessionId: current.session.id,
          });
          if (!hasFreshProof(state.proof, state.enabled))
            throw new APIError('FORBIDDEN', { message: 'Verifica tu identidad desde Seguridad antes de continuar.' });
          if (ctx.path === '/two-factor/disable') {
            const required = await database
              .prepare(
                `SELECT m.id FROM members m JOIN "securityPolicies" p ON p."ownerId"=m."ownerId" WHERE m."userId"=$1 AND m.status='active' AND m.role IN ('owner','admin','agent') AND p."requireStaffMfa"=true LIMIT 1`,
              )
              .bind(current.user.id)
              .first();
            if (required)
              throw new APIError('FORBIDDEN', {
                message:
                  'El equipo requiere doble factor. Conserva el autenticador o utiliza tus códigos de recuperación.',
              });
          }
        }
        if (ctx.path === '/sign-up/email') {
          const invite = await readInvitation(database, ctx.headers?.get('x-daybook-invite') || '');
          if (
            !invite ||
            String(ctx.body?.email || '')
              .trim()
              .toLowerCase() !== invite.email
          ) {
            throw new APIError('FORBIDDEN', { message: 'Necesitas una invitación válida para crear tu cuenta.' });
          }
          // A failed account creation can leave a user row before its credential exists.
          // A still-valid invitation may retry after the old request has safely expired.
          await database
            .prepare(
              `DELETE FROM "authUser" WHERE email=$1 AND "createdAt"<$2 AND NOT EXISTS (SELECT 1 FROM "authAccount" WHERE "authAccount"."userId"="authUser".id) AND NOT EXISTS (SELECT 1 FROM "authSession" WHERE "authSession"."userId"="authUser".id)`,
            )
            .bind(invite.email, new Date(Date.now() - 10 * 60 * 1000))
            .run();
          return { context: { body: { ...ctx.body, email: invite.email, name: invite.name } } };
        }
      }),
      after: createAuthMiddleware(async ctx => {
        const returned = ctx.context.returned as
          | {
              token?: unknown;
              user?: { id?: unknown; twoFactorEnabled?: unknown };
              backupCodes?: unknown;
              status?: unknown;
            }
          | undefined;
        const proofs = successfulAuthProofs({
          path: ctx.path,
          returned: ctx.context.returned,
          newSession: ctx.context.newSession,
        });
        for (const proof of proofs) await recordAuthProof(database, proof.token, proof.userId, proof.factor);
        const verified = proofs.find(proof => proof.factor === 'mfa');
        if (verified)
          await database
            .prepare(
              `INSERT INTO "securityAudit" (id,"ownerId","actorMemberId","actorUserId","actorName",action,"createdAt")
        SELECT gen_random_uuid()::text,"ownerId",id,"userId",name,'mfa_verified',$2 FROM members WHERE "userId"=$1 AND status='active'`,
            )
            .bind(verified.userId, new Date().toISOString())
            .run();
        if (
          (ctx.path === '/two-factor/generate-backup-codes' && Array.isArray(returned?.backupCodes)) ||
          (ctx.path === '/two-factor/disable' && returned?.status === true)
        ) {
          const current = ctx.context.newSession ?? ctx.context.session;
          if (current?.user.id) {
            await database.prepare('DELETE FROM "securityProfiles" WHERE "userId"=$1').bind(current.user.id).run();
            await database
              .prepare(
                `INSERT INTO "securityAudit" (id,"ownerId","actorMemberId","actorUserId","actorName",action,"createdAt")
            SELECT gen_random_uuid()::text,"ownerId",id,"userId",name,$2,$3 FROM members WHERE "userId"=$1 AND status='active'`,
              )
              .bind(
                current.user.id,
                ctx.path === '/two-factor/disable' ? 'mfa_disabled' : 'recovery_regenerated',
                new Date().toISOString(),
              )
              .run();
          }
        }
        if (ctx.path === '/sign-up/email' && ctx.context.newSession) {
          const user = ctx.context.newSession.user;
          await acceptInvitation(database, ctx.headers?.get('x-daybook-invite') || '', {
            userId: user.id,
            email: user.email,
          });
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // Every account is created through an unexpired invitation sent or shared by an administrator.
          before: async user => ({ data: { ...user, emailVerified: true } }),
        },
      },
    },
  });
}

export async function getDaybookUser(request?: Request) {
  const session = await daybookAuth().api.getSession({ headers: request?.headers || (await headers()) });
  if (!session?.user.emailVerified) return null;
  return {
    userId: session.user.id,
    sessionId: session.session.id,
    email: session.user.email,
    fullName: session.user.name,
    displayName: session.user.name || session.user.email,
  };
}
