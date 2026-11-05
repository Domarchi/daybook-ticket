import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Database } from '../db/database';
import { canAccessTicket, type MemberRecord } from './access';
import { acquireTicketWorkLock } from './work-lock';
import { attachmentFileInfo, AttachmentValidationError, MAX_ATTACHMENT_BYTES, validateAttachment } from './attachments-validation';
import { attachmentStorageConfig, readAttachmentBytes } from './attachments-storage';
import type { AttachmentRow } from './attachments';
import { boundedInboundBytes, inboundAssetUrl, inboundTimeout } from './inbound-email-assets';
import { InboundRejectError, InboundRetryError } from './inbound-email-errors';
import { inboundAttachmentStorage, type InboundAttachmentStorage } from './inbound-email-storage';
import { validInboundRoute, type InboundConfiguration, type InboundRoute, type ReceivedEmail } from './inbound-email-validation';

export interface InboundLease { providerId: string; leaseToken: string }
export interface InboundImport { ids: string[]; draftId: string; kind: 'request' | 'reply'; lease: InboundLease }
type FileBytes = { providerId: string; name: string; contentType: string; size: number; hash: string; bytes: Buffer };

export async function assertInboundLease(tx: PoolClient, ownerId: string, lease: InboundLease, now = new Date().toISOString()) {
  const row = (await tx.query(`SELECT "providerId" FROM "inboundMailJobs" WHERE "providerId"=$1 AND "ownerId"=$2
    AND status='processing' AND "leaseToken"=$3 AND "leaseUntil">$4 FOR UPDATE`, [lease.providerId, ownerId, lease.leaseToken, now])).rows[0];
  if (!row) throw new InboundRetryError('lease_lost');
}

/** Fixed authenticated API and exact provider-CDN paths, sequential downloads,
 * streamed byte limits, and the same actual-content validator as portal files. */
export async function downloadInboundAttachments(email: ReceivedEmail, config: InboundConfiguration, fetcher: typeof fetch = fetch, deadline = Date.now() + 45000): Promise<FileBytes[]> {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (!uuid.test(email.id) || email.attachments.some(file => !uuid.test(file.id)) || new Set(email.attachments.map(file => file.id)).size !== email.attachments.length) throw new InboundRejectError('attachment_invalid');
  if (email.attachments.length > 5) throw new InboundRejectError('attachment_limit');
  const files: FileBytes[] = [];
  for (const file of email.attachments) {
    if (file.size < 1 || file.size > MAX_ATTACHMENT_BYTES) throw new InboundRejectError('attachment_limit');
    try { attachmentFileInfo(file.name); } catch { throw new InboundRejectError('attachment_invalid'); }
    const response = await fetcher(`https://api.resend.com/emails/receiving/${email.id}/attachments/${file.id}`, {
      headers: { Authorization: `Bearer ${config.apiKey}` }, cache: 'no-store', redirect: 'error', signal: inboundTimeout(deadline),
    });
    let metadata;
    try { metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await boundedInboundBytes(response, 32768))); }
    catch { throw new InboundRetryError('provider_unavailable'); }
    if (metadata?.id !== file.id || metadata.filename !== file.name || metadata.size !== file.size || metadata.content_type !== file.contentType
      || (metadata.content_disposition ?? null) !== (file.disposition ?? null)) throw new InboundRejectError('attachment_changed');
    const url = inboundAssetUrl(metadata.download_url, email.id, file.id);
    const bytes = await boundedInboundBytes(await fetcher(url.toString(), { cache: 'no-store', redirect: 'error', signal: inboundTimeout(deadline) }), file.size);
    let validated;
    try { validated = await validateAttachment(bytes, file.name, file.size); }
    catch (error) { if (error instanceof AttachmentValidationError) throw new InboundRejectError('attachment_invalid'); throw error; }
    inboundTimeout(deadline);
    files.push({ providerId: file.id, ...validated, bytes, hash: createHash('sha256').update(bytes).digest('hex') });
  }
  return files;
}

export async function prepareInboundAttachments(database: Database, email: ReceivedEmail, source: MemberRecord, route: InboundRoute,
  config: InboundConfiguration, lease: InboundLease, ticketId: number | null,
  options: { fetcher?: typeof fetch; storage?: InboundAttachmentStorage; deadline?: number } = {}): Promise<InboundImport> {
  const deadline = options.deadline || Date.now() + 45000, files = await downloadInboundAttachments(email, config, options.fetcher, deadline);
  const store = options.storage || inboundAttachmentStorage(deadline);
  const kind = route.kind === 'new' ? 'request' : 'reply';
  const rows = await database.transaction(async tx => {
    await acquireTicketWorkLock(tx, source.ownerId);
    await assertInboundLease(tx, source.ownerId, lease);
    const member = (await tx.query<MemberRecord>('SELECT * FROM members WHERE id=$1 AND "ownerId"=$2 FOR NO KEY UPDATE', [source.id, source.ownerId])).rows[0];
    if (!member || member.status !== 'active' || member.role !== 'client' || !member.userId || member.email.toLowerCase() !== email.from
      || !validInboundRoute(route, { ownerId: member.ownerId, memberId: member.id, email: member.email }, config)) throw new InboundRejectError('inactive_client');
    if (ticketId) {
      const ticket = (await tx.query('SELECT "ownerId","requesterMemberId","customerCompanyId" FROM tickets WHERE id=$1 AND "ownerId"=$2 FOR SHARE', [ticketId, source.ownerId])).rows[0];
      if (!ticket || !canAccessTicket({ ownerId: source.ownerId, role: member.role, member }, ticket)) throw new InboundRejectError('ticket_access_revoked');
    }
    const mappings = (await tx.query<AttachmentRow & { providerAttachmentId: string; sha256: string }>(`SELECT a.*,f."providerAttachmentId",f.sha256 FROM "inboundMailJobFiles" f
      JOIN attachments a ON a.id=f."attachmentId" WHERE f."providerId"=$1 ORDER BY a.id FOR UPDATE OF a`, [email.id])).rows;
    if (mappings.some(row => !files.some(file => file.providerId === row.providerAttachmentId && file.hash === row.sha256))) throw new InboundRejectError('attachment_changed');
    const pending = (await tx.query<{ total: number; bytes: number }>(`SELECT count(*)::int AS total,COALESCE(sum(size),0)::float8 AS bytes FROM attachments
      WHERE "ownerId"=$1 AND "memberId"=$2 AND status NOT IN ('attached','deleted')`, [source.ownerId, source.id])).rows[0];
    const missing = files.filter(file => !mappings.some(row => row.providerAttachmentId === file.providerId && !['deleting','deleted'].includes(row.status)));
    if (pending.total + missing.length > 10 || pending.bytes + missing.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024) throw new InboundRetryError('pending_attachment_quota');
    const result: (AttachmentRow & { providerAttachmentId: string; sha256: string })[] = [];
    const now = new Date().toISOString(), expiry = new Date(Date.now() + 86400000).toISOString();
    for (const file of files) {
      let row = mappings.find(item => item.providerAttachmentId === file.providerId);
      if (row && ['deleting','deleted'].includes(row.status)) row = undefined;
      if (row) {
        if (row.memberId !== source.id || row.ownerId !== source.ownerId || row.draftId !== email.id || row.kind !== kind
          || row.status === 'attached' || row.status === 'deleting' || row.status === 'deleted' || row.size !== file.size
          || row.name !== file.name || row.contentType !== file.contentType || row.ticketId !== ticketId) throw new InboundRejectError('attachment_changed');
        await tx.query('UPDATE attachments SET "expiresAt"=$1,"updatedAt"=$2 WHERE id=$3', [expiry, now, row.id]);
      } else {
        const id = randomUUID(), pathname = `daybook/${attachmentStorageConfig()?.environment || config.environment}/${randomUUID()}/${id}.bin`;
        row = (await tx.query<AttachmentRow & { providerAttachmentId: string; sha256: string }>(`INSERT INTO attachments
          (id,"ownerId","memberId","draftId","ticketId",kind,pathname,name,"contentType",size,status,"expiresAt","createdAt","updatedAt")
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'reserved',$11,$12,$12) RETURNING *`,
        [id, source.ownerId, source.id, email.id, ticketId, kind, pathname, file.name, file.contentType, file.size, expiry, now])).rows[0];
        await tx.query(`INSERT INTO "inboundMailJobFiles" ("providerId","providerAttachmentId","attachmentId",sha256,"createdAt") VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT ("providerId","providerAttachmentId") DO UPDATE SET "attachmentId"=EXCLUDED."attachmentId"`, [email.id, file.providerId, id, file.hash, now]);
      }
      result.push({ ...row, providerAttachmentId: file.providerId, sha256: file.hash });
    }
    return result;
  });
  for (const row of rows) {
    const file = files.find(item => item.providerId === row.providerAttachmentId && item.hash === row.sha256)!;
    inboundTimeout(deadline);
    let stored: Buffer | null;
    try { stored = await readAttachmentBytes(store, row.pathname, row.size); }
    catch { throw new InboundRetryError('storage_unavailable'); }
    if (!stored) {
      await store.write(row.pathname, file.bytes, file.contentType, deadline);
      stored = await readAttachmentBytes(store, row.pathname, row.size);
    }
    if (!stored || createHash('sha256').update(stored).digest('hex') !== file.hash) throw new InboundRetryError('storage_unavailable');
    await database.transaction(async tx => {
      await acquireTicketWorkLock(tx, source.ownerId);
      await assertInboundLease(tx, source.ownerId, lease);
      await tx.query(`UPDATE attachments SET status='ready',"uploadedAt"=COALESCE("uploadedAt",$1),"validatedAt"=$1,"updatedAt"=$1
        WHERE id=$2 AND "ownerId"=$3 AND status IN ('reserved','uploaded','ready')`, [new Date().toISOString(), row.id, source.ownerId]);
    });
  }
  return { ids: rows.map(row => row.id), draftId: email.id, kind, lease };
}
