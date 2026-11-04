import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { MailEnvironment } from './mail-templates';

export const DELIVERY_EVENT_TYPES = ['email.sent', 'email.delivery_delayed', 'email.delivered', 'email.bounced', 'email.complained', 'email.failed', 'email.suppressed'] as const;
export type DeliveryEventType = typeof DELIVERY_EVENT_TYPES[number];
export type DeliveryStatus = 'untracked' | 'sent' | 'delayed' | 'delivered' | 'bounced' | 'complained' | 'failed' | 'suppressed';
export interface DeliveryState {
  deliveryStatus: DeliveryStatus; deliveryEventAt: string | null; deliveredAt: string | null;
  bouncedAt: string | null; complainedAt: string | null; deliveryErrorCode: string | null;
}
export interface DeliveryReceipt {
  id: string; providerId: string; eventType: DeliveryEventType; occurredAt: string;
  receivedAt: string; payloadHash: string; outboxId: string | null;
  environment: MailEnvironment | null; from: string; to: string[];
}
export class InvalidDeliveryWebhook extends Error {}
const BODY_LIMIT = 256 * 1024;

/** Bounds actual streamed bytes as Content-Length can be absent or inaccurate. */
export async function readWebhookBody(request: Request): Promise<Buffer> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > BODY_LIMIT)) throw new InvalidDeliveryWebhook('Body exceeds limit');
  const reader = request.body?.getReader();
  if (!reader) throw new InvalidDeliveryWebhook('Missing body');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > BODY_LIMIT) { await reader.cancel(); throw new InvalidDeliveryWebhook('Body exceeds limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}

/** Svix signs id.timestamp.raw-body using the base64-decoded whsec_ key.
 * Reference: https://docs.svix.com/receiving/verifying-payloads/how-manual */
export function verifyDeliverySignature(raw: Buffer, headers: Headers, secret: string, now = Date.now()): string {
  const id = headers.get('svix-id') || '';
  const timestamp = headers.get('svix-timestamp') || '';
  const signatures = headers.get('svix-signature') || '';
  const key = secret.startsWith('whsec_') ? secret.slice(6) : '';
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id) || !/^\d{1,12}$/.test(timestamp) || signatures.length > 4096
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(key) || key.length > 1024) throw new InvalidDeliveryWebhook('Invalid signature');
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) throw new InvalidDeliveryWebhook('Expired timestamp');
  const keyBytes = Buffer.from(key, 'base64');
  if (keyBytes.length < 16 || keyBytes.toString('base64').replace(/=+$/, '') !== key.replace(/=+$/, '')) throw new InvalidDeliveryWebhook('Invalid secret');
  const expected = createHmac('sha256', keyBytes).update(`${id}.${timestamp}.`).update(raw).digest();
  let matches = false;
  for (const candidate of signatures.split(/\s+/).slice(0, 20)) {
    if (!/^v1,[A-Za-z0-9+/]{43}=$/.test(candidate)) continue;
    const actual = Buffer.from(candidate.slice(3), 'base64');
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) matches = true;
  }
  if (!matches) throw new InvalidDeliveryWebhook('Invalid signature');
  return id;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function mailAddress(value: string): string | null {
  const match = /^(?:[^<>\r\n]+\s*<)?([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>?$/.exec(value.trim());
  return match ? match[1].toLowerCase() : null;
}

export function normalizeDeliveryWebhook(raw: Buffer, id: string, environment: MailEnvironment, now = new Date()): DeliveryReceipt | null {
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw new InvalidDeliveryWebhook('Invalid JSON'); }
  const body = record(parsed);
  if (!body || typeof body.type !== 'string') throw new InvalidDeliveryWebhook('Invalid event');
  // Open/click events are deliberately neither tracked nor retained.
  if (!(DELIVERY_EVENT_TYPES as readonly string[]).includes(body.type)) return null;
  const data = record(body.data);
  if (!data || typeof data.email_id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(data.email_id)
    || typeof body.created_at !== 'string' || !Number.isFinite(Date.parse(body.created_at))
    || Date.parse(body.created_at) > now.getTime() + 300_000) throw new InvalidDeliveryWebhook('Invalid delivery event');
  const tags = record(data.tags);
  // A shared Resend account also sends mail for other projects. Explicitly
  // foreign tags are ignored even if a provider id happens to be familiar.
  if (tags && ((tags.app !== undefined && tags.app !== 'daybook_ticket')
    || (tags.environment !== undefined && tags.environment !== environment))) return null;
  const hasScope = tags?.app === 'daybook_ticket' && tags.environment === environment;
  const outboxId = hasScope && typeof tags.outbox_id === 'string' && /^[a-f0-9-]{36}$/i.test(tags.outbox_id) ? tags.outbox_id : null;
  // Incomplete tags must not become unscoped orphan receipts.
  if (tags && ('app' in tags || 'environment' in tags || 'outbox_id' in tags) && !outboxId) return null;
  const from = typeof data.from === 'string' ? mailAddress(data.from) : null;
  const to = Array.isArray(data.to) && data.to.length === 1 && typeof data.to[0] === 'string' ? mailAddress(data.to[0]) : null;
  if (!from || !to) throw new InvalidDeliveryWebhook('Invalid delivery recipient');
  return { id, providerId: data.email_id, eventType: body.type as DeliveryEventType,
    occurredAt: new Date(body.created_at).toISOString(), receivedAt: now.toISOString(),
    payloadHash: createHash('sha256').update(raw).digest('hex'), outboxId,
    environment: hasScope ? environment : null, from, to: [to] };
}

const EVENT_STATUS: Record<DeliveryEventType, Exclude<DeliveryStatus, 'untracked'>> = {
  'email.sent': 'sent', 'email.delivery_delayed': 'delayed', 'email.delivered': 'delivered',
  'email.bounced': 'bounced', 'email.complained': 'complained', 'email.failed': 'failed', 'email.suppressed': 'suppressed',
};
const RANK: Record<DeliveryStatus, number> = { untracked: 0, sent: 1, delayed: 2, delivered: 3, failed: 4, suppressed: 5, bounced: 6, complained: 7 };
const error = (status: DeliveryStatus) => ({ delayed: 'delivery_delayed', bounced: 'recipient_bounced', complained: 'recipient_complained', failed: 'delivery_failed', suppressed: 'recipient_suppressed' } as Partial<Record<DeliveryStatus, string>>)[status] ?? null;

/** Order-independent, monotone projection. A delayed/sent receipt cannot undo a
 * delivery, bounce or complaint, regardless of webhook arrival order. */
export function projectDeliveryEvents(events: readonly { eventType: DeliveryEventType; occurredAt: string }[]): DeliveryState {
  const result: DeliveryState = { deliveryStatus: 'untracked', deliveryEventAt: null, deliveredAt: null, bouncedAt: null, complainedAt: null, deliveryErrorCode: null };
  for (const event of events) {
    const status = EVENT_STATUS[event.eventType];
    if (!status || !Number.isFinite(Date.parse(event.occurredAt))) continue;
    const earliest = (old: string | null) => old && old < event.occurredAt ? old : event.occurredAt;
    if (status === 'delivered') result.deliveredAt = earliest(result.deliveredAt);
    if (status === 'bounced') result.bouncedAt = earliest(result.bouncedAt);
    if (status === 'complained') result.complainedAt = earliest(result.complainedAt);
    if (RANK[status] > RANK[result.deliveryStatus] || (status === result.deliveryStatus && event.occurredAt > (result.deliveryEventAt || ''))) {
      result.deliveryStatus = status; result.deliveryEventAt = event.occurredAt; result.deliveryErrorCode = error(status);
    }
  }
  return result;
}
