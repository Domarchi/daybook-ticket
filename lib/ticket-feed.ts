import type { AccessContext } from './access';
import { db, messageColumns, ticketColumns } from './server';
import type { Message, Ticket } from './types';

// Keep the initial workspace and automatic updates under the same visibility rules.
export async function getTicketFeed(access: AccessContext) {
  const database = db();
  const client = access.role === 'client';
  const ticketScope = client ? ' AND "requesterMemberId" = $2' : '';
  const ticketBindings = client ? [access.ownerId, access.member.id] : [access.ownerId];
  const messageScope = client ? ` AND kind <> 'note' AND "ticketId" IN (SELECT id FROM tickets WHERE "ownerId" = $2 AND "requesterMemberId" = $3)` : '';
  const messageBindings = client ? [access.ownerId, access.ownerId, access.member.id] : [access.ownerId];
  const [tickets, messages] = await Promise.all([
    database.prepare(`SELECT ${ticketColumns} FROM tickets WHERE "ownerId" = $1${ticketScope} ORDER BY "updatedAt" DESC, id DESC`).bind(...ticketBindings).all<Ticket>(),
    database.prepare(`SELECT ${messageColumns} FROM messages WHERE "ownerId" = $1${messageScope} ORDER BY "createdAt" ASC, id ASC`).bind(...messageBindings).all<Message>(),
  ]);
  return { tickets: tickets.results, messages: messages.results };
}
