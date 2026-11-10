import type { Database } from '../db/database';
import type { AccessContext } from './access';
import { lockAccess, lockTicket } from './ticket-mutations';
import { acquireTicketWorkLock } from './work-lock';
import { publicTicketProgress, type PublicTicketProgress } from './ticket-presence-model';

export async function readPublicTicketProgress(
  database: Database,
  access: AccessContext,
  ticketId: number,
): Promise<PublicTicketProgress> {
  return database.transaction(async tx => {
    await acquireTicketWorkLock(tx, access.ownerId);
    const fresh = await lockAccess(tx, access),
      ticket = await lockTicket(tx, fresh, ticketId);
    const responsible = ticket.assigneeMemberId
      ? (
          await tx.query<{ name: string }>(
            `SELECT name FROM members
      WHERE id=$1 AND "ownerId"=$2 AND "organizationId"=$3 AND status='active' AND role IN ('owner','admin','agent')`,
            [ticket.assigneeMemberId, fresh.ownerId, fresh.organizationId],
          )
        ).rows[0]?.name || null
      : null;
    const firstResponseAt =
      (
        await tx.query<{ firstResponseAt: string | null }>(
          `SELECT min("createdAt") AS "firstResponseAt"
      FROM messages WHERE "ownerId"=$1 AND "ticketId"=$2 AND kind='reply' AND "authorRole" IN ('owner','admin','agent')`,
          [fresh.ownerId, ticketId],
        )
      ).rows[0]?.firstResponseAt || null;
    const lastPublicAuthorRole =
      (
        await tx.query<{ authorRole: string | null }>(
          `SELECT "authorRole" FROM messages
      WHERE "ownerId"=$1 AND "ticketId"=$2 AND kind<>'note' ORDER BY "createdAt" DESC,id DESC LIMIT 1`,
          [fresh.ownerId, ticketId],
        )
      ).rows[0]?.authorRole || null;
    const resolvedAt =
      ticket.status === 'resolved'
        ? (
            await tx.query<{ resolvedAt: string }>(
              `SELECT "resolvedAt" FROM "ticketSlaOutcomes"
      WHERE "ownerId"=$1 AND "ticketId"=$2 ORDER BY "resolvedAt" DESC,id DESC LIMIT 1`,
              [fresh.ownerId, ticketId],
            )
          ).rows[0]?.resolvedAt || null
        : null;
    return publicTicketProgress({
      ticket,
      responsibleName: responsible,
      firstResponseAt,
      resolvedAt,
      lastPublicAuthorRole,
    });
  });
}
