import type { PoolClient } from 'pg';
import type { Database } from '../db/database';
import { publicMember, type AccessContext, type MemberRecord } from './access';
import { acquireTicketWorkLock } from './work-lock';
import { getSettingsInTransaction } from './settings-transaction';
import { getEffectiveServicePolicy } from './service-policies';
import { resolutionDeadline } from './ticket-sla';
import { chooseAutomaticAssignee } from './automatic-assignment';
import { eligibleRecipients, lockTicket, publicReplyRecipients, recordAutomaticAssignmentEvent, recordEvent, staffNotificationRecipients } from './ticket-mutations';
import { notificationStatements } from './mail';
import { withoutQuotedDaybookLogos } from './inbound-email-logo';
import {
  InvalidInboundEmail, inboundConfiguration, inboundPayloadHash, inboundRejection, normalizeReceivedEmail,
  parseInboundRoute, validInboundRoute, type InboundConfiguration, type InboundEnvelope, type InboundRoute, type ReceivedEmail,
} from './inbound-email-validation';

export interface InboundResult { status: 'processed' | 'ignored'; reasonCode: string | null; ownerId: string | null; ticketId: number | null; messageId: number | null; duplicate?: boolean }
type Source = MemberRecord & { sourceTicketId?: number; sourceCreatedAt?: string; sourcePayloadJson?: string | null; sourceEnvironment?: string | null; sourceEvent?: string; sourceTemplateVersion?: number };
type Receipt = InboundResult & { payloadHash: string; environment: string };
const RESPONSE_LIMIT = 2 * 1024 * 1024;

/** Fixed provider endpoint, bounded bytes and time, no redirects or arbitrary
 * sender-provided URLs. html_format=cid avoids inline base64 amplification. */
export async function retrieveInboundEmail(providerId: string, config = inboundConfiguration(), fetcher: typeof fetch = fetch): Promise<unknown> {
  if (!/^[a-f0-9-]{36}$/i.test(providerId)) throw new InvalidInboundEmail('invalid_provider_id');
  const response = await fetcher(`https://api.resend.com/emails/receiving/${providerId}?html_format=cid`, {
    headers: { Authorization: `Bearer ${config.apiKey}` }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Inbound provider unavailable');
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > RESPONSE_LIMIT)) throw new InvalidInboundEmail('provider_response_too_large');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Inbound provider unavailable');
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > RESPONSE_LIMIT) { await reader.cancel(); throw new InvalidInboundEmail('provider_response_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total))); }
  catch { throw new InvalidInboundEmail('invalid_provider_json'); }
}

async function sourceFor(database: Database, route: InboundRoute): Promise<Source | null> {
  if (route.kind === 'new') return database.prepare(`SELECT m.* FROM members m JOIN organizations o ON o.id=m."organizationId" AND o."ownerId"=m."ownerId"
    WHERE m.id=$1 AND o.id='daybook'`).bind(route.id).first<Source>();
  return database.prepare(`SELECT m.*, o."ticketId" AS "sourceTicketId",o."createdAt" AS "sourceCreatedAt",o."payloadJson" AS "sourcePayloadJson",
    o.environment AS "sourceEnvironment",o.event AS "sourceEvent",o."templateVersion" AS "sourceTemplateVersion"
    FROM "mailOutbox" o JOIN members m ON m.id=o."recipientMemberId" AND m."ownerId"=o."ownerId"
    JOIN organizations org ON org.id=m."organizationId" AND org."ownerId"=m."ownerId"
    WHERE o.id=$1 AND org.id='daybook'`).bind(route.id).first<Source>();
}

async function writeReceipt(tx: PoolClient, envelope: InboundEnvelope, hash: string, config: InboundConfiguration, source: Source, result: InboundResult, now: string) {
  await tx.query(`INSERT INTO "inboundMailReceipts" ("providerId",environment,"payloadHash","ownerId","memberId","ticketId","messageId",status,"reasonCode","createdAt","updatedAt")
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
  [envelope.providerId, config.environment, hash, source.ownerId, source.id, result.ticketId, result.messageId, result.status, result.reasonCode, now]);
}

function ignored(reasonCode: string, ownerId: string | null = null): InboundResult {
  return { status: 'ignored', reasonCode, ownerId, ticketId: null, messageId: null };
}

/** One transaction owns the receipt, authorization, mutation and notifications.
 * Owner-wide locking uses the same order as portal creation/assignment, so
 * concurrent provider retries cannot create duplicate tickets or messages. */
export async function ingestInboundEmail(database: Database, envelope: InboundEnvelope, email: ReceivedEmail, route: InboundRoute,
  source: Source, config = inboundConfiguration(), now = new Date()): Promise<InboundResult> {
  const hash = inboundPayloadHash(email), timestamp = now.toISOString();
  return database.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`daybook-inbound:${envelope.providerId}`]);
    await acquireTicketWorkLock(tx, source.ownerId);
    const prior = (await tx.query<Receipt>('SELECT status,"reasonCode","ownerId","ticketId","messageId","payloadHash",environment FROM "inboundMailReceipts" WHERE "providerId"=$1 FOR UPDATE', [envelope.providerId])).rows[0];
    if (prior) {
      if (prior.payloadHash !== hash || prior.environment !== config.environment) throw new InvalidInboundEmail('conflicting_provider_id');
      return { status: prior.status, reasonCode: prior.reasonCode, ownerId: prior.ownerId, ticketId: prior.ticketId, messageId: prior.messageId, duplicate: true };
    }
    const row = (await tx.query<Source>('SELECT * FROM members WHERE id=$1 AND "ownerId"=$2 AND "organizationId"=$3 FOR NO KEY UPDATE', [source.id, source.ownerId, source.organizationId])).rows[0];
    let rejection = inboundRejection(email);
    if (!row || row.status !== 'active' || row.role !== 'client' || !row.userId) rejection = 'inactive_client';
    else if (row.email.toLowerCase() !== email.from || !validInboundRoute(route, { ownerId: row.ownerId, memberId: row.id, email: row.email }, config)) rejection = 'sender_changed';
    if (!rejection) {
      const recent = (await tx.query<{ total: number }>('SELECT count(*)::int AS total FROM "inboundMailReceipts" WHERE "ownerId"=$1 AND "memberId"=$2 AND status=\'processed\' AND "createdAt">=$3',
        [source.ownerId, source.id, new Date(now.getTime() - 3600000).toISOString()])).rows[0];
      if (recent.total >= 60) rejection = 'hourly_limit';
    }
    if (rejection) {
      const result = ignored(rejection, source.ownerId);
      await writeReceipt(tx, envelope, hash, config, source, result, timestamp); return result;
    }
    const access: AccessContext = { ownerId: row.ownerId, organizationId: row.organizationId, member: publicMember({ ...row, hasAccount: true }), role: 'client', userId: row.userId! };
    const settings = await getSettingsInTransaction(tx, access.ownerId);
    let ticket;
    if (route.kind === 'new') {
      const department = settings.departments[0];
      if (!department) throw new Error('Inbound department unavailable');
      const assignment = await chooseAutomaticAssignee(tx, access.ownerId, { customerCompanyId: row.customerCompanyId, department }, timestamp);
      const policy = await getEffectiveServicePolicy(tx, access.ownerId, row.customerCompanyId, settings.slaHours);
      const subject = email.subject.trim().slice(0, 160) || 'Solicitud recibida por correo';
      ticket = (await tx.query(`INSERT INTO tickets ("ownerId","creationKey",subject,"requesterName","requesterEmail","requesterMemberId","customerCompanyId",department,assignee,"assigneeMemberId",status,priority,"createdAt","updatedAt","dueAt","slaPolicySnapshot","slaStartedAt")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'open','normal',$11,$11,$12,$13,$11) RETURNING *`,
      [access.ownerId, `inbound:${config.environment}:${envelope.providerId}`, subject, row.name, row.email, row.id, row.customerCompanyId, department,
        assignment?.name || '', assignment?.id || null, timestamp, resolutionDeadline(timestamp, 'normal', policy), JSON.stringify(policy)])).rows[0];
      await recordEvent(tx, access, ticket.id, 'created', null, 'open');
      if (assignment) await recordAutomaticAssignmentEvent(tx, access.ownerId, ticket.id, assignment);
    } else {
      try { ticket = await lockTicket(tx, access, source.sourceTicketId!); }
      catch (error) {
        if (error instanceof Error && 'status' in error && error.status === 404) {
          const result = ignored('ticket_access_revoked', source.ownerId);
          await writeReceipt(tx, envelope, hash, config, source, result, timestamp); return result;
        }
        throw error;
      }
      const reopen = ticket.status === 'resolved';
      const policy = reopen ? await getEffectiveServicePolicy(tx, access.ownerId, ticket.customerCompanyId, settings.slaHours) : null;
      await tx.query(`UPDATE tickets SET "updatedAt"=$1,version=version+1,status=$2,"dueAt"=$3,"slaPolicySnapshot"=$4,"slaStartedAt"=$5 WHERE id=$6 AND "ownerId"=$7`,
        [timestamp, reopen ? 'open' : ticket.status, policy ? resolutionDeadline(timestamp, ticket.priority, policy) : ticket.dueAt,
          policy ? JSON.stringify(policy) : ticket.slaPolicySnapshot || null, reopen ? timestamp : ticket.slaStartedAt || null, ticket.id, access.ownerId]);
      if (reopen) await recordEvent(tx, access, ticket.id, 'status', 'resolved', 'open');
    }
    const message = (await tx.query(`INSERT INTO messages ("ownerId","ticketId",author,"authorMemberId","authorRole",body,kind,"createdAt")
      VALUES ($1,$2,$3,$4,'client',$5,$6,$7) RETURNING id`, [access.ownerId, ticket.id, row.name, row.id, email.text, route.kind === 'new' ? 'request' : 'reply', timestamp])).rows[0];
    const staff = await staffNotificationRecipients(tx, access, ticket.assigneeMemberId, settings);
    const recipients = route.kind === 'new' ? await eligibleRecipients(tx, access, ticket, staff) : await publicReplyRecipients(tx, access, ticket, staff);
    for (const recipientMemberId of recipients) for (const statement of notificationStatements(database, {
      ownerId: access.ownerId, event: route.kind === 'new' ? 'ticket_created' : 'client_replied', eventKey: `inbound:${envelope.providerId}`, recipientMemberId, ticketId: ticket.id,
    })) await database.execute(statement, tx);
    const result: InboundResult = { status: 'processed', reasonCode: null, ownerId: access.ownerId, ticketId: ticket.id, messageId: message.id };
    await writeReceipt(tx, envelope, hash, config, source, result, timestamp); return result;
  });
}

export async function receiveInboundEmail(database: Database, envelope: InboundEnvelope, options: {
  config?: InboundConfiguration; retrieve?: (id: string) => Promise<unknown>; now?: Date;
} = {}): Promise<InboundResult> {
  const config = options.config || inboundConfiguration(), now = options.now || new Date();
  if (!config.enabled) return ignored('disabled');
  const routes = envelope.to.map(address => parseInboundRoute(address, config)).filter(route => route !== null);
  if (routes.length !== 1) return ignored(routes.length ? 'ambiguous_recipient' : 'foreign_recipient');
  const route = routes[0], source = await sourceFor(database, route);
  if (!source || !validInboundRoute(route, { ownerId: source.ownerId, memberId: source.id, email: source.email }, config)) return ignored('unknown_route');
  if (envelope.from !== source.email.toLowerCase()) return ignored('sender_mismatch');
  if (route.kind === 'reply') {
    let payload;
    try { payload = JSON.parse(source.sourcePayloadJson || 'null'); } catch { return ignored('invalid_route'); }
    if (source.sourceEnvironment !== config.environment || source.sourceTemplateVersion !== 3 || source.sourceEvent !== 'agent_replied'
      || !source.sourceTicketId || payload?.reply_to !== route.address || !source.sourceCreatedAt
      || !Number.isFinite(Date.parse(source.sourceCreatedAt)) || Date.parse(source.sourceCreatedAt) > now.getTime() + 300000
      || Date.parse(source.sourceCreatedAt) + 90 * 86400000 <= now.getTime()) return ignored('expired_route');
  }
  const data = await (options.retrieve || (id => retrieveInboundEmail(id, config)))(envelope.providerId);
  const parsedEmail = normalizeReceivedEmail(data, envelope);
  const email = source.status === 'active' && source.role === 'client' && inboundRejection(parsedEmail) === 'attachments_use_portal'
    ? await withoutQuotedDaybookLogos(parsedEmail, config) : parsedEmail;
  return ingestInboundEmail(database, envelope, email, route, source, config, now);
}
