import { ECDH } from 'node:crypto';
import { z } from 'zod';

/** Only browser push services may receive a server-side HTTP request. */
export function isPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    if (value.length > 2048 || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
    const host = url.hostname;
    return host === 'fcm.googleapis.com'
      || host === 'updates.push.services.mozilla.com'
      || host === 'web.push.apple.com'
      || /^[a-z0-9-]+\.notify\.windows\.com$/.test(host);
  } catch { return false; }
}

function isKey(value: string, length: number, curve = false): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== length || bytes.toString('base64url') !== value) return false;
  if (!curve) return true;
  if (bytes[0] !== 4) return false;
  try { ECDH.convertKey(bytes, 'prime256v1'); return true; } catch { return false; }
}

export const pushEndpointSchema = z.string().max(2048).refine(isPushEndpoint, 'El navegador no entregó una dirección de avisos compatible.');
export const pushSubscriptionSchema = z.object({
  endpoint: pushEndpointSchema,
  expirationTime: z.number().finite().nullable().optional(),
  keys: z.object({
    p256dh: z.string().length(87).refine(value => isKey(value, 65, true), 'La clave del navegador no es válida.'),
    auth: z.string().length(22).refine(value => isKey(value, 16), 'La clave del navegador no es válida.'),
  }).strict(),
}).strict();

export type BrowserPushSubscription = z.infer<typeof pushSubscriptionSchema>;
export const PUSH_EVENTS = ['ticket_created', 'agent_replied', 'client_replied', 'member_mentioned', 'ticket_followed_update'] as const;
export function classifyPushFailure(error: unknown): 'expired_subscription' | 'provider_unavailable' | 'provider_rejected' {
  const status = error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : 0;
  if (status === 404 || status === 410) return 'expired_subscription';
  if (!status || status === 408 || status === 429 || status >= 500) return 'provider_unavailable';
  return 'provider_rejected';
}
