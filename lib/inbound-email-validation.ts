import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mailAddress } from './mail-delivery-validation';
import type { MailEnvironment } from './mail-templates';
import { normalizeInboundBody } from './inbound-email-content';

export class InvalidInboundEmail extends Error {}
export type InboundRouteKind = 'new' | 'reply';
export interface InboundConfiguration {
  enabled: boolean; domain: string | null; tokenSecret: string; apiKey: string; webhookSecret: string;
  webhookMode: 'independent' | 'shared' | null;
  environment: MailEnvironment;
}
export interface InboundRoute { kind: InboundRouteKind; id: string; signature: string; address: string }
export interface InboundEnvelope {
  providerId: string; webhookId: string; from: string; to: string[]; subject: string; createdAt: string;
}
export interface ReceivedEmail {
  id: string; from: string; to: string[]; subject: string; text: string; headers: Record<string, string>;
  attachments: { id: string; name: string; contentType: string; size: number; disposition?: string | null }[];
  authenticated: boolean;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function inboundConfiguration(env: Record<string, string | undefined> = process.env): InboundConfiguration {
  const rawDomain = (env.DAYBOOK_INBOUND_DOMAIN || '').trim().toLowerCase();
  const domain = DOMAIN.test(rawDomain) ? rawDomain : null;
  const tokenSecret = (env.DAYBOOK_INBOUND_TOKEN_SECRET || '').trim();
  const apiKey = (env.RESEND_INBOUND_API_KEY || '').trim();
  const rawMode = env.DAYBOOK_INBOUND_WEBHOOK_MODE || 'independent';
  const webhookMode = rawMode === 'independent' || rawMode === 'shared' ? rawMode : null;
  // Sharing the existing endpoint is explicit. It never changes API credentials.
  const webhookSecret = ((webhookMode === 'shared' ? env.RESEND_WEBHOOK_SECRET : env.RESEND_INBOUND_WEBHOOK_SECRET) || '').trim();
  const signingKey = webhookSecret.startsWith('whsec_') ? webhookSecret.slice(6) : '';
  const signingBytes = /^[A-Za-z0-9+/]+={0,2}$/.test(signingKey) ? Buffer.from(signingKey, 'base64') : Buffer.alloc(0);
  const validSigningKey = signingKey.length <= 1024 && signingBytes.length >= 16
    && signingBytes.toString('base64').replace(/=+$/, '') === signingKey.replace(/=+$/, '');
  const environment = env.DAYBOOK_NOTIFICATION_ENVIRONMENT === 'production' || env.DAYBOOK_NOTIFICATION_ENVIRONMENT === 'qa'
    ? env.DAYBOOK_NOTIFICATION_ENVIRONMENT : env.VERCEL_ENV === 'production' ? 'production' : 'qa';
  return { enabled: env.DAYBOOK_INBOUND_ENABLED === 'true' && Boolean(webhookMode && domain && tokenSecret.length >= 32 && /^[A-Za-z0-9_-]{8,512}$/.test(apiKey) && validSigningKey), domain, tokenSecret, apiKey, webhookSecret, webhookMode, environment };
}

function digest(scope: { kind: InboundRouteKind; id: string; ownerId: string; memberId: string; email: string }, config: InboundConfiguration) {
  return createHmac('sha256', config.tokenSecret).update(JSON.stringify([
    'daybook-inbound-v1', scope.kind, scope.id.toLowerCase(), scope.ownerId, scope.memberId,
    scope.email.toLowerCase(), config.environment, config.domain,
  ])).digest('hex').slice(0, 24);
}

/** An opaque, recipient-bound capability, never a subject or ticket-number match.
 * The 59-character local part fits email's 64-character limit. */
export function makeInboundAddress(scope: { kind: InboundRouteKind; id: string; ownerId: string; memberId: string; email: string }, config = inboundConfiguration()): string | null {
  if (!config.enabled || !config.domain || !UUID.test(scope.id)) return null;
  return `${scope.kind === 'new' ? 'n' : 'r'}-${scope.id.replaceAll('-', '').toLowerCase()}-${digest(scope, config)}@${config.domain}`;
}

export function parseInboundRoute(address: string, config = inboundConfiguration()): InboundRoute | null {
  const normalized = mailAddress(address);
  if (!config.enabled || !normalized || !config.domain) return null;
  const [local, domain] = normalized.split('@');
  if (domain !== config.domain) return null;
  const match = /^([nr])-([a-f0-9]{32})-([a-f0-9]{24})$/.exec(local);
  if (!match) return null;
  const rawId = match[2];
  const id = `${rawId.slice(0, 8)}-${rawId.slice(8, 12)}-${rawId.slice(12, 16)}-${rawId.slice(16, 20)}-${rawId.slice(20)}`;
  return { kind: match[1] === 'n' ? 'new' : 'reply', id, signature: match[3], address: normalized };
}

export function validInboundRoute(route: InboundRoute, scope: { ownerId: string; memberId: string; email: string }, config = inboundConfiguration()): boolean {
  const expected = digest({ ...scope, kind: route.kind, id: route.id }, config);
  return route.signature.length === expected.length && timingSafeEqual(Buffer.from(route.signature), Buffer.from(expected));
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function addresses(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return null;
  const result = value.map(address => typeof address === 'string' ? mailAddress(address) : null);
  return result.every(Boolean) ? [...new Set(result as string[])] : null;
}

export function decodeInboundWebhook(raw: Buffer): Record<string, unknown> {
  let decoded: unknown;
  try { decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw new InvalidInboundEmail('invalid_json'); }
  const parsed = object(decoded);
  if (!parsed || typeof parsed.type !== 'string') throw new InvalidInboundEmail('invalid_event');
  return parsed;
}

export function normalizeInboundWebhookEvent(parsed: Record<string, unknown>, webhookId: string, now = new Date()): InboundEnvelope | null {
  if (parsed.type !== 'email.received') return null;
  const data = object(parsed.data);
  const from = typeof data?.from === 'string' ? mailAddress(data.from) : null;
  const to = addresses(data?.to);
  if (!data || typeof data.email_id !== 'string' || !UUID.test(data.email_id) || !from || !to
    || typeof data.subject !== 'string' || data.subject.length > 1000 || /[\r\n\0]/.test(data.subject)
    || typeof parsed.created_at !== 'string' || !Number.isFinite(Date.parse(parsed.created_at))
    || Date.parse(parsed.created_at) > now.getTime() + 300_000) throw new InvalidInboundEmail('invalid_envelope');
  return { providerId: data.email_id.toLowerCase(), webhookId, from, to, subject: data.subject, createdAt: new Date(parsed.created_at).toISOString() };
}

export function normalizeInboundWebhook(raw: Buffer, webhookId: string, now = new Date()): InboundEnvelope | null {
  return normalizeInboundWebhookEvent(decodeInboundWebhook(raw), webhookId, now);
}

/** HTML is converted to inert text only; it is never stored or rendered as HTML. */
export function htmlToInboundText(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[0-9a-f]{1,6}|[0-9]{1,7});/gi, entity => {
      const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };
      if (named[entity.toLowerCase()] !== undefined) return named[entity.toLowerCase()];
      const code = entity.toLowerCase().startsWith('&#x') ? Number.parseInt(entity.slice(3, -1), 16) : Number.parseInt(entity.slice(2, -1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
    }).replace(/\n[\t ]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function unquotedInboundText(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const quote = lines.findIndex(line => /^\s*>/.test(line) || /^\s*(?:On .{1,500} wrote:|El .{1,500} escribi[oó]:|-{2,}\s*(?:Original Message|Mensaje original)\s*-{2,})\s*$/i.test(line));
  return (quote < 0 ? lines : lines.slice(0, quote)).join('\n').trim();
}

export function normalizeReceivedEmail(value: unknown, envelope: InboundEnvelope): ReceivedEmail {
  const data = object(value);
  const from = typeof data?.from === 'string' ? mailAddress(data.from) : null;
  const to = addresses(data?.to);
  if (!data || data.id !== envelope.providerId || from !== envelope.from || !to
    || to.length !== envelope.to.length || to.some(address => !envelope.to.includes(address))
    || typeof data.subject !== 'string' || data.subject !== envelope.subject) throw new InvalidInboundEmail('provider_mismatch');
  const rawHeaders = object(data.headers) || {};
  const headers: Record<string, string> = {};
  if (Object.keys(rawHeaders).length > 200) throw new InvalidInboundEmail('headers_too_large');
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (typeof value !== 'string' || key.length > 160 || value.length > 4000) throw new InvalidInboundEmail('invalid_headers');
    headers[key.toLowerCase()] = value;
  }
  if (typeof data.text !== 'string' && data.text !== null && data.text !== undefined) throw new InvalidInboundEmail('invalid_text');
  if (typeof data.html !== 'string' && data.html !== null && data.html !== undefined) throw new InvalidInboundEmail('invalid_html');
  const text = normalizeInboundBody(data.text as string | null | undefined, data.html as string | null | undefined);
  if (text.length > 20000 || /\0/.test(text)) throw new InvalidInboundEmail('message_too_large');
  if (!Array.isArray(data.attachments) || data.attachments.length > 100) throw new InvalidInboundEmail('invalid_attachments');
  const attachments = data.attachments.map(value => {
    const item = object(value);
    if (!item || typeof item.id !== 'string' || !UUID.test(item.id) || typeof item.filename !== 'string' || item.filename.length > 255
      || typeof item.content_type !== 'string' || !Number.isSafeInteger(item.size) || Number(item.size) < 0) throw new InvalidInboundEmail('invalid_attachments');
    return { id: item.id, name: item.filename, contentType: item.content_type, size: Number(item.size), disposition: typeof item.content_disposition === 'string' ? item.content_disposition : null };
  });
  if (new Set(attachments.map(file => file.id)).size !== attachments.length) throw new InvalidInboundEmail('invalid_attachments');
  // This is Resend's structured receiving-server verdict fetched from its API.
  // Never trust an Authentication-Results header supplied by the sender.
  const authentication = object(data.authentication);
  const authenticated = authentication?.dmarc === 'pass' || (authentication?.dmarc === 'gray' && authentication.dkim === 'pass');
  return { id: envelope.providerId, from: from!, to, subject: data.subject, text, headers, attachments, authenticated };
}

export function inboundRejection(email: ReceivedEmail, allowAttachments = false): string | null {
  if (!email.authenticated) return 'authentication_required';
  if ((email.headers['auto-submitted'] && email.headers['auto-submitted'].trim().toLowerCase() !== 'no')
    || /^(?:bulk|junk|list)$/i.test(email.headers.precedence?.trim() || '') || email.headers['list-id']
    || /multipart\/report/i.test(email.headers['content-type'] || '') || email.headers['return-path']?.trim() === '<>') return 'automatic_message';
  if (!email.text && !(allowAttachments && email.attachments.length)) return 'empty_message';
  if (!allowAttachments && email.attachments.length) return 'attachments_use_portal';
  return null;
}

export function inboundPayloadHash(email: ReceivedEmail): string {
  return createHash('sha256').update(JSON.stringify({ ...email, headers: Object.fromEntries(Object.entries(email.headers).sort(([a], [b]) => a.localeCompare(b))) })).digest('hex');
}
