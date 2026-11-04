import { z } from 'zod';
import type { TicketAlert } from './types';

const isoDate = z.string().datetime();
export const alertCursorSchema = z.object({ createdAt: isoDate, id: z.string().uuid() }).strict();
export type AlertCursor = z.infer<typeof alertCursorSchema>;
export interface AlertsQuery { filter: 'all' | 'unread'; cursor?: AlertCursor; limit: number }
export const markAlertsSchema = z.union([
  z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);

export function parseAlertsQuery(params: URLSearchParams): AlertsQuery {
  const filter = z.enum(['all', 'unread']).parse(params.get('filter') || 'all');
  const limit = z.coerce.number().int().min(1).max(50).parse(params.get('limit') || '20');
  const encoded = params.get('cursor');
  let cursor: AlertCursor | undefined;
  if (encoded) {
    if (encoded.length > 512) throw new z.ZodError([{ code: 'custom', path: ['cursor'], message: 'La página de avisos no es válida.' }]);
    try { cursor = alertCursorSchema.parse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))); }
    catch { throw new z.ZodError([{ code: 'custom', path: ['cursor'], message: 'La página de avisos no es válida.' }]); }
  }
  return { filter, limit, cursor };
}

export function encodeAlertCursor(item: Pick<TicketAlert, 'createdAt' | 'id'>): string {
  return Buffer.from(JSON.stringify({ createdAt: item.createdAt, id: item.id })).toString('base64url');
}
