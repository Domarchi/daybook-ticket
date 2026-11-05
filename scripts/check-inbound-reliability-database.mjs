/** Serial QA only. Every provider/storage operation is injected and fictional.
 * Run only after root coordinates the QA lease and additive 0006 migration.
 * node --env-file=.env.test.local --import tsx scripts/check-inbound-reliability-database.mjs
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Database } from '../db/database.ts';
import { publicMember } from '../lib/access.ts';
import { receiveInboundEmail } from '../lib/inbound-email.ts';
import { enqueueInboundMail, drainInboundMailJobs, retryInboundMailJob } from '../lib/inbound-email-jobs.ts';
import { inboundConfiguration, makeInboundAddress } from '../lib/inbound-email-validation.ts';
import { InboundRetryError } from '../lib/inbound-email-errors.ts';

assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
assert.equal(new URL(process.env.DATABASE_URL).hostname, 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
assert.equal(process.env.DAYBOOK_QA_DATABASE_HOST, 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
assert.ok(!process.env.RESEND_API_KEY && !process.env.RESEND_INBOUND_API_KEY && !process.env.VAPID_PRIVATE_KEY && !process.env.DAYBOOK_EMAIL_FROM);
assert.notEqual(process.env.VERCEL_ENV, 'production');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
class FaultDatabase extends Database {
  failProvider = null;
  async transaction(work) {
    let fail = false;
    const targetProvider = this.failProvider;
    const result = await super.transaction(async tx => {
      const proxy = new Proxy(tx, { get(target, key) {
        if (key !== 'query') return Reflect.get(target, key);
        return (...args) => {
          if (targetProvider && typeof args[0] === 'string' && args[0].includes('INSERT INTO "inboundMailReceipts"') && args[1]?.[0] === targetProvider) fail = true;
          return target.query(...args);
        };
      } });
      return work(proxy);
    });
    if (fail && this.failProvider) { this.failProvider = null; throw new Error('Simulated lost COMMIT acknowledgement'); }
    return result;
  }
}
const database = new FaultDatabase(pool);
const clientId = randomUUID(), adminId = randomUUID(), providers = [], ticketIds = new Set();
let ownerId, source, access, availabilitySnapshot, checks = 0;
const config = inboundConfiguration({ DAYBOOK_INBOUND_ENABLED: 'true', DAYBOOK_INBOUND_DOMAIN: 'qa-fictional.resend.app',
  DAYBOOK_INBOUND_TOKEN_SECRET: 'fictional-qa-inbound-token-at-least-32chars', RESEND_INBOUND_API_KEY: 'fictional-not-valid-key',
  RESEND_INBOUND_WEBHOOK_SECRET: `whsec_${Buffer.from('fictional-qa-inbound-signature-key').toString('base64')}`, DAYBOOK_NOTIFICATION_ENVIRONMENT: 'qa' });
const objects = new Map(), bodies = new Map(), content = new Map();
let writes = 0, failStorageOnce = false, failProviderOnce = false, providerReads = 0;
const storage = {
  async read(pathname) { const bytes = objects.get(pathname); return bytes ? { stream: new Response(bytes).body, size: bytes.length } : null; },
  async remove(pathname) { objects.delete(pathname); },
  async write(pathname, bytes) {
    if (objects.has(pathname)) { assert.deepEqual(objects.get(pathname), bytes); return; }
    objects.set(pathname, Buffer.from(bytes)); writes++;
    if (failStorageOnce) { failStorageOnce = false; throw new InboundRetryError('storage_unavailable'); }
  },
};
const fetcher = async (url, init) => {
  assert.equal(init.redirect, 'error');
  const address = new URL(String(url));
  if (address.hostname === 'api.resend.com') {
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${config.apiKey}`);
    const match = /^\/emails\/receiving\/([a-f0-9-]+)(?:\/attachments\/([a-f0-9-]+))?$/.exec(address.pathname);
    assert.ok(match); const body = bodies.get(match[1]); assert.ok(body);
    if (!match[2]) {
      providerReads++;
      if (failProviderOnce) { failProviderOnce = false; return new Response('', { status: 503 }); }
      return Response.json(body);
    }
    const file = body.attachments.find(file => file.id === match[2]); assert.ok(file);
    return Response.json({ ...file, download_url: `https://cdn.resend.app/receiving/${match[1]}/attachments/${match[2]}?signature=fictional` });
  }
  assert.equal(address.hostname, 'cdn.resend.app'); assert.equal(init.headers, undefined);
  const match = /^\/receiving\/([a-f0-9-]+)\/attachments\/([a-f0-9-]+)$/.exec(address.pathname); assert.ok(match);
  return new Response(content.get(`${match[1]}:${match[2]}`));
};
function input(withFile = false, name = 'request.txt') {
  const providerId = randomUUID(), address = makeInboundAddress({ kind: 'new', id: clientId, ownerId, memberId: clientId, email: source.email }, config);
  const envelope = { providerId, webhookId: `msg_${randomUUID()}`, from: source.email, to: [address], subject: 'QA reliability fictional request', createdAt: new Date().toISOString() };
  const files = withFile ? [{ id: randomUUID(), filename: name, content_type: 'text/plain', size: 5, content_disposition: null }] : [];
  bodies.set(providerId, { id: providerId, from: source.email, to: [address], subject: envelope.subject, text: 'Fictional new response', html: null,
    headers: {}, authentication: { dmarc: 'pass', dkim: 'pass' }, attachments: files });
  for (const file of files) content.set(`${providerId}:${file.id}`, Buffer.from('hello'));
  providers.push(providerId); return envelope;
}
const job = async id => (await pool.query('SELECT * FROM "inboundMailJobs" WHERE "providerId"=$1', [id])).rows[0];
async function drain(envelope) {
  const result = await drainInboundMailJobs(ownerId, { database, config, fetcher, storage, providerId: envelope.providerId, maxJobs: 1 });
  const row = await job(envelope.providerId); if (row?.ticketId) ticketIds.add(row.ticketId); return { result, row };
}
async function assertProcessed(envelope) {
  const row = await job(envelope.providerId); assert.equal(row.status, 'processed'); assert.ok(row.ticketId && row.messageId); ticketIds.add(row.ticketId);
  const receipt = (await pool.query('SELECT * FROM "inboundMailReceipts" WHERE "providerId"=$1', [envelope.providerId])).rows[0];
  assert.equal(receipt.ticketId, row.ticketId); assert.equal(receipt.messageId, row.messageId);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM messages WHERE "ownerId"=$1 AND "ticketId"=$2', [ownerId, row.ticketId])).rows[0].n, 1);
  assert.equal((await pool.query('SELECT "isTest" FROM tickets WHERE id=$1', [row.ticketId])).rows[0].isTest, true);
  return row;
}
try {
  const organization = (await pool.query('SELECT "ownerId" FROM organizations WHERE id=\'daybook\'')).rows[0];
  assert.ok(organization, 'An existing isolated QA Daybook workspace is required.'); ownerId = organization.ownerId;
  availabilitySnapshot = (await pool.query('SELECT * FROM "agentAvailability" WHERE "ownerId"=$1', [ownerId])).rows;
  for (const [id, role] of [[clientId, 'client'], [adminId, 'admin']]) {
    await pool.query(`INSERT INTO members (id,"ownerId","organizationId","userId",name,email,role,status,"isTest","createdAt","updatedAt")
      VALUES ($1,$2,'daybook',$3,'QA reliability fictional',$4,$5,'active',true,$6,$6)`, [id, ownerId, randomUUID(), `${id}@example.test`, role, new Date().toISOString()]);
  }
  source = (await pool.query('SELECT * FROM members WHERE id=$1', [clientId])).rows[0];
  const admin = (await pool.query('SELECT * FROM members WHERE id=$1', [adminId])).rows[0];
  access = { ownerId, organizationId: 'daybook', userId: admin.userId, role: 'admin', member: publicMember({ ...admin, hasAccount: true }) };

  const first = input(true);
  await Promise.all([enqueueInboundMail(database, first, config), enqueueInboundMail(database, first, config)]);
  const concurrent = await Promise.all([drain(first), drain(first)]);
  assert.equal(concurrent.reduce((sum, value) => sum + value.result.attempted, 0), 1);
  const saved = await assertProcessed(first);
  const attached = (await pool.query('SELECT * FROM attachments WHERE "messageId"=$1', [saved.messageId])).rows;
  assert.equal(attached.length, 1); assert.equal(attached[0].status, 'attached'); assert.deepEqual(objects.get(attached[0].pathname), Buffer.from('hello'));
  const beforeReads = providerReads, beforeWrites = writes;
  await enqueueInboundMail(database, { ...first, webhookId: 'msg_replayed_same_email' }, config); await drain(first);
  assert.equal(providerReads, beforeReads); assert.equal(writes, beforeWrites); await assertProcessed(first); checks++;

  await assert.rejects(enqueueInboundMail(database, { ...first, subject: 'Conflicting signed metadata' }, config)); checks++;

  const temporary = input(); await enqueueInboundMail(database, temporary, config); failProviderOnce = true;
  assert.equal((await drain(temporary)).row.status, 'retry');
  const retryKey = randomUUID();
  await Promise.all([retryInboundMailJob(database, access, temporary.providerId, retryKey), retryInboundMailJob(database, access, temporary.providerId, retryKey)]);
  assert.equal((await job(temporary.providerId)).manualRetries, 1);
  await drain(temporary); await assertProcessed(temporary); checks++;

  const ambiguousUpload = input(true); await enqueueInboundMail(database, ambiguousUpload, config); failStorageOnce = true;
  assert.equal((await drain(ambiguousUpload)).row.status, 'retry');
  const reservation = (await pool.query('SELECT "attachmentId" FROM "inboundMailJobFiles" WHERE "providerId"=$1', [ambiguousUpload.providerId])).rows[0].attachmentId;
  const creations = writes;
  await retryInboundMailJob(database, access, ambiguousUpload.providerId, randomUUID()); await drain(ambiguousUpload); const recovered = await assertProcessed(ambiguousUpload);
  assert.equal(writes, creations);
  assert.equal((await pool.query('SELECT id FROM attachments WHERE "messageId"=$1', [recovered.messageId])).rows[0].id, reservation); checks++;

  const bad = input(true, 'unsafe.exe'); await enqueueInboundMail(database, bad, config);
  assert.equal((await drain(bad)).row.status, 'rejected'); assert.equal((await job(bad.providerId)).lastErrorCode, 'attachment_invalid');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM "inboundMailReceipts" WHERE "providerId"=$1', [bad.providerId])).rows[0].n, 0); checks++;

  const revoked = input(); await enqueueInboundMail(database, revoked, config);
  await pool.query('UPDATE members SET status=\'revoked\' WHERE id=$1', [clientId]); const calls = providerReads;
  assert.equal((await drain(revoked)).row.status, 'rejected'); assert.equal(providerReads, calls);
  await pool.query('UPDATE members SET status=\'active\' WHERE id=$1', [clientId]); checks++;

  const stale = input(); await enqueueInboundMail(database, stale, config);
  const realLease = randomUUID();
  await pool.query(`UPDATE "inboundMailJobs" SET status='processing',attempts=1,"leaseToken"=$1,"leaseUntil"=$2 WHERE "providerId"=$3`, [realLease, new Date(Date.now() + 300000).toISOString(), stale.providerId]);
  await assert.rejects(receiveInboundEmail(database, stale, { config, fetcher, storage, lease: { providerId: stale.providerId, leaseToken: randomUUID() } }), error => error instanceof InboundRetryError && error.message === 'lease_lost');
  assert.equal((await job(stale.providerId)).status, 'processing'); checks++;

  const ambiguousCommit = input(true); await enqueueInboundMail(database, ambiguousCommit, config); database.failProvider = ambiguousCommit.providerId;
  await drain(ambiguousCommit); const committed = await assertProcessed(ambiguousCommit);
  await drain(ambiguousCommit); await assertProcessed(ambiguousCommit);
  const preserved = (await pool.query('SELECT pathname,status FROM attachments WHERE "messageId"=$1', [committed.messageId])).rows[0];
  assert.equal(preserved.status, 'attached'); assert.ok(objects.has(preserved.pathname)); checks++;

  // The sixth attempt can be killed before recording its failure. Expiry must
  // release its reserved-file quota through the same guarded orphan path.
  const crashedFinal = input(true); await enqueueInboundMail(database, crashedFinal, config); failStorageOnce = true;
  assert.equal((await drain(crashedFinal)).row.status, 'retry');
  const crashedFile = (await pool.query(`SELECT a.id,a.pathname,a.status FROM attachments a JOIN "inboundMailJobFiles" f ON f."attachmentId"=a.id WHERE f."providerId"=$1`, [crashedFinal.providerId])).rows[0];
  assert.equal(crashedFile.status, 'reserved'); assert.ok(objects.has(crashedFile.pathname));
  await pool.query(`UPDATE "inboundMailJobs" SET status='processing',attempts=6,"leaseToken"=$1,"leaseUntil"=$2 WHERE "providerId"=$3`,
    [randomUUID(), new Date(Date.now() - 1000).toISOString(), crashedFinal.providerId]);
  const beforeCrashReads = providerReads;
  const failedFinal = await drain(crashedFinal);
  assert.equal(failedFinal.result.failed, 1); assert.equal(failedFinal.result.attempted, 0);
  assert.equal(failedFinal.row.status, 'failed'); assert.equal(failedFinal.row.lastErrorCode, 'retry_exhausted');
  assert.equal(failedFinal.row.leaseToken, null); assert.equal(failedFinal.row.leaseUntil, null); assert.equal(providerReads, beforeCrashReads);
  assert.equal((await pool.query('SELECT status FROM attachments WHERE id=$1', [crashedFile.id])).rows[0].status, 'deleting');
  assert.ok(objects.has(crashedFile.pathname), 'The six-minute safety margin must preserve an ambiguous object initially.');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM "inboundMailReceipts" WHERE "providerId"=$1', [crashedFinal.providerId])).rows[0].n, 0);
  // Age only this fictional orphan, then verify deletion cannot touch a file
  // protected by the already processed receipt/message of another attempt.
  await pool.query('UPDATE attachments SET "updatedAt"=$1 WHERE id=$2', [new Date(Date.now() - 420000).toISOString(), crashedFile.id]);
  await drain(crashedFinal);
  assert.equal((await pool.query('SELECT status FROM attachments WHERE id=$1', [crashedFile.id])).rows[0].status, 'deleted');
  assert.equal(objects.has(crashedFile.pathname), false);
  assert.equal((await pool.query('SELECT status FROM attachments WHERE "messageId"=$1', [committed.messageId])).rows[0].status, 'attached');
  assert.ok(objects.has(preserved.pathname));
  assert.equal((await pool.query('SELECT status FROM "inboundMailReceipts" WHERE "providerId"=$1', [ambiguousCommit.providerId])).rows[0].status, 'processed');
  await assertProcessed(ambiguousCommit); checks++;

  const clientAccess = { ownerId, organizationId: 'daybook', userId: source.userId, role: 'client', member: publicMember({ ...source, hasAccount: true }) };
  await assert.rejects(retryInboundMailJob(database, clientAccess, bad.providerId, randomUUID()), error => error.status === 403); checks++;
  console.log(JSON.stringify({ result: 'PASS', checks, externalRequests: 0, externalDeliveries: 0, fakeObjects: objects.size }));
} finally {
  if (ownerId) {
    const discovered = await pool.query('SELECT id FROM tickets WHERE "ownerId"=$1 AND "requesterMemberId"=$2', [ownerId, clientId]);
    for (const row of discovered.rows) ticketIds.add(row.id);
    const ids = [...ticketIds];
    await pool.query('DELETE FROM "pushDeliveries" WHERE "eventId" IN (SELECT id FROM "mailOutbox" WHERE "ownerId"=$1 AND "ticketId"=ANY($2::int[]))', [ownerId, ids]);
    await pool.query('DELETE FROM "mailDeliveryEvents" WHERE "outboxId" IN (SELECT id FROM "mailOutbox" WHERE "ownerId"=$1 AND "ticketId"=ANY($2::int[]))', [ownerId, ids]);
    await pool.query('DELETE FROM "mailOutbox" WHERE "ownerId"=$1 AND "ticketId"=ANY($2::int[])', [ownerId, ids]);
    await pool.query('DELETE FROM "inboundMailJobFiles" WHERE "providerId"=ANY($1::text[])', [providers]);
    await pool.query('DELETE FROM "inboundMailReceipts" WHERE "providerId"=ANY($1::text[]) AND "ownerId"=$2', [providers, ownerId]);
    await pool.query('DELETE FROM "inboundMailJobs" WHERE "providerId"=ANY($1::text[]) AND "ownerId"=$2', [providers, ownerId]);
    await pool.query('DELETE FROM attachments WHERE "ownerId"=$1 AND "memberId"=$2', [ownerId, clientId]);
    await pool.query('DELETE FROM "ticketEvents" WHERE "ownerId"=$1 AND "ticketId"=ANY($2::int[])', [ownerId, ids]);
    await pool.query('DELETE FROM messages WHERE "ownerId"=$1 AND "ticketId"=ANY($2::int[])', [ownerId, ids]);
    await pool.query('DELETE FROM tickets WHERE "ownerId"=$1 AND id=ANY($2::int[])', [ownerId, ids]);
    await pool.query('DELETE FROM operations WHERE "ownerId"=$1 AND "memberId"=ANY($2::text[])', [ownerId, [clientId, adminId]]);
    // Automatic routing can update its existing tie-breaker timestamp. Restore
    // that isolated QA snapshot under the externally coordinated serial lease.
    if (availabilitySnapshot) {
      await pool.query('DELETE FROM "agentAvailability" WHERE "ownerId"=$1 AND NOT ("memberId"=ANY($2::text[]))', [ownerId, availabilitySnapshot.map(row => row.memberId)]);
      for (const row of availabilitySnapshot) await pool.query(`UPDATE "agentAvailability" SET available=$1,capacity=$2,version=$3,"lastAssignedAt"=$4,"updatedAt"=$5 WHERE "memberId"=$6 AND "ownerId"=$7`,
        [row.available, row.capacity, row.version, row.lastAssignedAt, row.updatedAt, row.memberId, ownerId]);
    }
    await pool.query('DELETE FROM members WHERE "ownerId"=$1 AND id=ANY($2::text[])', [ownerId, [clientId, adminId]]);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM "inboundMailJobs" WHERE "providerId"=ANY($1::text[])', [providers])).rows[0].n, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM members WHERE id=ANY($1::text[])', [[clientId, adminId]])).rows[0].n, 0);
  }
  objects.clear(); await pool.end();
}
