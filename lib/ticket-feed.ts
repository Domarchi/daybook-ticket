import { ticketAccessSql, type AccessContext } from './access';
import { db, ticketColumns } from './server';
import type { Message, Ticket, TicketAlert } from './types';

// Keep the initial workspace and automatic updates under the same visibility rules.
export async function getTicketFeed(access: AccessContext) {
  const database = db();
  const client = access.role === 'client';
  const scope = ticketAccessSql(access);
  const [tickets, messages, alerts] = await Promise.all([
    database.prepare(`SELECT ${ticketColumns} FROM tickets t WHERE ${scope.sql} ORDER BY "updatedAt" DESC, id DESC`).bind(...scope.values).all<Ticket>(),
    database.prepare(`SELECT m.id, m."ticketId", m.author, m."authorMemberId", m."authorRole", m.body, m.kind, m."createdAt",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'size', a.size, 'contentType', a."contentType") ORDER BY a."createdAt", a.id)
        FROM attachments a WHERE a."ownerId" = m."ownerId" AND a."messageId" = m.id AND a."ticketId" = m."ticketId"
          AND a.kind = m.kind AND a.status = 'attached'), '[]'::jsonb) AS attachments
      FROM messages m JOIN tickets t ON t.id = m."ticketId" AND t."ownerId" = m."ownerId"
      WHERE ${scope.sql}${client ? " AND m.kind <> 'note'" : ''} ORDER BY m."createdAt", m.id`).bind(...scope.values).all<Message>(),
    // These recipient events are created with the ticket/message transaction,
    // excluding the sender and internal notes. Delivery status is unrelated to
    // in-app alerts; current membership and ticket visibility remain authoritative.
    database.prepare(`SELECT o.id, o.event, o."ticketId", t.subject, o."createdAt"
      FROM "mailOutbox" o
      JOIN tickets t ON t.id = o."ticketId" AND t."ownerId" = o."ownerId"
      WHERE ${scope.sql} AND o."recipientMemberId" = $${scope.values.length + 1}
        AND o.event IN ('ticket_created', 'agent_replied', 'client_replied')
      ORDER BY o."createdAt" DESC, o.id DESC LIMIT 50`)
      .bind(...scope.values, access.member.id).all<TicketAlert>(),
  ]);
  return { tickets: tickets.results, messages: messages.results, alerts: alerts.results };
}
