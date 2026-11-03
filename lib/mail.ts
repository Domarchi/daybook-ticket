import { getDatabase } from '../db';
import type { Database, DatabaseValue, PreparedStatement } from '../db/database';

export type NotificationEvent = 'ticket_created' | 'agent_replied' | 'client_replied' | 'invitation' | 'password_reset';
export type NotificationStatus = 'awaiting_configuration' | 'queued' | 'processing' | 'accepted' | 'failed' | 'unknown' | 'cancelled';
export interface MailStatus {
  configured: boolean;
  sender: string | null;
  counts: Record<NotificationStatus, number>;
  lastError?: string;
}
type MailPayload = { from: string; to: string[]; subject: string; text: string };
type OutboxRow = {
  id: string; ownerId: string; event: NotificationEvent; recipientMemberId: string;
  ticketId: number | null; payloadJson: string | null; status: NotificationStatus;
  actionUrl: string | null; expiresAt: string | null;
  attempts: number; firstAttemptAt: string | null; leaseUntil: string | null;
};
type Recipient = { id: string; userId: string | null; email: string; role: string; status: string };
const MAX_ATTEMPTS = 6;
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
const RETRY_DELAYS = [60, 300, 1800, 7200, 28800];
const STATUSES: NotificationStatus[] = ['awaiting_configuration', 'queued', 'processing', 'accepted', 'failed', 'unknown', 'cancelled'];
const EVENTS: NotificationEvent[] = ['ticket_created', 'agent_replied', 'client_replied', 'invitation', 'password_reset'];

function database(): Database {
  return getDatabase();
}
function configuration() {
  const values = process.env;
  const apiKey = values.RESEND_API_KEY?.trim() || '';
  const rawSender = values.DAYBOOK_EMAIL_FROM?.trim() || '';
  const sender = !/[\r\n]/.test(rawSender) && /^(?:[^<>]+\s*<)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(rawSender) ? rawSender : null;
  let siteUrl: string | null = null;
  try {
    const url = new URL(values.DAYBOOK_SITE_URL || '');
    if (url.protocol === 'https:' && !url.username && !url.password) siteUrl = url.origin;
  } catch { /* An absent or invalid URL is unconfigured, never inferred from a request. */ }
  return { apiKey, sender, siteUrl, configured: Boolean(apiKey && sender && siteUrl) };
}

/** Add these statements to the SAME transaction as the ticket/message/member change. */
export function notificationStatements(db: Database, input: {
  ownerId: string; event: NotificationEvent; eventKey: string; recipientMemberId: string;
  ticketId?: number; ticketCreationKey?: string; invitationId?: string; actionUrl?: string; expiresAt?: string;
}): PreparedStatement[] {
  if (!EVENTS.includes(input.event)) throw new Error('Unsupported notification event');
  const now = new Date().toISOString();
  const values: DatabaseValue[] = [];
  const param = (value: DatabaseValue) => { values.push(value); return `$${values.length}`; };
  const id = param(crypto.randomUUID());
  const owner = param(input.ownerId);
  const eventKey = param(`${input.event}:${input.eventKey}:${input.recipientMemberId}`);
  const event = param(input.event);
  const recipient = param(input.recipientMemberId);
  const ticketExpression = input.ticketCreationKey
    ? `(SELECT id FROM tickets WHERE "creationKey" = ${param(input.ticketCreationKey)} AND "ownerId" = ${param(input.ownerId)})`
    : param(input.ticketId ?? null);
  return [db.prepare(`INSERT INTO "mailOutbox"
    (id, "ownerId", "eventKey", event, "recipientMemberId", "ticketId", "invitationId", "actionUrl", "expiresAt", "payloadJson", status, attempts, "createdAt", "updatedAt")
    VALUES (${id}, ${owner}, ${eventKey}, ${event}, ${recipient}, ${ticketExpression},
      ${param(input.invitationId ?? null)}, ${param(input.actionUrl ?? null)}, ${param(input.expiresAt ?? null)},
      NULL, ${param(configuration().configured ? 'queued' : 'awaiting_configuration')}, 0, ${param(now)}, ${param(now)})
    ON CONFLICT("eventKey") DO NOTHING`).bind(...values)];
}

function errorMessage(code: string): string {
  const messages: Record<string, string> = {
    invalid_configuration: 'Revisa la configuración del proveedor de correo.',
    invalid_recipient: 'El destinatario ya no tiene acceso o su correo cambió.',
    invalid_payload: 'La notificación no contiene un mensaje válido.',
    invalid_idempotent_request: 'El proveedor detectó un cambio en un envío anterior. Revisión manual necesaria.',
    daily_quota_exceeded: 'Se alcanzó la cuota diaria del proveedor.',
    monthly_quota_exceeded: 'Se alcanzó la cuota mensual del proveedor.',
    rate_limit_exceeded: 'El proveedor pidió reducir la frecuencia. Se reintentará.',
    retry_exhausted: 'Se agotaron los reintentos. El resultado del envío necesita revisión.',
    idempotency_expired: 'El resultado anterior es incierto y venció el plazo seguro de reintento.',
    provider_unavailable: 'El proveedor no respondió correctamente. Se reintentará.',
    provider_rejected: 'El proveedor rechazó el correo. Revisa el remitente y los destinatarios.',
    action_expired: 'El enlace de acceso expiró antes de enviarse. Genera uno nuevo.',
  };
  return messages[code] || 'No se pudo procesar una notificación de correo.';
}

export async function getMailStatus(ownerId: string): Promise<MailStatus> {
  const db = database();
  const config = configuration();
  const [totals, lastError] = await Promise.all([
    db.prepare("SELECT status, COUNT(*)::integer AS total FROM \"mailOutbox\" WHERE \"ownerId\" = $1 GROUP BY status").bind(ownerId).all<{ status: NotificationStatus; total: number }>(),
    db.prepare("SELECT \"lastErrorCode\" FROM \"mailOutbox\" WHERE \"ownerId\" = $1 AND \"lastErrorCode\" IS NOT NULL AND status != 'cancelled' ORDER BY \"updatedAt\" DESC LIMIT 1").bind(ownerId).first<{ lastErrorCode: string }>(),
  ]);
  const counts = Object.fromEntries(STATUSES.map(status => [status, 0])) as Record<NotificationStatus, number>;
  for (const row of totals.results) if (STATUSES.includes(row.status)) counts[row.status] = row.total;
  return { configured: config.configured, sender: config.sender, counts, ...(lastError ? { lastError: errorMessage(lastError.lastErrorCode) } : {}) };
}

export async function listNotifications(ownerId: string) {
  return (await database().prepare("SELECT o.id, o.event, o.\"ticketId\", o.status, o.attempts, o.\"providerId\",\n      o.\"createdAt\", o.\"updatedAt\", o.\"nextAttemptAt\", o.\"lastErrorCode\", m.email AS \"recipientEmail\"\n    FROM \"mailOutbox\" o LEFT JOIN members m ON m.id = o.\"recipientMemberId\" AND m.\"ownerId\" = o.\"ownerId\"\n    WHERE o.\"ownerId\" = $1 ORDER BY o.\"createdAt\" DESC LIMIT 50").bind(ownerId).all<{
      id: string; event: NotificationEvent; ticketId: number | null; status: NotificationStatus;
      attempts: number; providerId: string | null; createdAt: string; updatedAt: string;
      nextAttemptAt: string | null; lastErrorCode: string | null; recipientEmail: string | null;
    }>()).results.map(({ lastErrorCode, ...row }) => ({ ...row, error: lastErrorCode ? errorMessage(lastErrorCode) : null }));
}

async function recipientFor(db: Database, row: OutboxRow): Promise<Recipient | null> {
  const member = await db.prepare("SELECT id, \"userId\", email, role, status FROM members WHERE id = $1 AND \"ownerId\" = $2")
    .bind(row.recipientMemberId, row.ownerId).first<Recipient>();
  if (!member || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(member.email)) return null;
  if (row.event === 'invitation') return member.status === 'invited' ? member : null;
  if (row.event === 'password_reset') return member.status === 'active' ? member : null;
  if (member.status !== 'active' || !row.ticketId) return null;
  const ticket = await db.prepare("SELECT \"requesterMemberId\" FROM tickets WHERE id = $1 AND \"ownerId\" = $2")
    .bind(row.ticketId, row.ownerId).first<{ requesterMemberId: string | null }>();
  if (!ticket) return null;
  if (member.role === 'client' && member.id !== ticket.requesterMemberId) return null;
  if (!['client', 'owner', 'admin', 'agent'].includes(member.role)) return null;
  return member;
}

function makePayload(row: OutboxRow, recipient: Recipient, from: string, siteUrl: string): MailPayload | null {
  const label = row.ticketId ? `Ticket #${row.ticketId}` : 'Daybook Ticket';
  const messages: Record<NotificationEvent, string> = {
    ticket_created: `${label} fue creado. Puedes consultar su estado y responder desde Daybook Ticket.`,
    agent_replied: `${label} tiene una nueva respuesta del equipo de soporte.`,
    client_replied: `${label} tiene una nueva respuesta del cliente.`,
    invitation: 'Te han dado acceso a Daybook Ticket, un servicio Daybook. Inicia sesión con este mismo correo para entrar.',
    password_reset: 'Solicitaste restablecer tu contraseña de Daybook Ticket. Usa el enlace para elegir una nueva. Si no lo solicitaste, puedes ignorar este correo.',
  };
  let url = new URL('/', siteUrl);
  if (row.ticketId) url.searchParams.set('ticket', String(row.ticketId));
  if (row.event === 'invitation' || row.event === 'password_reset') {
    if (!row.actionUrl || !row.expiresAt || !Number.isFinite(Date.parse(row.expiresAt))) return null;
    try { url = new URL(row.actionUrl); } catch { return null; }
    if (url.origin !== new URL(siteUrl).origin || url.username || url.password) return null;
  }
  return {
    from, to: [recipient.email],
    subject: row.event === 'invitation' ? 'Tu acceso a Daybook Ticket'
      : row.event === 'password_reset' ? 'Restablecer contraseña · Daybook Ticket' : `${label} · Daybook Ticket`,
    text: `${messages[row.event]}\n\nAbrir Daybook Ticket: ${url.toString()}\n\nResponde desde el portal. Las respuestas a este correo no se incorporan al ticket.`,
  };
}

function readPayload(text: string): MailPayload | null {
  try {
    const data = JSON.parse(text) as MailPayload;
    if (typeof data.from !== 'string' || typeof data.subject !== 'string' || typeof data.text !== 'string'
      || !Array.isArray(data.to) || data.to.length !== 1 || typeof data.to[0] !== 'string') return null;
    return data;
  } catch { return null; }
}

async function finish(db: Database, row: OutboxRow, status: NotificationStatus, code: string | null, nextAttemptAt: string | null = null, providerId: string | null = null) {
  await db.prepare("UPDATE \"mailOutbox\" SET status = $1, \"lastErrorCode\" = $2, \"nextAttemptAt\" = $3, \"providerId\" = COALESCE($4, \"providerId\"),\n    \"leaseUntil\" = NULL, \"updatedAt\" = $5 WHERE id = $6 AND \"ownerId\" = $7 AND status = 'processing' AND \"leaseUntil\" = $8")
    .bind(status, code, nextAttemptAt, providerId, new Date().toISOString(), row.id, row.ownerId, row.leaseUntil).run();
}

async function retry(db: Database, row: OutboxRow, code: string, retryAfterSeconds = 0) {
  const firstAttempt = Date.parse(row.firstAttemptAt || '');
  const delay = Math.max(RETRY_DELAYS[row.attempts - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1], retryAfterSeconds);
  const nextTime = Date.now() + delay * 1000;
  if (row.attempts >= MAX_ATTEMPTS || !Number.isFinite(firstAttempt) || nextTime >= firstAttempt + IDEMPOTENCY_WINDOW_MS - 60000) {
    await finish(db, row, 'unknown', 'retry_exhausted');
    return;
  }
  await finish(db, row, 'queued', code, new Date(nextTime).toISOString());
}

/** Opportunistic delivery. A separate scheduler is required for retries while nobody visits the app. */
export async function processOutbox(ownerId: string, limit = 5) {
  const config = configuration();
  const summary = { configured: config.configured, processed: 0, accepted: 0 };
  if (!config.configured || !config.sender || !config.siteUrl) return summary;
  const db = database();
  const now = new Date().toISOString();
  const candidates = await db.prepare("SELECT id FROM \"mailOutbox\" WHERE \"ownerId\" = $1\n    AND (\"nextAttemptAt\" IS NULL OR \"nextAttemptAt\" <= $2)\n    AND (status IN ('queued', 'awaiting_configuration') OR (status = 'processing' AND \"leaseUntil\" <= $3))\n    ORDER BY \"createdAt\" ASC LIMIT $4").bind(ownerId, now, now, Math.min(10, Math.max(1, Math.floor(limit)))).all<{ id: string }>();

  for (const candidate of candidates.results) {
    const claimTime = new Date().toISOString();
    const leaseUntil = new Date(Date.now() + 90000).toISOString();
    const row = await db.prepare("UPDATE \"mailOutbox\" SET status = 'processing', \"leaseUntil\" = $1, \"updatedAt\" = $2\n      WHERE id = $3 AND \"ownerId\" = $4 AND (\"nextAttemptAt\" IS NULL OR \"nextAttemptAt\" <= $5)\n      AND (status IN ('queued', 'awaiting_configuration') OR (status = 'processing' AND \"leaseUntil\" <= $6)) RETURNING *")
      .bind(leaseUntil, claimTime, candidate.id, ownerId, claimTime, claimTime).first<OutboxRow>();
    if (!row) continue;
    summary.processed++;
    if (!EVENTS.includes(row.event)) { await finish(db, row, 'failed', 'invalid_payload'); continue; }
    if (row.expiresAt && (!Number.isFinite(Date.parse(row.expiresAt)) || Date.parse(row.expiresAt) <= Date.now())) {
      await finish(db, row, 'cancelled', 'action_expired'); continue;
    }
    if (row.firstAttemptAt && Date.now() >= Date.parse(row.firstAttemptAt) + IDEMPOTENCY_WINDOW_MS - 60000) {
      await finish(db, row, 'unknown', 'idempotency_expired'); continue;
    }
    if (row.attempts >= MAX_ATTEMPTS) { await finish(db, row, 'unknown', 'retry_exhausted'); continue; }
    const recipient = await recipientFor(db, row);
    if (!recipient) { await finish(db, row, 'cancelled', 'invalid_recipient'); continue; }
    const payload = row.payloadJson ? readPayload(row.payloadJson) : makePayload(row, recipient, config.sender, config.siteUrl);
    if (!payload) { await finish(db, row, 'failed', 'invalid_payload'); continue; }
    if (payload.to[0] !== recipient.email) { await finish(db, row, 'cancelled', 'invalid_recipient'); continue; }
    const attemptAt = new Date().toISOString();
    const attempt = await db.prepare("UPDATE \"mailOutbox\" SET \"payloadJson\" = COALESCE(\"payloadJson\", $1), attempts = attempts + 1,\n      \"firstAttemptAt\" = COALESCE(\"firstAttemptAt\", $2), \"updatedAt\" = $3\n      WHERE id = $4 AND \"ownerId\" = $5 AND status = 'processing' AND \"leaseUntil\" = $6")
      .bind(JSON.stringify(payload), attemptAt, attemptAt, row.id, ownerId, leaseUntil).run();
    if (attempt.meta.changes !== 1) continue;
    row.attempts++;
    row.firstAttemptAt ||= attemptAt;
    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `daybook-ticket/${row.id}` },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(10000),
      });
    } catch {
      await retry(db, row, 'provider_unavailable'); continue;
    }
    const body: unknown = await response.json().catch(() => null);
    const result = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    if (response.ok && typeof result.id === 'string' && result.id.length <= 160) {
      await finish(db, row, 'accepted', null, null, result.id);
      summary.accepted++;
      continue;
    }
    const code = typeof result.name === 'string' ? result.name : '';
    if (code === 'daily_quota_exceeded' || code === 'monthly_quota_exceeded' || code === 'invalid_idempotent_request') {
      await finish(db, row, 'failed', code); continue;
    }
    if (response.ok || response.status >= 500 || response.status === 429 || code === 'concurrent_idempotent_requests') {
      const rawRetryAfter = response.headers.get('retry-after') || '';
      const seconds = /^\d+$/.test(rawRetryAfter) ? Number(rawRetryAfter) : Math.max(0, (Date.parse(rawRetryAfter) - Date.now()) / 1000);
      await retry(db, row, response.status === 429 ? 'rate_limit_exceeded' : 'provider_unavailable', Number.isFinite(seconds) ? seconds : 0);
      continue;
    }
    await finish(db, row, 'failed', [401, 403].includes(response.status) ? 'invalid_configuration' : 'provider_rejected');
  }
  return summary;
}

/** Never let provider or outbox failures turn an already committed ticket into a failed request. */
export async function processOutboxBestEffort(ownerId: string) {
  try { return await processOutbox(ownerId, 2); }
  catch { console.error('Daybook Ticket notification processing unavailable'); return { configured: configuration().configured, processed: 0, accepted: 0 }; }
}

/** Authentication reset emails also use the durable outbox; never include passwords or raw tokens in logs. */
export async function enqueueAuthEmail(db: Database, ownerId: string, memberId: string, url: string, event: 'password_reset' = 'password_reset', expiresAt = new Date(Date.now() + 3600000).toISOString()) {
  await db.batch(notificationStatements(db, {
    ownerId, recipientMemberId: memberId, event, eventKey: crypto.randomUUID(), actionUrl: url, expiresAt,
  }));
  return processOutboxBestEffort(ownerId);
}
