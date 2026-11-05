import { workspaceDeliveryContext } from './workspace-delivery';
import { createHash, randomUUID } from 'node:crypto';
import type { Database } from '../db/database';
import type { PoolClient } from 'pg';
import { ApiError } from './server';
import { requireAdmin, type AccessContext } from './access';
import { lockAccess } from './ticket-mutations';
import { acquireTicketWorkLock } from './work-lock';
import { cleanupAttachments } from './attachments';
import { receiveInboundEmail, resolveInboundEnvelope, type InboundResult } from './inbound-email';
import { inboundConfiguration, InvalidInboundEmail, normalizeInboundWebhook, type InboundConfiguration, type InboundEnvelope } from './inbound-email-validation';
import { InboundRejectError, InboundRetryError, safeInboundErrorCode } from './inbound-email-errors';
import { inboundAttachmentStorage, type InboundAttachmentStorage } from './inbound-email-storage';

export type InboundJobStatus = 'pending' | 'processing' | 'retry' | 'processed' | 'rejected' | 'failed';
export interface InboundJob {
  providerId: string; ownerId: string; memberId: string; environment: string; envelopeJson: string; envelopeHash: string;
  status: InboundJobStatus; attempts: number; nextAttemptAt: string | null; lastAttemptAt: string | null; lastErrorCode: string | null;
  leaseToken: string | null; leaseUntil: string | null; ticketId: number | null; messageId: number | null;
  manualRetries: number; lastRetryKey: string | null; lastRetriedAt: string | null; createdAt: string; updatedAt: string;
}
const BACKOFF = [60000, 300000, 1800000, 7200000, 28800000];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function inboundEnvelopeHash(envelope: InboundEnvelope): string {
  return createHash('sha256').update(JSON.stringify({ providerId: envelope.providerId, from: envelope.from, to: [...envelope.to].sort(), subject: envelope.subject })).digest('hex');
}
export function classifyInboundFailure(error: unknown): { retryable: boolean; code: string } {
  if (error instanceof InvalidInboundEmail || error instanceof InboundRejectError) return { retryable: false, code: safeInboundErrorCode(error.message) };
  return { retryable: true, code: error instanceof InboundRetryError ? safeInboundErrorCode(error.message) : 'processing_unavailable' };
}
export function publicInboundJob(row: InboundJob) {
  return { providerId: row.providerId, status: row.status, attempts: row.attempts, nextAttemptAt: row.nextAttemptAt,
    lastAttemptAt: row.lastAttemptAt, reasonCode: row.lastErrorCode, ticketId: row.ticketId, messageId: row.messageId,
    manualRetries: row.manualRetries, retryable: ['retry','rejected','failed'].includes(row.status) && row.manualRetries < 3,
    createdAt: row.createdAt, updatedAt: row.updatedAt };
}

/** Called only after signature verification. Persist only a normalized, scoped
 * envelope, never raw MIME, HTML, body, headers, download URLs or credentials. */
export async function enqueueInboundMail(database: Database, envelope: InboundEnvelope, config = inboundConfiguration()): Promise<InboundResult | { status: 'pending'; ownerId: string; ticketId: null; messageId: null; reasonCode: null }> {
  const resolved = await resolveInboundEnvelope(database, envelope, config);
  if ('status' in resolved) return resolved;
  const { source } = resolved, hash = inboundEnvelopeHash(envelope), json = JSON.stringify(envelope);
  if (Buffer.byteLength(json) > 16384) throw new InvalidInboundEmail('invalid_envelope');
  return database.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`daybook-inbound:${envelope.providerId}`]);
    const prior = (await tx.query<InboundJob>('SELECT * FROM "inboundMailJobs" WHERE "providerId"=$1 FOR UPDATE', [envelope.providerId])).rows[0];
    if (prior) {
      if (prior.envelopeHash !== hash || prior.environment !== config.environment || prior.ownerId !== source.ownerId || prior.memberId !== source.id) throw new InvalidInboundEmail('conflicting_provider_id');
      return { status: 'pending' as const, ownerId: source.ownerId, ticketId: null, messageId: null, reasonCode: null };
    }
    const receipt = (await tx.query<InboundResult>('SELECT status,"reasonCode","ownerId","ticketId","messageId" FROM "inboundMailReceipts" WHERE "providerId"=$1 AND "ownerId"=$2 AND environment=$3', [envelope.providerId, source.ownerId, config.environment])).rows[0];
    const now = new Date().toISOString();
    await tx.query(`INSERT INTO "inboundMailJobs" ("providerId","ownerId","memberId",environment,"envelopeJson","envelopeHash",status,"lastErrorCode","ticketId","messageId","createdAt","updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`, [envelope.providerId, source.ownerId, source.id, config.environment, json, hash,
      receipt ? receipt.status === 'processed' ? 'processed' : 'rejected' : 'pending', receipt?.reasonCode || null, receipt?.ticketId || null, receipt?.messageId || null, now]);
    return receipt || { status: 'pending' as const, ownerId: source.ownerId, ticketId: null, messageId: null, reasonCode: null };
  });
}

async function markOrphans(database: Database, ownerId: string, providerId: string) {
  // Separate fresh transaction after a terminal result. A committed receipt or
  // linked attachment wins even if COMMIT's acknowledgement was lost.
  await database.transaction(async tx => {
    await acquireTicketWorkLock(tx, ownerId);
    const job = (await tx.query<InboundJob>('SELECT * FROM "inboundMailJobs" WHERE "providerId"=$1 AND "ownerId"=$2 FOR UPDATE', [providerId, ownerId])).rows[0];
    if (!job || !['failed','rejected'].includes(job.status)) return;
    const receipt = (await tx.query('SELECT status FROM "inboundMailReceipts" WHERE "providerId"=$1 AND status=\'processed\'', [providerId])).rows[0];
    if (receipt) return;
    await tx.query(`UPDATE attachments SET status='deleting',"updatedAt"=$1 WHERE "ownerId"=$2 AND status IN ('reserved','uploaded','ready')
      AND id IN (SELECT "attachmentId" FROM "inboundMailJobFiles" WHERE "providerId"=$3)`, [new Date().toISOString(), ownerId, providerId]);
  });
}

export async function drainInboundMailJobs(ownerId: string, options: {
  database?: Database; config?: InboundConfiguration; maxJobs?: number; maxDurationMs?: number; providerId?: string;
  fetcher?: typeof fetch; storage?: InboundAttachmentStorage;
  receive?: typeof receiveInboundEmail;
} = {}) {
  const config = options.config || inboundConfiguration();
  const summary = { paused: !config.enabled, attempted: 0, processed: 0, rejected: 0, retried: 0, failed: 0 };
  if (!config.enabled) return summary;
  const database = options.database || (await import('../db')).getDatabase();
  if(!(await workspaceDeliveryContext(database,ownerId)).inbound)return {...summary,paused:true};
  const deadline = Date.now() + Math.min(45000, Math.max(1000, options.maxDurationMs || 45000));
  const maxJobs = Math.min(5, Math.max(1, options.maxJobs || 2));
  const touchedMembers = new Set<string>();
  // Expired last-attempt leases cannot remain stuck in processing forever.
  const exhausted = await database.prepare(`WITH expired AS (
    SELECT "providerId" FROM "inboundMailJobs" WHERE "ownerId"=$2 AND environment=$3 AND status='processing' AND "leaseUntil"<=$1 AND attempts>=6
      AND ($4::text IS NULL OR "providerId"=$4) ORDER BY "createdAt" LIMIT 5 FOR UPDATE SKIP LOCKED)
    UPDATE "inboundMailJobs" j SET status='failed',"lastErrorCode"='retry_exhausted',"leaseToken"=NULL,"leaseUntil"=NULL,"updatedAt"=$1
      FROM expired e WHERE j."providerId"=e."providerId" RETURNING j."providerId",j."memberId"`)
    .bind(new Date().toISOString(), ownerId, config.environment, options.providerId || null).all<{ providerId: string; memberId: string }>();
  for (const job of exhausted.results) {
    touchedMembers.add(job.memberId);
    await markOrphans(database, ownerId, job.providerId);
    summary.failed++;
  }
  for (let index = 0; index < maxJobs && Date.now() + 500 < deadline; index++) {
    const now = new Date().toISOString(), leaseToken = randomUUID(), until = new Date(Date.now() + 300000).toISOString();
    const job = await database.prepare(`WITH candidate AS (
      SELECT "providerId" FROM "inboundMailJobs" WHERE "ownerId"=$1 AND environment=$2 AND attempts<6 AND ($6::text IS NULL OR "providerId"=$6)
        AND ((status IN ('pending','retry') AND ("nextAttemptAt" IS NULL OR "nextAttemptAt"<=$3)) OR (status='processing' AND "leaseUntil"<=$3))
      ORDER BY "createdAt","providerId" LIMIT 1 FOR UPDATE SKIP LOCKED)
      UPDATE "inboundMailJobs" j SET status='processing',attempts=attempts+1,"lastAttemptAt"=$3,"leaseToken"=$4,"leaseUntil"=$5,"updatedAt"=$3
      FROM candidate c WHERE j."providerId"=c."providerId" RETURNING j.*`).bind(ownerId, config.environment, now, leaseToken, until, options.providerId || null).first<InboundJob>();
    if (!job) break;
    touchedMembers.add(job.memberId);
    summary.attempted++;
    try {
      const receipt = await database.prepare('SELECT status,"reasonCode","ownerId","ticketId","messageId" FROM "inboundMailReceipts" WHERE "providerId"=$1 AND "ownerId"=$2 AND environment=$3')
        .bind(job.providerId, ownerId, config.environment).first<InboundResult>();
      let result = receipt;
      if (!result) {
        const stored = JSON.parse(job.envelopeJson) as InboundEnvelope;
        const envelope = normalizeInboundWebhook(Buffer.from(JSON.stringify({ type: 'email.received', created_at: stored.createdAt,
          data: { email_id: stored.providerId, from: stored.from, to: stored.to, subject: stored.subject } })), stored.webhookId);
        if (!envelope || envelope.providerId !== job.providerId || inboundEnvelopeHash(envelope) !== job.envelopeHash) throw new InvalidInboundEmail('invalid_envelope');
        result = await (options.receive || receiveInboundEmail)(database, envelope, { config, deadline,
          lease: { providerId: job.providerId, leaseToken }, fetcher: options.fetcher, storage: options.storage });
      }
      const terminal = result.status === 'processed' ? 'processed' : 'rejected';
      await database.prepare(`UPDATE "inboundMailJobs" SET status=$1,"lastErrorCode"=$2,"ticketId"=$3,"messageId"=$4,
        "nextAttemptAt"=NULL,"leaseToken"=NULL,"leaseUntil"=NULL,"updatedAt"=$5 WHERE "providerId"=$6 AND "ownerId"=$7 AND status='processing' AND "leaseToken"=$8`)
        .bind(terminal, result.reasonCode ? safeInboundErrorCode(result.reasonCode) : null, result.ticketId, result.messageId, new Date().toISOString(), job.providerId, ownerId, leaseToken).run();
      summary[terminal]++;
      if (terminal === 'rejected') await markOrphans(database, ownerId, job.providerId);
    } catch (error) {
      const classified = classifyInboundFailure(error);
      const status = !classified.retryable ? 'rejected' : job.attempts >= 6 ? 'failed' : 'retry';
      const retryAt = status === 'retry' ? new Date(Date.now() + BACKOFF[Math.min(job.attempts - 1, BACKOFF.length - 1)]).toISOString() : null;
      await database.prepare(`UPDATE "inboundMailJobs" SET status=$1,"lastErrorCode"=$2,"nextAttemptAt"=$3,
        "leaseToken"=NULL,"leaseUntil"=NULL,"updatedAt"=$4 WHERE "providerId"=$5 AND "ownerId"=$6 AND status='processing' AND "leaseToken"=$7`)
        .bind(status, classified.code, retryAt, new Date().toISOString(), job.providerId, ownerId, leaseToken).run();
      if (status === 'retry') summary.retried++; else summary[status]++;
      if (status !== 'retry') await markOrphans(database, ownerId, job.providerId);
    }
  }
  // Include retired reservations from earlier attempts, even after a later
  // attempt succeeded. draftId retains their job scope after mapping replacement.
  if (Date.now() + 1000 < deadline) {
    const cutoff = new Date(Date.now() - 360000).toISOString();
    const orphans = await database.prepare(`SELECT DISTINCT a."memberId" FROM attachments a JOIN "inboundMailJobs" j
      ON j."providerId"=a."draftId" AND j."ownerId"=a."ownerId" AND j."memberId"=a."memberId"
      WHERE a."ownerId"=$1 AND ($3::text IS NULL OR j."providerId"=$3) AND ((a.status='deleting' AND a."updatedAt"<$2)
        OR (a.status IN ('reserved','uploaded','ready') AND a."expiresAt"<$2)) LIMIT 5`).bind(ownerId, cutoff, options.providerId || null).all<{ memberId: string }>();
    for (const row of orphans.results) touchedMembers.add(row.memberId);
  }
  // Existing cleanup handles unlinked expired reservations and terminal orphans.
  for (const memberId of touchedMembers) {
    if (Date.now() + 1000 < deadline) {
      try { await cleanupAttachments(ownerId, memberId, 5, database, options.storage || inboundAttachmentStorage(deadline)); } catch { /* Deferred safely. */ }
    }
  }
  return summary;
}

export async function drainInboundMailBestEffort(ownerId: string, options: Parameters<typeof drainInboundMailJobs>[1] = {}) {
  try { return await drainInboundMailJobs(ownerId, options); }
  catch { return { paused: !inboundConfiguration().enabled, attempted: 0, processed: 0, rejected: 0, retried: 0, failed: 0, unavailable: true }; }
}

export async function retryInboundMailJob(database: Database, access: AccessContext, providerId: string, retryKey: string) {
  if (!UUID.test(providerId) || !UUID.test(retryKey)) throw new InvalidInboundEmail('invalid_provider_id');
  return database.transaction(async tx => {
    await acquireTicketWorkLock(tx, access.ownerId);
    requireAdmin(await lockAccess(tx, access));
    const row = (await tx.query<InboundJob>('SELECT * FROM "inboundMailJobs" WHERE "providerId"=$1 AND "ownerId"=$2 AND environment=$3 FOR UPDATE', [providerId, access.ownerId, inboundConfiguration().environment])).rows[0];
    if (!row) return null;
    const hash = createHash('sha256').update(JSON.stringify(['inbound_retry', providerId, row.environment])).digest('hex');
    const operation = (await tx.query<{ ownerId: string; memberId: string; kind: string; requestHash: string }>('SELECT "ownerId","memberId",kind,"requestHash" FROM operations WHERE "operationId"=$1 FOR UPDATE', [retryKey])).rows[0];
    if (operation) {
      if (operation.ownerId !== access.ownerId || operation.memberId !== access.member.id || operation.kind !== 'inbound_retry' || operation.requestHash !== hash) throw new ApiError(409, 'Esta operación pertenece a otro reintento.');
      return publicInboundJob(row);
    }
    const remember = async (saved: InboundJob) => {
      const result = publicInboundJob(saved);
      await tx.query(`INSERT INTO operations ("operationId","ownerId","memberId",kind,"requestHash","resultJson","createdAt") VALUES ($1,$2,$3,'inbound_retry',$4,$5,$6)`,
      [retryKey, access.ownerId, access.member.id, hash, JSON.stringify(result), new Date().toISOString()]);
      return result;
    };
    if (row.lastRetryKey === retryKey || ['processed','processing','pending'].includes(row.status)) return remember(row);
    if (row.manualRetries >= 3) throw new InboundRejectError('manual_retry_limit');
    // A processed receipt is authoritative even if a previous acknowledgement
    // or job finalization was lost. Never turn it back into pending work.
    const receipt = (await tx.query<InboundResult>('SELECT status,"reasonCode","ownerId","ticketId","messageId" FROM "inboundMailReceipts" WHERE "providerId"=$1 AND "ownerId"=$2', [providerId, access.ownerId])).rows[0];
    if (receipt?.status === 'processed') {
      const saved = (await tx.query<InboundJob>(`UPDATE "inboundMailJobs" SET status='processed',"lastErrorCode"=NULL,"ticketId"=$1,"messageId"=$2,"updatedAt"=$3 WHERE "providerId"=$4 RETURNING *`, [receipt.ticketId, receipt.messageId, new Date().toISOString(), providerId])).rows[0];
      return remember(saved);
    }
    // Rejected receipts represent a deliberate prior authorization/content
    // decision and remain immutable; retries will report that same decision.
    const now = new Date().toISOString();
    const saved = (await tx.query<InboundJob>(`UPDATE "inboundMailJobs" SET status='pending',attempts=0,"nextAttemptAt"=NULL,"lastErrorCode"=NULL,
      "leaseToken"=NULL,"leaseUntil"=NULL,"manualRetries"="manualRetries"+1,"lastRetryKey"=$1,"lastRetriedAt"=$2,"updatedAt"=$2 WHERE "providerId"=$3 RETURNING *`, [retryKey, now, providerId])).rows[0];
    return remember(saved);
  });
}

export async function inboundMailHealth(database: Database, ownerId: string, environment = inboundConfiguration().environment, tx?: PoolClient) {
  const query = async <T>(sql: string) => tx ? (await tx.query<T & Record<string, unknown>>(sql, [ownerId, environment])).rows
    : (await database.prepare(sql).bind(ownerId, environment).all<T>()).results;
  const [jobs, totals] = await Promise.all([
    query<InboundJob>(`SELECT "providerId",status,attempts,"nextAttemptAt","lastAttemptAt","lastErrorCode","ticketId","messageId",
      "manualRetries","createdAt","updatedAt" FROM "inboundMailJobs" WHERE "ownerId"=$1 AND environment=$2 ORDER BY "createdAt" DESC,"providerId" DESC LIMIT 25`),
    query<{ status: InboundJobStatus; total: number; oldest: string; latest: string }>(`SELECT status,count(*)::int AS total,min("createdAt") AS oldest,max("updatedAt") AS latest FROM "inboundMailJobs" WHERE "ownerId"=$1 AND environment=$2 GROUP BY status`),
  ]);
  const counts = { pending: 0, processing: 0, retry: 0, processed: 0, rejected: 0, failed: 0 };
  for (const row of totals) counts[row.status] = row.total;
  return { jobs: jobs.map(publicInboundJob), health: { counts,
    oldestPendingAt: totals.filter(row => ['pending','processing','retry'].includes(row.status)).map(row => row.oldest).sort()[0] || null,
    lastProcessedAt: totals.find(row => row.status === 'processed')?.latest || null,
    lastFailureAt: totals.filter(row => ['failed','retry'].includes(row.status)).map(row => row.latest).sort().at(-1) || null } };
}
