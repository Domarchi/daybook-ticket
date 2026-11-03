import type { AccessContext } from './access';
import { db, messageColumns, ticketColumns } from './server';
import type { Message, Ticket, TicketAlert } from './types';

// Keep the initial workspace and automatic updates under the same visibility rules.
export async function getTicketFeed(access: AccessContext) {
  const database = db();
  const client = access.role === 'client';
  const ticketScope = client ? ' AND "requesterMemberId" = $2' : '';
  const ticketBindings = client ? [access.ownerId, access.member.id] : [access.ownerId];
  const messageScope = client ? ` AND kind <> 'note' AND "ticketId" IN (SELECT id FROM tickets WHERE "ownerId" = $2 AND "requesterMemberId" = $3)` : '';
  const messageBindings = client ? [access.ownerId, access.ownerId, access.member.id] : [access.ownerId];
  const [tickets, messages, alerts] = await Promise.all([
    database.prepare(`SELECT ${ticketColumns} FROM tickets WHERE "ownerId" = $1${ticketScope} ORDER BY "updatedAt" DESC, id DESC`).bind(...ticketBindings).all<Ticket>(),
    database.prepare(`SELECT ${messageColumns} FROM messages WHERE "ownerId" = $1${messageScope} ORDER BY "createdAt" ASC, id ASC`).bind(...messageBindings).all<Message>(),
    // These recipient events are created with the ticket/message transaction,
    // excluding the sender and internal notes. Delivery status is unrelated to
    // in-app alerts; current membership and ticket visibility remain authoritative.
    database.prepare(`SELECT o.id, o.event, o."ticketId", t.subject, o."createdAt"
      FROM "mailOutbox" o
      JOIN tickets t ON t.id = o."ticketId" AND t."ownerId" = o."ownerId"
      WHERE o."ownerId" = $1 AND o."recipientMemberId" = $2
        AND o.event IN ('ticket_created', 'agent_replied', 'client_replied')
        ${client ? 'AND t."requesterMemberId" = $2' : ''}
      ORDER BY o."createdAt" DESC, o.id DESC LIMIT 50`)
      .bind(access.ownerId, access.member.id).all<TicketAlert>(),
  ]);
  return { tickets: tickets.results, messages: messages.results, alerts: alerts.results };
}
