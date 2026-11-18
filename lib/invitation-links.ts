/**
 * Renewing many pending invitation links at once (Fase 7, L3). Like «Renovar enlace» for one person, a new link
 * replaces the old one (which stops working) and queued invitation mail for that person is cancelled, because it holds
 * the old link. Unlike it, no new mail is queued: the admin hands out the links from the downloaded CSV.
 */
import type { PoolClient } from 'pg';
import { checkMemberChange, requireAdmin, type AccessContext, type MemberRecord } from './access';
import { prepareInvitation } from './invitations';
import type { ImportedInvitation } from './member-import-model';
import { ApiError, db } from './server';
import { lockAccess } from './ticket-mutations';
import { acquireTicketWorkLock } from './work-lock';

type Row = MemberRecord & { companyName: string | null; assetTag: string | null };

async function readMembers(tx: PoolClient, access: AccessContext, ids: string[]): Promise<Row[]> {
  return (
    await tx.query<Row>(
      `SELECT m.*, c.name AS "companyName",
              (SELECT a."assetTag" FROM "customerAssets" a
                WHERE a."ownerId" = m."ownerId" AND a."assignedContactMemberId" = m.id AND a.archived = false
                ORDER BY a."createdAt", a.id LIMIT 1) AS "assetTag"
         FROM members m
         LEFT JOIN "customerCompanies" c ON c.id = m."customerCompanyId" AND c."ownerId" = m."ownerId"
        WHERE m.id = ANY($1::text[]) AND m."ownerId" = $2 AND m."organizationId" = $3
        ORDER BY m.name, m.id
        FOR UPDATE OF m`,
      [ids, access.ownerId, access.organizationId],
    )
  ).rows;
}

export async function renewInvitationLinks(
  access: AccessContext,
  memberIds: string[],
): Promise<{ invitations: ImportedInvitation[]; expiresAt: string }> {
  requireAdmin(access);
  const database = db();
  return database.transaction(async tx => {
    await acquireTicketWorkLock(tx, access.ownerId);
    const fresh = requireAdmin(await lockAccess(tx, access));
    const members = await readMembers(tx, fresh, memberIds);
    if (members.length !== memberIds.length)
      throw new ApiError(404, 'Alguna de las cuentas ya no está disponible. Actualiza la lista e inténtalo de nuevo.');
    for (const member of members) {
      checkMemberChange(fresh, member, {});
      if (member.status !== 'invited' || member.userId)
        throw new ApiError(
          409,
          `${member.name} ya aceptó su invitación o no está pendiente. Actualiza la lista e inténtalo de nuevo.`,
        );
    }
    const now = new Date().toISOString(),
      invitations: ImportedInvitation[] = [];
    let expiresAt = now;
    for (const member of members) {
      const invitation = await prepareInvitation(database, fresh.ownerId, member.id);
      await database.execute(invitation.statement, tx);
      expiresAt = invitation.expiresAt;
      invitations.push({
        name: member.name,
        email: member.email,
        company: member.companyName ?? '',
        assetTag: member.assetTag ?? '',
        url: invitation.url,
      });
    }
    await tx.query(
      `UPDATE "mailOutbox" SET status='cancelled',"updatedAt"=$1,"nextAttemptAt"=NULL
        WHERE "ownerId"=$2 AND "recipientMemberId" = ANY($3::text[]) AND event='invitation'
          AND status IN ('queued','awaiting_configuration')`,
      [now, fresh.ownerId, memberIds],
    );
    return { invitations, expiresAt };
  });
}
