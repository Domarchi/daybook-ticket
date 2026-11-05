import type { PoolClient } from 'pg';
import { z } from 'zod';
import { ApiError, db, getTicket } from './server';
import { canAccessTicket, requireStaff, type AccessContext } from './access';
import { acquireTicketWorkLock } from './work-lock';
import { lockAccess, lockTicket } from './ticket-mutations';
import { ticketReadScope } from './ticket-read-scope';
import { decodeTicketCursor, encodeTicketCursor, literalSearchPattern } from './ticket-search-query';
import { publicQuote, quoteIsAllowed, safeMentionIds } from './collaboration-model';
import { parseEvolutionFeatures } from './evolution-feature-model';
import type { Message } from './types';
import type { Database } from '@/db/database';

const messageSelect = `m.id,m."ticketId",m."replyToMessageId",m.author,m."authorMemberId",m."authorRole",m.body,m."bodyFormat",m.kind,m."createdAt",
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'size',a.size,'contentType',a."contentType") ORDER BY a."createdAt",a.id)
  FROM attachments a WHERE a."ownerId"=m."ownerId" AND a."ticketId"=m."ticketId" AND a."messageId"=m.id AND a.kind=m.kind AND a.status='attached'),'[]'::jsonb) AS attachments`;

export async function validateMessageCollaboration(tx: PoolClient, access: AccessContext, ticketId: number, input: { kind: string; replyToMessageId?: number | null; mentionMemberIds?: string[] }) {
  // A read check before reserving mentioned members avoids an existence oracle.
  // The caller holds the owner work lock; it locks the ticket after this check.
  const ticket=(await tx.query('SELECT \"ownerId\",\"requesterMemberId\",\"customerCompanyId\" FROM tickets WHERE id=$1 AND \"ownerId\"=$2',[ticketId,access.ownerId])).rows[0];
  if(!ticket||!canAccessTicket(access,ticket))throw new ApiError(404,'El ticket no existe o no tienes acceso.');
  if ((input.mentionMemberIds?.length ?? 0) && input.kind !== 'note') throw new ApiError(400, 'Las menciones están disponibles solo en notas internas.');
  const ids = safeMentionIds(input.mentionMemberIds ?? [], access.member.id, input.kind);
  if (input.replyToMessageId || ids.length) {
    const row = (await tx.query('SELECT "featuresJson" FROM "evolutionFeatures" WHERE "ownerId"=$1', [access.ownerId])).rows[0];
    if (!parseEvolutionFeatures(row?.featuresJson).collaboration) throw new ApiError(503, 'La colaboración avanzada está en pausa. Tu borrador se conserva.');
  }
  let source: Message | null = null;
  if (input.replyToMessageId) {
    source = (await tx.query('SELECT * FROM messages WHERE id=$1 AND "ownerId"=$2 AND "ticketId"=$3 FOR SHARE', [input.replyToMessageId, access.ownerId, ticketId])).rows[0] ?? null;
    if (!source || !quoteIsAllowed(source, { kind: input.kind, ticketId, client: access.role === 'client' })) throw new ApiError(400, 'Ese mensaje no se puede citar en esta respuesta.');
  }
  if (ids.length && access.role === 'client') throw new ApiError(403, 'Las menciones son exclusivas del equipo.');
  const mentions = ids.length ? (await tx.query('SELECT id,name FROM members WHERE "ownerId"=$1 AND "organizationId"=$2 AND id=ANY($3::text[]) AND status=\'active\' AND "userId" IS NOT NULL AND role IN (\'owner\',\'admin\',\'agent\') FOR SHARE', [access.ownerId, access.organizationId, ids])).rows as { id: string; name: string }[] : [];
  if (mentions.length !== ids.length) throw new ApiError(400, 'Una de las personas mencionadas ya no pertenece al equipo activo.');
  return { replyToMessageId: source?.id ?? null, quote: source ? publicQuote(source) : null, mentions };
}

export async function attachMessageCollaboration(tx: PoolClient, access: AccessContext, messageId: number, data: Awaited<ReturnType<typeof validateMessageCollaboration>>) {
  if (data.replyToMessageId) await tx.query('UPDATE messages SET "replyToMessageId"=$1 WHERE id=$2 AND "ownerId"=$3', [data.replyToMessageId, messageId, access.ownerId]);
  for (const member of data.mentions) await tx.query('INSERT INTO "messageMentions" ("ownerId","messageId","memberId","createdAt") VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [access.ownerId, messageId, member.id, new Date().toISOString()]);
}

/** Freshly resolve citations; no private text is frozen into a public message. */
export async function hydrateMessageReferences(access: AccessContext, messages: Message[]): Promise<Message[]> {
  if (!messages.length) return messages;
  const sourceIds = [...new Set(messages.map(message => message.replyToMessageId).filter((id): id is number => Boolean(id)))];
  const scope = ticketReadScope(access), ids = scope.bind(JSON.stringify(sourceIds));
  const sources = sourceIds.length ? (await db().prepare(`SELECT ${messageSelect} FROM messages m JOIN tickets t ON t.id=m."ticketId" AND t."ownerId"=m."ownerId" WHERE ${scope.sql} AND m.id IN (SELECT jsonb_array_elements_text(${ids}::jsonb)::int)${access.role === 'client' ? " AND m.kind<>'note'" : ''}`).bind(...scope.values).all<Message>()).results : [];
  const byId = new Map(sources.map(source => [source.id, source]));
  const mentions = access.role === 'client' ? [] : (await db().prepare(`SELECT x."messageId",a.id,a.name FROM "messageMentions" x JOIN members a ON a.id=x."memberId" AND a."ownerId"=x."ownerId" JOIN messages m ON m.id=x."messageId" AND m."ownerId"=x."ownerId" JOIN tickets t ON t.id=m."ticketId" AND t."ownerId"=m."ownerId" WHERE ${scope.sql} AND m.kind='note' AND m.id=ANY(ARRAY[${messages.map(message => Number(message.id)).join(',')}]::int[]) AND a.status='active' AND a.role IN ('owner','admin','agent')`).bind(...scope.values.slice(0, -1)).all<{ messageId: number; id: string; name: string }>()).results;
  return messages.map(message => {
    const source = byId.get(message.replyToMessageId ?? 0);
    const quote = source && quoteIsAllowed(source, { ticketId: message.ticketId, kind: message.kind, client: access.role === 'client' }) ? publicQuote(source) : null;
    return { ...message, quote, mentions: mentions.filter(mention => mention.messageId === message.id).map(({ id, name }) => ({ id, name })) };
  });
}

export async function getMessageContext(access: AccessContext, ticketId: number, messageId: number) {
  await getTicket(access, ticketId);
  const anchorScope = ticketReadScope(access), ticket = anchorScope.bind(ticketId), anchorId = anchorScope.bind(messageId);
  const anchor = await db().prepare(`SELECT ${messageSelect} FROM messages m JOIN tickets t ON t.id=m."ticketId" AND t."ownerId"=m."ownerId" WHERE ${anchorScope.sql} AND t.id=${ticket} AND m.id=${anchorId}${access.role === 'client' ? " AND m.kind<>'note'" : ''}`).bind(...anchorScope.values).first<Message>();
  if (!anchor) throw new ApiError(404, 'El mensaje no existe o ya no tienes acceso.');
  const side = async (older: boolean) => {
    const scope = ticketReadScope(access), id = scope.bind(ticketId), at = scope.bind(anchor.createdAt), boundary = scope.bind(anchor.id);
    return (await db().prepare(`SELECT ${messageSelect} FROM messages m JOIN tickets t ON t.id=m."ticketId" AND t."ownerId"=m."ownerId" WHERE ${scope.sql} AND t.id=${id}${access.role === 'client' ? " AND m.kind<>'note'" : ''} AND (m."createdAt",m.id)${older ? '<' : '>'}(${at},${boundary}) ORDER BY m."createdAt" ${older ? 'DESC' : 'ASC'},m.id ${older ? 'DESC' : 'ASC'} LIMIT 11`).bind(...scope.values).all<Message>()).results;
  };
  const [before, after] = await Promise.all([side(true), side(false)]);
  const messages = await hydrateMessageReferences(access, [...before.slice(0, 10).reverse(), anchor, ...after.slice(0, 10)]);
  return { anchorId: anchor.id, messages, previousAnchorId: before.length > 10 ? before[9].id : null, nextAnchorId: after.length > 10 ? after[9].id : null };
}

export async function searchTicketMessages(access: AccessContext, ticketId: number, input: { q: string; cursor: string | null; limit: number }) {
  await getTicket(access, ticketId);
  const scope = ticketReadScope(access), id = scope.bind(ticketId), pattern = scope.bind(literalSearchPattern(input.q));
  const where = `${scope.sql} AND t.id=${id}${access.role === 'client' ? " AND m.kind<>'note'" : ''} AND (concat_ws(' ',m.body,m.author) ILIKE ${pattern} ESCAPE E'\\\\' OR EXISTS (SELECT 1 FROM attachments a WHERE a."ownerId"=m."ownerId" AND a."messageId"=m.id AND a."ticketId"=m."ticketId" AND a.kind=m.kind AND a.status='attached' AND a.name ILIKE ${pattern} ESCAPE E'\\\\'))`;
  const countValues = [...scope.values], cursor = decodeTicketCursor(input.cursor);
  const boundary = cursor ? ` AND (m."createdAt",m.id)<(${scope.bind(cursor.at)},${scope.bind(cursor.id)})` : '';
  const limit = scope.bind(input.limit + 1);
  const [rows, total] = await Promise.all([
    db().prepare(`SELECT m.id,m.author,m."authorRole",m.kind,m."createdAt",left(m.body,400) AS excerpt FROM messages m JOIN tickets t ON t.id=m."ticketId" AND t."ownerId"=m."ownerId" WHERE ${where}${boundary} ORDER BY m."createdAt" DESC,m.id DESC LIMIT ${limit}`).bind(...scope.values).all<{ id: number; author: string; authorRole: string | null; kind: string; createdAt: string; excerpt: string }>(),
    db().prepare(`SELECT count(*)::int AS total FROM messages m JOIN tickets t ON t.id=m."ticketId" AND t."ownerId"=m."ownerId" WHERE ${where}`).bind(...countValues).first<{ total: number }>(),
  ]);
  const items = rows.results.slice(0, input.limit), tail = items.at(-1);
  return { items, total: total?.total ?? 0, nextCursor: rows.results.length > input.limit && tail ? encodeTicketCursor({ at: tail.createdAt, id: tail.id }) : null };
}

const fileCursor = z.object({ at: z.iso.datetime(), id: z.string().uuid() }).strict();
export async function getTicketFiles(access: AccessContext, ticketId: number, query: URLSearchParams) {
  await getTicket(access, ticketId);
  const kind = z.enum(['all','image','pdf','document']).parse(query.get('type') || 'all');
  const q = z.string().trim().max(200).parse(query.get('q') || '');
  const scope = ticketReadScope(access), id = scope.bind(ticketId);
  let where = `${scope.sql} AND t.id=${id} AND a.status='attached' AND a.kind=m.kind${access.role === 'client' ? " AND m.kind<>'note'" : ''}`;
  if (q) where += ` AND a.name ILIKE ${scope.bind(literalSearchPattern(q))} ESCAPE E'\\\\'`;
  if (kind === 'image') where += " AND a.\"contentType\" IN ('image/png','image/jpeg','image/webp')";
  if (kind === 'pdf') where += " AND a.\"contentType\"='application/pdf'";
  if (kind === 'document') where += " AND a.\"contentType\" NOT LIKE 'image/%' AND a.\"contentType\"<>'application/pdf'";
  for (const [name, operator] of [['from','>='],['to','<=']] as const) if (query.get(name)) where += ` AND (a."createdAt"::timestamptz AT TIME ZONE 'America/Santiago')::date ${operator} ${scope.bind(z.iso.date().parse(query.get(name)))}::date`;
  const countValues = [...scope.values];
  if (query.get('cursor')) {
    const raw = query.get('cursor')!;
    if (raw.length > 400 || !/^[\w-]+$/.test(raw)) throw new ApiError(400, 'La página de archivos no es válida.');
    let cursor; try { cursor = fileCursor.parse(JSON.parse(Buffer.from(raw,'base64url').toString())); } catch { throw new ApiError(400, 'La página de archivos no es válida.'); }
    where += ` AND (a."createdAt",a.id)<(${scope.bind(cursor.at)},${scope.bind(cursor.id)})`;
  }
  const from = 'FROM attachments a JOIN messages m ON m.id=a."messageId" AND m."ownerId"=a."ownerId" AND m."ticketId"=a."ticketId" JOIN tickets t ON t.id=m."ticketId" AND t."ownerId"=m."ownerId"';
  const baseWhere = where.split(' AND (a."createdAt",a.id)<')[0];
  const [rows, count] = await Promise.all([
    db().prepare(`SELECT a.id,a.name,a.size,a."contentType",a."createdAt",m.id AS "messageId",m.kind,m.author ${from} WHERE ${where} ORDER BY a."createdAt" DESC,a.id DESC LIMIT 31`).bind(...scope.values).all<{ id:string;name:string;size:number;contentType:string;createdAt:string;messageId:number;kind:string;author:string }>(),
    db().prepare(`SELECT count(*)::int AS total ${from} WHERE ${baseWhere}`).bind(...countValues).first<{total:number}>(),
  ]);
  const items = rows.results.slice(0,30), tail = items.at(-1);
  return { items, total: count?.total ?? 0, nextCursor: rows.results.length > 30 && tail ? Buffer.from(JSON.stringify({at:tail.createdAt,id:tail.id})).toString('base64url') : null };
}

export async function getTicketFollowers(access: AccessContext, ticketId: number) {
  requireStaff(access); await getTicket(access,ticketId);
  const scope = ticketReadScope(access), ticket = scope.bind(ticketId);
  const result = await db().prepare(`SELECT f."memberId",m.name FROM "ticketFollowers" f JOIN members m ON m.id=f."memberId" AND m."ownerId"=f."ownerId" JOIN tickets t ON t.id=f."ticketId" AND t."ownerId"=f."ownerId" WHERE ${scope.sql} AND t.id=${ticket} AND m.status='active' AND m.role IN ('owner','admin','agent') ORDER BY m.name,m.id`).bind(...scope.values).all<{memberId:string;name:string}>();
  return { following: result.results.some(row=>row.memberId===access.member.id), followers: result.results };
}
export async function setTicketFollowing(access: AccessContext,ticketId:number,following:boolean) {
  await db().transaction(async tx=>{
    await acquireTicketWorkLock(tx,access.ownerId);
    const fresh=requireStaff(await lockAccess(tx,access)); await lockTicket(tx,fresh,ticketId);
    if(following) await tx.query('INSERT INTO "ticketFollowers" ("ownerId","ticketId","memberId","createdAt") VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',[access.ownerId,ticketId,fresh.member.id,new Date().toISOString()]);
    else await tx.query('DELETE FROM "ticketFollowers" WHERE "ownerId"=$1 AND "ticketId"=$2 AND "memberId"=$3',[access.ownerId,ticketId,fresh.member.id]);
  });
  return getTicketFollowers(access,ticketId);
}
export async function followerRecipients(tx:PoolClient,access:AccessContext,ticketId:number,exclude:string[]) {
  const rows=(await tx.query('SELECT f."memberId" FROM "ticketFollowers" f JOIN "evolutionFeatures" e ON e."ownerId"=f."ownerId" JOIN members m ON m.id=f."memberId" AND m."ownerId"=f."ownerId" WHERE f."ownerId"=$1 AND f."ticketId"=$2 AND m.status=\'active\' AND m."userId" IS NOT NULL AND m.role IN (\'owner\',\'admin\',\'agent\') AND COALESCE(e."featuresJson"::jsonb->>\'collaboration\',\'false\')=\'true\'',[access.ownerId,ticketId])).rows;
  return rows.map(row=>String(row.memberId)).filter(id=>id!==access.member.id&&!exclude.includes(id));
}
export async function collaborationDeliveryValid(database:Database,row:{ownerId:string;event:string;ticketId:number|null;recipientMemberId:string;sourceMessageId?:number|null}) {
  if(!['member_mentioned','ticket_followed_update'].includes(row.event)) return true;
  if(!row.sourceMessageId||!row.ticketId) return false;
  const member=await database.prepare(`SELECT m.id FROM members m JOIN messages p ON p.id=$3 AND p."ownerId"=m."ownerId" AND p."ticketId"=$4 JOIN "evolutionFeatures" e ON e."ownerId"=m."ownerId" WHERE m."ownerId"=$1 AND m.id=$2 AND m.status='active' AND m."userId" IS NOT NULL AND m.role IN ('owner','admin','agent') AND p."authorMemberId" IS DISTINCT FROM m.id AND COALESCE(e."featuresJson"::jsonb->>'collaboration','false')='true' AND ${row.event==='member_mentioned'?`p.kind='note' AND EXISTS(SELECT 1 FROM "messageMentions" x WHERE x."ownerId"=m."ownerId" AND x."messageId"=p.id AND x."memberId"=m.id)`:`p.kind<>'note' AND EXISTS(SELECT 1 FROM "ticketFollowers" f WHERE f."ownerId"=m."ownerId" AND f."ticketId"=p."ticketId" AND f."memberId"=m.id)`}`)
    .bind(row.ownerId,row.recipientMemberId,row.sourceMessageId,row.ticketId).first();
  return Boolean(member);
}
