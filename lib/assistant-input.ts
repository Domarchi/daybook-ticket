/**
 * Validation of what reaches Bita: the conversation the browser sends, and what the model sends to each tool.
 *
 * The model can be wrong, or be pushed by a customer's text into sending anything, so no tool trusts its input:
 * everything passes here before touching the database. No input carries a member or a role: who asks is always the
 * session. Pure module.
 */
import type { TicketQueue } from './ticket-status';

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Validation<T> => ({ ok: true, value });
const fail = (error: string): Validation<never> => ({ ok: false, error });
type Obj = Record<string, unknown>;
const isObject = (value: unknown): value is Obj => !!value && typeof value === 'object' && !Array.isArray(value);

// --- Tools ---------------------------------------------------------------------------------------------------------

export function validateTicketNumber(input: unknown): Validation<number> {
  if (!isObject(input)) return fail('La consulta debe ser un objeto.');
  const { numero } = input;
  if (typeof numero !== 'number' || !Number.isSafeInteger(numero) || numero < 1)
    return fail('«numero» debe ser el número entero del ticket.');
  return ok(numero);
}

export const SEARCH_VIEWS = {
  todos: 'all',
  activos: 'open',
  sin_asignar: 'unassigned',
  en_proceso: 'inprogress',
  vencidos: 'overdue',
  mios: 'mine',
  solucionados: 'resolved',
  cerrados: 'closed',
} as const satisfies Record<string, TicketQueue>;
export const SEARCH_PRIORITIES = { urgente: 'urgent', alta: 'high', normal: 'normal', baja: 'low' } as const;
export const MAX_SEARCH_ROWS = 10;
export const MAX_SEARCH_TEXT = 100;

export type ToolSearch = {
  q: string;
  queue: TicketQueue;
  priority: 'all' | 'urgent' | 'high' | 'normal' | 'low';
  limit: number;
};

export function validateSearch(input: unknown): Validation<ToolSearch> {
  if (input !== undefined && input !== null && !isObject(input)) return fail('La búsqueda debe ser un objeto.');
  const value = (input ?? {}) as Obj;
  const text = value.texto ?? '';
  if (typeof text !== 'string') return fail('«texto» debe ser un texto.');
  const view = value.vista ?? 'activos';
  if (typeof view !== 'string' || !Object.hasOwn(SEARCH_VIEWS, view))
    return fail(`«vista» debe ser una de: ${Object.keys(SEARCH_VIEWS).join(', ')}.`);
  const priority = value.prioridad ?? null;
  if (priority !== null && (typeof priority !== 'string' || !Object.hasOwn(SEARCH_PRIORITIES, priority)))
    return fail(`«prioridad» debe ser una de: ${Object.keys(SEARCH_PRIORITIES).join(', ')}.`);
  let limit = MAX_SEARCH_ROWS;
  if (value.limite !== undefined && value.limite !== null) {
    if (typeof value.limite !== 'number' || !Number.isInteger(value.limite) || value.limite < 1)
      return fail('«limite» debe ser un entero positivo.');
    limit = Math.min(MAX_SEARCH_ROWS, value.limite);
  }
  return ok({
    q: text.trim().slice(0, MAX_SEARCH_TEXT),
    queue: SEARCH_VIEWS[view as keyof typeof SEARCH_VIEWS],
    priority: priority === null ? 'all' : SEARCH_PRIORITIES[priority as keyof typeof SEARCH_PRIORITIES],
    limit,
  });
}

// --- The conversation the browser sends ---------------------------------------------------------------------------
//
// The browser sends the whole history with each message (the server keeps no conversation). Shape and sizes are
// checked here, before spending anything; `trimHistory` (assistant-agent.ts) then decides how much of it is paid.

export const MAX_SENT_MESSAGES = 40;
export const MAX_MESSAGE_LENGTH = 2000;
/** 40 messages of 2,000 characters are ~80,000; this is the net against the abnormal, not the normal. */
export const MAX_BODY_BYTES = 120_000;

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export function validateConversation(body: unknown): Validation<ChatMessage[]> {
  if (!isObject(body) || !Array.isArray(body.messages)) return fail('Falta la lista de mensajes.');
  const raw = body.messages;
  if (raw.length < 1 || raw.length > MAX_SENT_MESSAGES)
    return fail(`La conversación debe tener entre 1 y ${MAX_SENT_MESSAGES} mensajes.`);
  const out: ChatMessage[] = [];
  for (const item of raw) {
    if (!isObject(item) || (item.role !== 'user' && item.role !== 'assistant') || typeof item.content !== 'string')
      return fail('Cada mensaje necesita un rol y un texto.');
    const text = item.content.trim();
    if (!text) return fail('Hay un mensaje vacío.');
    // What the person types is refused past the maximum. Bita's own answers can be longer and come back as history:
    // refusing them would break the chat until a reload, so they are cut instead.
    if (item.role === 'user' && text.length > MAX_MESSAGE_LENGTH)
      return fail(`Un mensaje no puede pasar de ${MAX_MESSAGE_LENGTH} caracteres.`);
    out.push({ role: item.role, content: item.role === 'assistant' ? text.slice(0, MAX_MESSAGE_LENGTH) : text });
  }
  if (out[out.length - 1].role !== 'user') return fail('El último mensaje debe ser del usuario.');
  return ok(out);
}
