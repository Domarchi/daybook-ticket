import { type AccessContext } from './access';
import { ApiError, db, getTicket, ticketColumns } from './server';
import { ticketReadScope as scopeFor } from './ticket-read-scope';
import { hydrateMessageReferences } from './ticket-collaboration';
import type { Message, Ticket } from './types';
import {
  decodeTicketCursor,
  encodeTicketCursor,
  literalSearchPattern,
  type TicketSearchQuery,
} from './ticket-search-query';

export interface TicketCounts {
  all: number;
  open: number;
  pending: number;
  resolved: number;
  mine: number;
  unassigned: number;
  overdue: number;
}
export interface TicketPage {
  items: Ticket[];
  total: number;
  nextCursor: string | null;
}
export interface TicketDepartmentCount {
  department: string;
  total: number;
}
export interface TicketContact {
  email: string;
  name: string;
  total: number;
  active: number;
}
export interface ContactPage {
  items: TicketContact[];
  total: number;
  nextCursor: string | null;
}
export interface ConversationPage {
  ticket: Ticket;
  messages: Message[];
  nextCursor: string | null;
}

export async function getTicketCounts(access: AccessContext, now = new Date().toISOString()): Promise<TicketCounts> {
  const scope = scopeFor(access),
    member = scope.bind(access.member.id),
    time = scope.bind(now);
  const result = await db()
    .prepare(
      `SELECT count(*)::int AS "all",
    count(*) FILTER (WHERE t.status='open')::int AS open,
    count(*) FILTER (WHERE t.status='pending')::int AS pending,
    count(*) FILTER (WHERE t.status='resolved')::int AS resolved,
    count(*) FILTER (WHERE t."assigneeMemberId"=${member})::int AS mine,
    count(*) FILTER (WHERE t.status<>'resolved' AND t."assigneeMemberId" IS NULL)::int AS unassigned,
    count(*) FILTER (WHERE t.status<>'resolved' AND t."dueAt"<${time})::int AS overdue
    FROM tickets t WHERE ${scope.sql}`,
    )
    .bind(...scope.values)
    .first<TicketCounts>();
  return result ?? { all: 0, open: 0, pending: 0, resolved: 0, mine: 0, unassigned: 0, overdue: 0 };
}

export async function getTicketDepartments(access: AccessContext): Promise<TicketDepartmentCount[]> {
  const scope = scopeFor(access);
  return (
    await db()
      .prepare(
        `SELECT t.department,count(*)::int AS total FROM tickets t WHERE ${scope.sql} GROUP BY t.department ORDER BY t.department`,
      )
      .bind(...scope.values)
      .all<TicketDepartmentCount>()
  ).results;
}

export async function getTicketPage(access: AccessContext, query: TicketSearchQuery): Promise<TicketPage> {
  const scope = scopeFor(access);
  const filters = [scope.sql];
  if (query.queue === 'mine') filters.push(`t."assigneeMemberId"=${scope.bind(access.member.id)}`);
  else if (query.queue === 'unassigned') filters.push(`t."assigneeMemberId" IS NULL AND t.status<>'resolved'`);
  else if (query.queue === 'overdue')
    filters.push(`t.status<>'resolved' AND t."dueAt"<${scope.bind(new Date().toISOString())}`);
  else if (query.queue !== 'all') filters.push(`t.status=${scope.bind(query.queue)}`);
  if (query.priority !== 'all') filters.push(`t.priority=${scope.bind(query.priority)}`);
  if (query.department !== 'all') filters.push(`t.department=${scope.bind(query.department)}`);
  if (query.company !== 'all')
    filters.push(
      query.company === 'none' ? `t."customerCompanyId" IS NULL` : `t."customerCompanyId"=${scope.bind(query.company)}`,
    );
  if (query.agent !== 'all')
    filters.push(
      query.agent === 'none' ? `t."assigneeMemberId" IS NULL` : `t."assigneeMemberId"=${scope.bind(query.agent)}`,
    );
  if (query.q) {
    const pattern = scope.bind(literalSearchPattern(query.q));
    // Visibility is applied inside EXISTS as well as to the ticket. Neither private
    // note matches nor note text can affect a client's result or result count.
    filters.push(`(concat_ws(' ',t.id::text,t.subject,t."requesterName",t."requesterEmail",t.department) ILIKE ${pattern} ESCAPE E'\\\\' OR EXISTS (
      SELECT 1 FROM messages search_message WHERE search_message."ownerId"=t."ownerId" AND search_message."ticketId"=t.id
      ${access.role === 'client' ? "AND search_message.kind<>'note'" : ''} AND search_message.body ILIKE ${pattern} ESCAPE E'\\\\'))`);
  }
  const where = filters.join(' AND '),
    countValues = [...scope.values];
  const cursor = decodeTicketCursor(query.cursor);
  const boundary = cursor ? ` AND (t."updatedAt",t.id)<(${scope.bind(cursor.at)},${scope.bind(cursor.id)})` : '';
  const size = scope.bind(query.limit + 1);
  const [page, count] = await Promise.all([
    db()
      .prepare(
        `SELECT ${ticketColumns} FROM tickets t WHERE ${where}${boundary} ORDER BY t."updatedAt" DESC,t.id DESC LIMIT ${size}`,
      )
      .bind(...scope.values)
      .all<Ticket>(),
    db()
      .prepare(`SELECT count(*)::int AS total FROM tickets t WHERE ${where}`)
      .bind(...countValues)
      .first<{ total: number }>(),
  ]);
  const items = page.results.slice(0, query.limit),
    last = items.at(-1);
  return {
    items,
    total: count?.total ?? 0,
    nextCursor:
      page.results.length > query.limit && last ? encodeTicketCursor({ at: last.updatedAt, id: last.id }) : null,
  };
}

export async function getConversationPage(
  access: AccessContext,
  ticketId: number,
  limit = 50,
  cursorValue: string | null = null,
): Promise<ConversationPage> {
  const ticket = await getTicket(access, ticketId);
  const scope = scopeFor(access);
  const id = scope.bind(ticketId),
    cursor = decodeTicketCursor(cursorValue);
  const boundary = cursor ? ` AND (m."createdAt",m.id)<(${scope.bind(cursor.at)},${scope.bind(cursor.id)})` : '';
  const size = scope.bind(limit + 1);
  const result = await db()
    .prepare(
      `SELECT m.id,m."replyToMessageId",m."ticketId",m.author,m."authorMemberId",m."authorRole",m.body,m."bodyFormat",m.kind,m."createdAt",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'size',a.size,'contentType',a."contentType") ORDER BY a."createdAt",a.id)
        FROM attachments a WHERE a."ownerId"=m."ownerId" AND a."messageId"=m.id AND a."ticketId"=m."ticketId" AND a.kind=m.kind AND a.status='attached'),'[]'::jsonb) AS attachments
    FROM messages m JOIN tickets t ON t.id=m."ticketId" AND t."ownerId"=m."ownerId"
    WHERE ${scope.sql} AND t.id=${id}${access.role === 'client' ? " AND m.kind<>'note'" : ''}${boundary}
    ORDER BY m."createdAt" DESC,m.id DESC LIMIT ${size}`,
    )
    .bind(...scope.values)
    .all<Message>();
  const messages = result.results.slice(0, limit),
    oldest = messages.at(-1);
  if (!messages.length) {
    // A concurrent membership change must not return the ticket read above.
    const currentScope = scopeFor(access);
    const currentId = currentScope.bind(ticketId);
    const permitted = await db()
      .prepare(`SELECT t.id FROM tickets t WHERE ${currentScope.sql} AND t.id=${currentId}`)
      .bind(...currentScope.values)
      .first();
    if (!permitted) throw new ApiError(404, 'El ticket no existe o no tienes acceso.');
  }
  return {
    ticket,
    messages: await hydrateMessageReferences(access, messages.reverse()),
    nextCursor:
      result.results.length > limit && oldest ? encodeTicketCursor({ at: oldest.createdAt, id: oldest.id }) : null,
  };
}

export async function getContactPage(
  access: AccessContext,
  limit = 50,
  cursor: string | null = null,
): Promise<ContactPage> {
  if (access.role === 'client') throw new ApiError(403, 'El directorio está disponible solo para el equipo.');
  if (cursor && (cursor.length > 254 || /[\u0000-\u001f]/.test(cursor)))
    throw new ApiError(400, 'La página solicitada no es válida.');
  const scope = scopeFor(access),
    countValues = [...scope.values];
  const boundary = cursor ? ` HAVING t."requesterEmail">${scope.bind(cursor)}` : '';
  const size = scope.bind(limit + 1);
  const [result, count] = await Promise.all([
    db()
      .prepare(
        `SELECT t."requesterEmail" AS email,min(t."requesterName") AS name,count(*)::int AS total,count(*) FILTER (WHERE t.status<>'resolved')::int AS active
      FROM tickets t WHERE ${scope.sql} GROUP BY t."requesterEmail"${boundary} ORDER BY t."requesterEmail" LIMIT ${size}`,
      )
      .bind(...scope.values)
      .all<TicketContact>(),
    db()
      .prepare(`SELECT count(DISTINCT t."requesterEmail")::int AS total FROM tickets t WHERE ${scope.sql}`)
      .bind(...countValues)
      .first<{ total: number }>(),
  ]);
  const items = result.results.slice(0, limit);
  return {
    items,
    total: count?.total ?? 0,
    nextCursor: result.results.length > limit ? (items.at(-1)?.email ?? null) : null,
  };
}
