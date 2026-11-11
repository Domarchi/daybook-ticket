/**
 * What leaves towards the Anthropic API, and what never does. Pure module, no database, so it can be tested directly.
 *
 * It is an ALLOW-LIST: every field that travels is written here, one by one. A new ticket column does not reach the
 * model until someone adds it on purpose. Never sent: requester name or email, phone numbers, attachment contents or
 * names, member emails, internal ids other than the ticket number.
 *
 * Ticket text is written by external customers (portal and inbound email) and can carry anything: an email, a phone
 * number, a RUT, a password typed into a "my password does not work" ticket, or an instruction aimed at the model.
 * It is treated as DATA: trimmed, and masked before leaving. Masking is a safety net, not a guarantee (a name in an
 * email signature is not detected); the real protection is that only the fields below are ever sent.
 */
import { isFinished, statusLabel } from './ticket-status';
import type { Message, Ticket, TicketPriority } from './types';

// "contraseña: Hola123", "clave es hola123", "password=abc", "pin 1234", "mi clave: x". The value is the next token.
const SECRET =
  /\b(contrase(?:ñ|n)as?|claves?|password|passwd|pass|pwd|pin|c[oó]digo de (?:verificaci[oó]n|acceso|seguridad)|token)\b(\s*(?:es|era|nueva|actual|temporal)?\s*[:=]?\s*)(\S{3,}?)(?=[.,;:)]?(?:\s|$))/giu;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Query strings often carry tokens (reset links, shared documents): the address stays, the query goes.
const URL_QUERY = /(https?:\/\/[^\s?#]+)[?#][^\s]*/gi;
// A RUT is typed in many ways: «12.345.678-5», «12345678-5», «12.345.678 - 5», «123456785». Any loose number of 8 or
// 9 digits is masked too: losing a long number from the text costs less than sending a RUT or a mobile number.
const RUT =
  /(?<!\d)\d{1,2}\.\d{3}\.\d{3}\s*-?\s*[\dkK](?![\dA-Za-z])|(?<!\d)\d{7,8}\s*-\s*[\dkK](?![\dA-Za-z])|(?<![\dA-Za-z])\d{8,9}(?!\d)|(?<!\d)\d{7,8}[kK](?![\dA-Za-z])/g;
// Chilean mobiles and landlines with separators (+56 9 1234 5678, 9 1234-5678, (2) 2345 6789) and any long
// international number.
const PHONE =
  /(?<![\d])(?:\+?\s?56[\s.-]?)?(?:\(?[29]\)?[\s.-]?\d{4}[\s.-]?\d{4})(?!\d)|\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}(?!\d)/g;

export function maskText(value: string): string {
  // Links first: a "?token=…" inside a URL goes with the query string, not word by word.
  return value
    .replace(URL_QUERY, '$1?[omitido]')
    .replace(SECRET, (_match, word: string, gap: string) => `${word}${gap}[clave omitida]`)
    .replace(EMAIL, '[correo omitido]')
    .replace(PHONE, '[teléfono omitido]')
    .replace(RUT, '[número omitido]');
}

export const MAX_MESSAGE_TEXT = 700;
export const MAX_SOLUTION_TEXT = 600;
export const MAX_ARTICLE_TEXT = 600;

const LOOSE_LETTER: Record<string, string> = {
  a: '[aáà]',
  e: '[eéè]',
  i: '[iíì]',
  o: '[oóò]',
  u: '[uúùü]',
  n: '[nñ]',
};
const plainLetters = (word: string) =>
  word
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/**
 * The requester's own name, wherever it was typed ("Hola, soy Valentina Ortúzar", a signature). Generic masking cannot
 * know a name; the ticket can. Each part of three letters or more is masked on its own, with or without accents.
 */
export function maskPeople(value: string, people: readonly (string | null | undefined)[]): string {
  const parts = new Set<string>();
  for (const person of people)
    for (const word of (person ?? '').split(/[^\p{L}]+/u)) if (word.length >= 3) parts.add(plainLetters(word));
  if (!parts.size) return value;
  const pattern = [...parts]
    .sort((a, b) => b.length - a.length)
    .map(word => [...word].map(letter => LOOSE_LETTER[letter] ?? letter.replace(/[^\p{L}]/gu, '')).join(''))
    .join('|');
  return value.replace(new RegExp(`(?<![\\p{L}])(?:${pattern})(?![\\p{L}])`, 'giu'), '[nombre omitido]');
}

/** Masked, whitespace collapsed, and cut to `max` characters. Anything that is not a string becomes "". `people`
 * are names known to belong to customers of this ticket (its requester). */
export function safeText(
  value: unknown,
  max = MAX_MESSAGE_TEXT,
  people: readonly (string | null | undefined)[] = [],
): string {
  if (typeof value !== 'string') return '';
  const clean = maskPeople(maskText(value), people).replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  urgent: 'urgente',
  high: 'alta',
  normal: 'normal',
  low: 'baja',
};

type Names = { assigneeName?: string | null; companyName?: string | null; requesterName?: string | null };

/** One line per ticket, for lists. No requester, no text. */
export function ticketLine(
  ticket: Pick<Ticket, 'id' | 'subject' | 'status' | 'assigneeMemberId' | 'priority' | 'dueAt' | 'updatedAt'>,
  names: Names = {},
  now = Date.now(),
) {
  const overdue = !isFinished(ticket.status) && Date.parse(ticket.dueAt) < now;
  return {
    numero: ticket.id,
    asunto: safeText(ticket.subject, 120, [names.requesterName]),
    estado: statusLabel(ticket),
    prioridad: PRIORITY_LABEL[ticket.priority] ?? ticket.priority,
    responsable: names.assigneeName ? safeText(names.assigneeName, 60) : null,
    vence: ticket.dueAt,
    vencido: overdue,
    actualizado: ticket.updatedAt,
  };
}

/** The ticket for "sugerir solución": its line plus area and company name. Still no requester. */
export function ticketDetail(ticket: Ticket, names: Names = {}, now = Date.now()) {
  return {
    ...ticketLine(ticket, names, now),
    area: safeText(ticket.department, 60),
    empresa: names.companyName ? safeText(names.companyName, 80) : null,
    creado: ticket.createdAt,
  };
}

const AUTHOR_KIND: Record<string, string> = { request: 'cliente', reply: 'equipo', note: 'nota interna' };

/** A message of the conversation. The customer is "cliente", never by name, and the requester's name is masked in
 * the text too; staff keep their name. */
export function messageForModel(
  message: Pick<Message, 'kind' | 'author' | 'authorRole' | 'body' | 'createdAt'> & {
    attachments?: unknown[];
  },
  people: readonly (string | null | undefined)[] = [],
) {
  const staff = message.kind !== 'request' && message.authorRole !== 'client';
  return {
    tipo: AUTHOR_KIND[message.kind] ?? 'mensaje',
    autor: staff ? safeText(message.author, 60) : 'cliente',
    fecha: message.createdAt,
    texto: safeText(message.body, MAX_MESSAGE_TEXT, staff ? people : [...people, message.author]),
    adjuntos: Array.isArray(message.attachments) ? message.attachments.length : 0,
  };
}
