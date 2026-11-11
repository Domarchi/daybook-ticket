import { isTicketQueue, type TicketQueue } from './ticket-status';
export interface TicketSearchQuery {
  q: string;
  queue: TicketQueue;
  priority: 'all' | 'urgent' | 'high' | 'normal' | 'low';
  department: string;
  company: string;
  agent: string;
  limit: number;
  cursor: string | null;
}
export interface TicketCursor {
  at: string;
  id: number;
}
export class SearchQueryError extends Error {}

/** A cursor only bounds an already authorized query; it never grants access. */
export function encodeTicketCursor(cursor: TicketCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
export function decodeTicketCursor(value: string | null): TicketCursor | null {
  if (!value) return null;
  if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new SearchQueryError('La página solicitada no es válida.');
  try {
    const item = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as TicketCursor;
    if (
      !item ||
      typeof item.at !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T/.test(item.at) ||
      !Number.isFinite(Date.parse(item.at)) ||
      !Number.isSafeInteger(item.id) ||
      item.id < 1
    )
      throw new Error();
    return { at: item.at, id: item.id };
  } catch {
    throw new SearchQueryError('La página solicitada no es válida.');
  }
}
export function parseSearchLimit(value: string | null): number {
  if (value === null) return 50;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100)
    throw new SearchQueryError('El tamaño de página debe estar entre 1 y 100.');
  return Number(value);
}
export function parseTicketSearch(params: URLSearchParams): TicketSearchQuery {
  const q = (params.get('q') ?? '').trim();
  if (q.length > 200) throw new SearchQueryError('La búsqueda admite hasta 200 caracteres.');
  const queue = params.get('queue') ?? 'all';
  const priority = params.get('priority') ?? 'all';
  if (!isTicketQueue(queue)) throw new SearchQueryError('Selecciona una vista válida.');
  if (!['all', 'urgent', 'high', 'normal', 'low'].includes(priority))
    throw new SearchQueryError('Selecciona una prioridad válida.');
  const field = (name: string) => {
    const value = params.get(name) ?? 'all';
    if (!value || value.length > 160 || /[\u0000-\u001f]/.test(value))
      throw new SearchQueryError('Uno de los filtros no es válido.');
    return value;
  };
  const cursor = params.get('cursor');
  decodeTicketCursor(cursor);
  return {
    q,
    queue: queue as TicketSearchQuery['queue'],
    priority: priority as TicketSearchQuery['priority'],
    department: field('department'),
    company: field('company'),
    agent: field('agent'),
    limit: parseSearchLimit(params.get('limit')),
    cursor,
  };
}
export function literalSearchPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, '\\$&')}%`;
}
