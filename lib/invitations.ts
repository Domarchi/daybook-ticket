import type { Database } from '../db/database';
import { ApiError } from './server';
import { acquireTicketWorkLock } from './work-lock';
import { lockWorkspaceState, assertWorkspaceOperational } from './workspaces';

export async function hashInvite(token: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('');
}
export async function prepareInvitation(database: Database, ownerId: string, memberId: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  const base = process.env.DAYBOOK_SITE_URL;
  if (!base) throw new Error('Falta DAYBOOK_SITE_URL.');
  const url = new URL('/login', base);
  url.searchParams.set('invite', token);
  const statement = database
    .prepare(
      'INSERT INTO invitations("memberId","ownerId","tokenHash","expiresAt","createdAt") VALUES($1,$2,$3,$4,$5) ON CONFLICT("memberId") DO UPDATE SET "tokenHash"=excluded."tokenHash","expiresAt"=excluded."expiresAt","createdAt"=excluded."createdAt","acceptedAt"=NULL,"acceptedUserId"=NULL',
    )
    .bind(memberId, ownerId, await hashInvite(token), expiresAt, now);
  return { statement, url: url.href, expiresAt };
}
export async function readInvitation(database: Database, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return database
    .prepare(
      'SELECT m.id,m.email,m.name,m."ownerId",m."organizationId",EXISTS(SELECT 1 FROM "authUser" u WHERE u.email=m.email) AS "existingAccount" FROM invitations i JOIN members m ON m.id=i."memberId" AND m."ownerId"=i."ownerId" WHERE i."tokenHash"=$1 AND i."expiresAt">$2 AND i."acceptedAt" IS NULL AND m.status=\'invited\' AND m."userId" IS NULL',
    )
    .bind(await hashInvite(token), new Date().toISOString())
    .first<{
      id: string;
      email: string;
      name: string;
      ownerId: string;
      organizationId: string;
      existingAccount: boolean;
    }>();
}
/** Only the presented invitation is consumed, including when one identity has several pending invitations. */
export async function acceptInvitation(database: Database, token: string, user: { userId: string; email: string }) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new ApiError(400, 'La invitación no es válida.');
  const hash = await hashInvite(token);
  return database.transaction(async tx => {
    const target = (await tx.query('SELECT "ownerId" FROM invitations WHERE "tokenHash"=$1', [hash])).rows[0];
    if (!target) throw new ApiError(403, 'Inicia sesión con el correo de esta invitación.');
    await acquireTicketWorkLock(tx, target.ownerId);
    await lockWorkspaceState(tx, target.ownerId);
    await assertWorkspaceOperational(target.ownerId, tx, true);
    const invitation = (
      await tx.query(
        `SELECT i.*,m.email,m."organizationId",m.status,m."userId" FROM invitations i JOIN members m ON m.id=i."memberId" AND m."ownerId"=i."ownerId" WHERE i."tokenHash"=$1 FOR UPDATE OF i,m`,
        [hash],
      )
    ).rows[0];
    if (!invitation || invitation.email.toLowerCase() !== user.email.toLowerCase())
      throw new ApiError(403, 'Inicia sesión con el correo de esta invitación.');
    if (invitation.acceptedAt) {
      if (
        invitation.acceptedUserId !== user.userId ||
        invitation.userId !== user.userId ||
        invitation.status !== 'active'
      )
        throw new ApiError(409, 'La invitación ya no permite activar esta cuenta.');
      return { workspaceId: invitation.organizationId, accepted: true };
    }
    if (invitation.status !== 'invited' || invitation.userId || Date.parse(invitation.expiresAt) <= Date.now())
      throw new ApiError(409, 'La invitación venció o cambió. Solicita una nueva.');
    const identity = (
      await tx.query('SELECT id FROM "authUser" WHERE id=$1 AND email=$2 AND "emailVerified"=true', [
        user.userId,
        user.email.toLowerCase(),
      ])
    ).rows[0];
    if (!identity) throw new ApiError(403, 'Verifica tu identidad antes de aceptar.');
    const now = new Date().toISOString();
    await tx.query('UPDATE members SET "userId"=$1,status=\'active\',"updatedAt"=$2 WHERE id=$3', [
      user.userId,
      now,
      invitation.memberId,
    ]);
    await tx.query('UPDATE invitations SET "acceptedAt"=$1,"acceptedUserId"=$2 WHERE "tokenHash"=$3', [
      now,
      user.userId,
      hash,
    ]);
    return { workspaceId: invitation.organizationId, accepted: true };
  });
}
