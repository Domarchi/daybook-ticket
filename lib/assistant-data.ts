/**
 * The database reads behind Bita. All of them are SELECTs; nothing here writes.
 *
 * Every read goes through the same visibility rules as the desk: `ticketReadScope` (owner, live membership and role)
 * for lists, and `getTicket`/`getConversationPage` for a single ticket. The caller is always the session's own access
 * context; no function takes a member or role from the model.
 */
import type { AccessContext } from './access';
import { MAX_DESK_ROWS, summarizeDesk, type DeskRow } from './assistant-desk';
import {
  MAX_ARTICLE_TEXT,
  MAX_MESSAGE_TEXT,
  MAX_SOLUTION_TEXT,
  messageForModel,
  safeText,
  ticketDetail,
} from './assistant-privacy';
import {
  MAX_ARTICLES,
  MAX_CANDIDATES,
  MAX_QUERY_BODY,
  categoryLabel,
  classify,
  queryTokens,
  rankSimilar,
  type Candidate,
} from './assistant-suggestions';
import { db } from './server';
import { getConversationPage } from './ticket-search';
import { ticketReadScope } from './ticket-read-scope';
import { FINISHED_SQL } from './ticket-status';

export async function readDeskSummary(access: AccessContext, now = Date.now()) {
  const scope = ticketReadScope(access);
  const at = scope.bind(new Date(now).toISOString());
  const size = scope.bind(MAX_DESK_ROWS + 1);
  const rows = (
    await db()
      .prepare(
        `SELECT t.id,t.subject,t."requesterName",t.status,t."assigneeMemberId",t.priority,t."dueAt",t."updatedAt",t."createdAt",
        assignee.name AS "assigneeName",
        (SELECT m.kind FROM messages m WHERE m."ownerId"=t."ownerId" AND m."ticketId"=t.id AND m.kind<>'note'
          ORDER BY m."createdAt" DESC,m.id DESC LIMIT 1) AS "lastPublicKind",
        (SELECT e.reason FROM "escalationOccurrences" e WHERE e."ownerId"=t."ownerId" AND e."ticketId"=t.id
          AND e."createdAt" > COALESCE((SELECT max(r."createdAt") FROM messages r WHERE r."ownerId"=t."ownerId"
            AND r."ticketId"=t.id AND r.kind='reply'),'') AND e."createdAt"<=${at}
          ORDER BY e."createdAt" DESC LIMIT 1) AS "escalationReason"
      FROM tickets t LEFT JOIN members assignee ON assignee.id=t."assigneeMemberId" AND assignee."ownerId"=t."ownerId"
      WHERE ${scope.sql} AND t.status NOT IN ${FINISHED_SQL}
      ORDER BY t."dueAt" ASC,t.id ASC LIMIT ${size}`,
      )
      .bind(...scope.values)
      .all<DeskRow>()
  ).results;
  return summarizeDesk(rows.slice(0, MAX_DESK_ROWS), now, rows.length > MAX_DESK_ROWS);
}

async function nameOf(table: 'members' | 'customerCompanies', id: string | null, ownerId: string) {
  if (!id) return null;
  const row = await db()
    .prepare(`SELECT name FROM "${table}" WHERE id=$1 AND "ownerId"=$2`)
    .bind(id, ownerId)
    .first<{ name: string }>();
  return row?.name ?? null;
}

async function firstMessageBody(access: AccessContext, ticketId: number) {
  const row = await db()
    .prepare(
      `SELECT body FROM messages WHERE "ownerId"=$1 AND "ticketId"=$2 AND kind='request' ORDER BY "createdAt",id LIMIT 1`,
    )
    .bind(access.ownerId, ticketId)
    .first<{ body: string }>();
  return row?.body ?? '';
}

async function similarCandidates(access: AccessContext, ticketId: number, tokens: string[]) {
  if (!tokens.length) return [];
  const scope = ticketReadScope(access);
  const words = scope.bind(`{${tokens.map(token => `"${token}"`).join(',')}}`);
  const self = scope.bind(ticketId);
  const size = scope.bind(MAX_CANDIDATES);
  // Text compared without accents or case, like the tokens. `translate` keeps it inside plain PostgreSQL.
  const fold = (column: string) => `translate(lower(${column}),'áéíóúüñàèìòù','aeiouunaeiou')`;
  return (
    await db()
      .prepare(
        `SELECT * FROM (
        SELECT t.id,t.subject,t."requesterName",t."updatedAt",COALESCE(first.body,'') AS "firstBody",
          (SELECT count(*) FROM unnest(${words}::text[]) w WHERE position(w IN ${fold('t.subject')})>0)*2
          + (SELECT count(*) FROM unnest(${words}::text[]) w WHERE position(w IN ${fold(`left(COALESCE(first.body,''),${MAX_QUERY_BODY})`)})>0) AS score
        FROM tickets t
        LEFT JOIN LATERAL (SELECT m.body FROM messages m WHERE m."ownerId"=t."ownerId" AND m."ticketId"=t.id AND m.kind='request'
          ORDER BY m."createdAt",m.id LIMIT 1) first ON true
        WHERE ${scope.sql} AND t.status IN ${FINISHED_SQL} AND t.id<>${self}
      ) ranked WHERE score>0 ORDER BY score DESC,"updatedAt" DESC,id DESC LIMIT ${size}`,
      )
      .bind(...scope.values)
      .all<Candidate & { score: string | number }>()
  ).results.map(row => ({ ...row, score: Number(row.score) }));
}

/** The team's last public reply and last internal note of each solved ticket: usually where the fix is written. */
async function solutionsOf(access: AccessContext, ids: number[]) {
  if (!ids.length) return new Map<number, { reply: string; note: string }>();
  const rows = (
    await db()
      .prepare(
        `SELECT DISTINCT ON (m."ticketId",m.kind) m."ticketId",m.kind,m.body FROM messages m
       WHERE m."ownerId"=$1 AND m."ticketId"=ANY($2::int[]) AND m.kind IN ('reply','note')
       ORDER BY m."ticketId",m.kind,m."createdAt" DESC,m.id DESC`,
      )
      .bind(access.ownerId, `{${ids.join(',')}}`)
      .all<{ ticketId: number; kind: string; body: string }>()
  ).results;
  const result = new Map<number, { reply: string; note: string }>();
  for (const row of rows) {
    const entry = result.get(row.ticketId) ?? { reply: '', note: '' };
    if (row.kind === 'reply') entry.reply = row.body;
    else entry.note = row.body;
    result.set(row.ticketId, entry);
  }
  return result;
}

async function matchingArticles(access: AccessContext, tokens: string[]) {
  if (!tokens.length) return [];
  const fold = (column: string) => `translate(lower(${column}),'áéíóúüñàèìòù','aeiouunaeiou')`;
  const rows = (
    await db()
      .prepare(
        `SELECT * FROM (
        SELECT a.id,a.title,a.category,left(a.body,${MAX_ARTICLE_TEXT * 2}) AS body,a."reviewState",
          (SELECT count(*) FROM unnest($2::text[]) w WHERE position(w IN ${fold('a.title')})>0)*2
          + (SELECT count(*) FROM unnest($2::text[]) w WHERE position(w IN ${fold('a.body')})>0) AS score
        FROM articles a WHERE a."ownerId"=$1 AND NOT a.archived
      ) ranked WHERE score>0 ORDER BY score DESC,id DESC LIMIT $3`,
      )
      .bind(access.ownerId, `{${tokens.map(token => `"${token}"`).join(',')}}`, MAX_ARTICLES)
      .all<{ id: number; title: string; category: string; body: string; reviewState: string }>()
  ).results;
  return rows.map(row => ({
    articulo: row.id,
    titulo: safeText(row.title, 120),
    categoria: safeText(row.category, 60),
    estado: row.reviewState === 'approved' ? 'aprobado' : 'borrador o en revisión',
    extracto: safeText(row.body, MAX_ARTICLE_TEXT),
  }));
}

export const MAX_CONVERSATION_FOR_MODEL = 12;

/**
 * Everything "Sugerir solución" needs for one ticket, already reduced to the allow-list. The page uses it as is (no
 * model); the chat tool adds the recent conversation so the model can write the steps.
 */
export async function readSuggestions(
  access: AccessContext,
  ticketId: number,
  options: { conversation?: boolean } = {},
  now = Date.now(),
) {
  const page = await getConversationPage(access, ticketId, MAX_CONVERSATION_FOR_MODEL);
  const ticket = page.ticket;
  const [assigneeName, companyName, firstBody] = await Promise.all([
    nameOf('members', ticket.assigneeMemberId, access.ownerId),
    nameOf('customerCompanies', ticket.customerCompanyId, access.ownerId),
    firstMessageBody(access, ticket.id),
  ]);
  // The classifier runs here, on the server, and sends nothing; the search words come from the MASKED text, so a
  // password or a name typed by the customer never becomes a search word that travels.
  const category = classify(ticket.subject, firstBody);
  const people = [ticket.requesterName];
  const tokens = queryTokens(safeText(ticket.subject, 200, people), safeText(firstBody, MAX_QUERY_BODY, people));
  const [candidates, articles] = await Promise.all([
    similarCandidates(access, ticket.id, tokens),
    matchingArticles(access, tokens),
  ]);
  const ranked = rankSimilar(category.raw, candidates);
  const solutions = await solutionsOf(
    access,
    ranked.map(item => item.id),
  );
  const similar = ranked.map(item => ({
    numero: item.id,
    asunto: safeText(item.subject, 120, [item.requesterName]),
    categoria: categoryLabel(item.category),
    misma_categoria: item.sameCategory,
    palabras_en_comun: item.score,
    actualizado: item.updatedAt,
    respuesta_del_equipo: safeText(solutions.get(item.id)?.reply ?? '', MAX_SOLUTION_TEXT, [item.requesterName]),
    nota_interna: safeText(solutions.get(item.id)?.note ?? '', MAX_SOLUTION_TEXT, [item.requesterName]),
  }));
  return {
    ticket: ticketDetail(ticket, { assigneeName, companyName, requesterName: ticket.requesterName }, now),
    categoria: { etiqueta: category.etiqueta, confianza: category.confianza, palabras: category.palabras },
    palabras_buscadas: tokens,
    similares: similar,
    articulos: articles,
    ...(options.conversation
      ? {
          conversacion: page.messages.map(message => messageForModel(message, people)),
          conversacion_recortada: Boolean(page.nextCursor),
        }
      : {}),
  };
}

export type Suggestions = Awaited<ReturnType<typeof readSuggestions>>;

/** Messages a recap reads: the latest ones, plus the customer's first request when it fell outside the window. */
export const MAX_RECAP_MESSAGES = 40;

async function messageCount(access: AccessContext, ticketId: number) {
  const row = await db()
    .prepare(`SELECT count(*)::int AS total FROM messages WHERE "ownerId"=$1 AND "ticketId"=$2`)
    .bind(access.ownerId, ticketId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

/**
 * Everything the recap of a long ticket (feature 4) needs, reduced to the allow-list: the ticket's detail, how many
 * messages it has, the latest `MAX_RECAP_MESSAGES` masked, and the first request when it is older than those.
 */
export async function readRecap(access: AccessContext, ticketId: number, now = Date.now()) {
  const page = await getConversationPage(access, ticketId, MAX_RECAP_MESSAGES);
  const ticket = page.ticket;
  const people = [ticket.requesterName];
  const [assigneeName, companyName, total, firstBody] = await Promise.all([
    nameOf('members', ticket.assigneeMemberId, access.ownerId),
    nameOf('customerCompanies', ticket.customerCompanyId, access.ownerId),
    messageCount(access, ticket.id),
    page.nextCursor ? firstMessageBody(access, ticket.id) : Promise.resolve(''),
  ]);
  return {
    ticket: ticketDetail(ticket, { assigneeName, companyName, requesterName: ticket.requesterName }, now),
    mensajes_totales: total,
    ...(page.nextCursor
      ? { primer_pedido_del_cliente: safeText(firstBody, MAX_MESSAGE_TEXT, people), mensajes_omitidos: true }
      : {}),
    conversacion: page.messages.map(message => messageForModel(message, people)),
  };
}

export type Recap = Awaited<ReturnType<typeof readRecap>>;
