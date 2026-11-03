import { headers } from 'next/headers';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware, APIError } from 'better-auth/api';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getDatabase, getPool } from '../db';
import type { Database } from '../db/database';
import * as schema from '../db/auth-schema';
import { readInvitation } from './invitations';
import { enqueueAuthEmail, getMailStatus } from './mail';

export function daybookAuth() {
  const config = process.env;
  if (!config.DATABASE_URL || !config.BETTER_AUTH_SECRET || !config.DAYBOOK_SITE_URL) throw new Error('La autenticación de Daybook aún no está configurada.');
  const database = getDatabase();
  return betterAuth({
    appName: 'Daybook Ticket', baseURL: config.DAYBOOK_SITE_URL, secret: config.BETTER_AUTH_SECRET,
    database: drizzleAdapter(drizzle(getPool(), { schema }), { provider: 'pg', schema, transaction: true }),
    trustedOrigins: [new URL(config.DAYBOOK_SITE_URL).origin],
    emailAndPassword: {
      enabled: true, minPasswordLength: 12, maxPasswordLength: 128, revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        const member = await database.prepare(`SELECT id,"ownerId" FROM members WHERE "userId"=$1 AND status='active'`).bind(user.id).first<{ id: string; ownerId: string }>();
        if (!member) return;
        if (!(await getMailStatus(member.ownerId)).configured) throw new APIError('SERVICE_UNAVAILABLE', { message: 'La recuperación por correo está pendiente de configuración. Contacta con tu administrador.' });
        await enqueueAuthEmail(database, member.ownerId, member.id, url);
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 50, customRules: { '/sign-in/email': { window: 60, max: 5 }, '/sign-up/email': { window: 60, max: 5 }, '/request-password-reset': { window: 300, max: 3 } } },
    // Vercel sets this header at its edge; never trust the old Sites/Cloudflare identity headers.
    advanced: { cookiePrefix: 'daybook', ipAddress: { ipAddressHeaders: ['x-vercel-forwarded-for'] } },
    hooks: { before: createAuthMiddleware(async ctx => {
      if (ctx.path === '/sign-up/email') {
        const invite = await readInvitation(database, ctx.headers?.get('x-daybook-invite') || '');
        if (!invite || String(ctx.body?.email || '').trim().toLowerCase() !== invite.email) {
          throw new APIError('FORBIDDEN', { message: 'Necesitas una invitación válida para crear tu cuenta.' });
        }
        // A failed account creation can leave a user row before its credential exists.
        // A still-valid invitation may retry after the old request has safely expired.
        await database.prepare(`DELETE FROM "authUser" WHERE email=$1 AND "createdAt"<$2 AND NOT EXISTS (SELECT 1 FROM "authAccount" WHERE "authAccount"."userId"="authUser".id) AND NOT EXISTS (SELECT 1 FROM "authSession" WHERE "authSession"."userId"="authUser".id)`)
          .bind(invite.email, new Date(Date.now() - 10 * 60 * 1000)).run();
        return { context: { body: { ...ctx.body, email: invite.email, name: invite.name } } };
      }
    }), after: createAuthMiddleware(async ctx => {
      if (ctx.path === '/sign-up/email' && ctx.context.newSession) {
        const user = ctx.context.newSession.user;
        await linkInvitedAccount(database, user.id, user.email);
      }
    }) },
    databaseHooks: { user: { create: {
      // Every account is created through an unexpired invitation sent or shared by an administrator.
      before: async user => ({ data: { ...user, emailVerified: true } }),
    } } },
  });
}

async function linkInvitedAccount(database: Database, userId: string, email: string) {
  await database.batch([
    database.prepare(`UPDATE members SET "userId"=$1,status='active',"updatedAt"=$2 WHERE email=$3 AND "userId" IS NULL AND status='invited' AND EXISTS(SELECT 1 FROM "authAccount" WHERE "userId"=$4 AND "providerId"='credential' AND password IS NOT NULL)`).bind(userId, new Date().toISOString(), email.toLowerCase(), userId),
    database.prepare('DELETE FROM invitations WHERE "memberId" IN (SELECT id FROM members WHERE "userId"=$1)').bind(userId),
  ]);
}

export async function getDaybookUser(request?: Request) {
  const session = await daybookAuth().api.getSession({ headers: request?.headers || await headers() });
  if (!session?.user.emailVerified) return null;
  // Recovers a completed sign-up if a transient failure happened during membership linking.
  await linkInvitedAccount(getDatabase(), session.user.id, session.user.email);
  return { userId: session.user.id, email: session.user.email, fullName: session.user.name, displayName: session.user.name || session.user.email };
}
