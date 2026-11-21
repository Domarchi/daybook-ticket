import { randomBytes } from 'node:crypto';
import { checkMemberChange, requireAdmin, type AccessContext, type MemberRecord } from './access';
import {
  RESET_HASH_PREFIX,
  RESET_IDENTIFIER_PREFIX,
  RESET_LINK_HOURS,
  resetLinkProblem,
  resetLinkUrl,
  storedResetIdentifier,
} from './password-reset-model';
import { recordSecurityEvent } from './security';
import { ApiError, db } from './server';
import { lockAccess } from './ticket-mutations';
import { acquireTicketWorkLock } from './work-lock';
import { operatorGranted } from './workspace-model';

/**
 * Creates a password reset link for one active account of this workspace (Fase 7). Nothing changes until the person
 * opens it and saves a new password; then Better Auth closes all of their sessions. A new link replaces any earlier
 * one for the same account, including one requested by mail. The link is answered once and never stored in clear.
 */
export async function createPasswordResetLink(
  access: AccessContext,
  memberId: string,
): Promise<{ url: string; expiresAt: string; email: string }> {
  requireAdmin(access);
  const base = process.env.DAYBOOK_SITE_URL;
  if (!base) throw new Error('Falta DAYBOOK_SITE_URL.');
  return db().transaction(async tx => {
    await acquireTicketWorkLock(tx, access.ownerId);
    const fresh = requireAdmin(await lockAccess(tx, access));
    const member = (
      await tx.query<MemberRecord>(
        'SELECT * FROM members WHERE id=$1 AND "ownerId"=$2 AND "organizationId"=$3 FOR UPDATE',
        [memberId, fresh.ownerId, fresh.organizationId],
      )
    ).rows[0];
    if (!member) throw new ApiError(404, 'La cuenta no está disponible.');
    checkMemberChange(fresh, member, {});
    const otherMemberships = member.userId
      ? Number(
          (
            await tx.query<{ count: string }>(
              'SELECT count(*) AS count FROM members WHERE "userId"=$1 AND NOT ("ownerId"=$2 AND "organizationId"=$3)',
              [member.userId, fresh.ownerId, fresh.organizationId],
            )
          ).rows[0]?.count ?? 0,
        )
      : 0;
    const problem = resetLinkProblem(member, {
      otherMemberships,
      platformOperator: Boolean(member.userId && operatorGranted({ userId: member.userId })),
    });
    if (problem) throw new ApiError(409, problem);
    const userId = member.userId!;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + RESET_LINK_HOURS * 60 * 60 * 1000);
    const token = randomBytes(32).toString('hex');
    // Earlier links for this account stop working, hashed or (from before hashing) plain.
    await tx.query(`DELETE FROM "authVerification" WHERE value=$1 AND (identifier LIKE $2 OR identifier LIKE $3)`, [
      userId,
      `${RESET_IDENTIFIER_PREFIX}%`,
      `${RESET_HASH_PREFIX}%`,
    ]);
    await tx.query(
      `INSERT INTO "authVerification" (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $4)`,
      [storedResetIdentifier(token), userId, expiresAt, now],
    );
    // The audit actions are a closed list in the database (0012): a reset link is recorded as an access change.
    await recordSecurityEvent(tx, fresh, 'password_reset_link_created', member.id);
    return { url: resetLinkUrl(base, token), expiresAt: expiresAt.toISOString(), email: member.email };
  });
}
