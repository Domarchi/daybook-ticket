import { ticketAccessSql, type AccessContext } from './access';
import { db, ticketColumns } from './server';
import type { Message, Ticket } from './types';
import { getAlertsPage } from './alerts';

// Keep the initial workspace and automatic updates under the same visibility rules.
export async function getTicketFeed(access: AccessContext) {
  const database = db();
  const client = access.role === 'client';
  const scope = ticketAccessSql(access);
  const [tickets, messages, alertsPage] = await Promise.all([
    database.prepare(`SELECT ${ticketColumns} FROM tickets t WHERE ${scope.sql} ORDER BY "updatedAt" DESC, id DESC`).bind(...scope.values).all<Ticket>(),
    database.prepare(`SELECT m.id, m."ticketId", m.author, m."authorMemberId", m."authorRole", m.body, m.kind, m."createdAt",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'size', a.size, 'contentType', a."contentType") ORDER BY a."createdAt", a.id)
        FROM attachments a WHERE a."ownerId" = m."ownerId" AND a."messageId" = m.id AND a."ticketId" = m."ticketId"
          AND a.kind = m.kind AND a.status = 'attached'), '[]'::jsonb) AS attachments
      FROM messages m JOIN tickets t ON t.id = m."ticketId" AND t."ownerId" = m."ownerId"
      WHERE ${scope.sql}${client ? " AND m.kind <> 'note'" : ''} ORDER BY m."createdAt", m.id`).bind(...scope.values).all<Message>(),
    getAlertsPage(access),
  ]);
  return { tickets: tickets.results, messages: messages.results, alerts: alertsPage.items, alertsPage };
}
