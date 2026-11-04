/** Isolated mail worker integration checks, with no real provider requests.
 * Run: node --env-file=.env.test.local --import tsx scripts/check-mail-drain.mjs
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const expectedHost = 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
assert.equal(new URL(process.env.DATABASE_URL).hostname, expectedHost);
assert.equal(process.env.DAYBOOK_QA_DATABASE_HOST, expectedHost);
assert.equal(new URL(process.env.DAYBOOK_SITE_URL).origin, 'http://127.0.0.1:5173');
assert.ok(!Object.hasOwn(process.env, 'RESEND_API_KEY'), 'Never run with real email credentials.');
assert.ok(!Object.hasOwn(process.env, 'DAYBOOK_EMAIL_FROM'), 'Never run with a real sender.');

const runId = randomUUID(), ownerId = randomUUID(), memberId = randomUUID();
const organizationId = `qa-mail-drain-${runId}`, email = `qa-mail-drain-${runId}@example.test`;
const originalFetch = globalThis.fetch, originalSiteUrl = process.env.DAYBOOK_SITE_URL;
const modes = new Map(), validIds = new Set(), sent = [];
let pool, database, notificationStatements, processOutbox, drainOutbox;

async function enqueue(count = 1) {
  const prefix = `qa-drain-${randomUUID()}`;
  await database.batch(Array.from({ length: count }, (_, index) => notificationStatements(database, {
    ownerId, event: 'invitation', eventKey: `${prefix}-${index}`, recipientMemberId: memberId,
    actionUrl: `${process.env.DAYBOOK_SITE_URL}/login?invite=qa-only`, expiresAt: new Date(Date.now() + 3600000).toISOString(),
  })).flat());
  const rows = (await pool.query('SELECT id FROM "mailOutbox" WHERE "ownerId" = $1 AND "eventKey" LIKE $2 ORDER BY "createdAt", id', [ownerId, `invitation:${prefix}%`])).rows;
  for (const row of rows) validIds.add(row.id);
  return rows.map(row => row.id);
}
async function row(id) {
  return (await pool.query('SELECT * FROM "mailOutbox" WHERE id = $1 AND "ownerId" = $2', [id, ownerId])).rows[0];
}
async function clear() {
  await pool.query('DELETE FROM "mailOutbox" WHERE "ownerId" = $1 AND "recipientMemberId" = $2', [ownerId, memberId]);
  modes.clear(); sent.length = 0; validIds.clear();
}
async function makeDue(id) {
  await pool.query('UPDATE "mailOutbox" SET "nextAttemptAt" = $1 WHERE id = $2 AND "ownerId" = $3', [new Date(Date.now() - 1000).toISOString(), id, ownerId]);
}

try {
  process.env.RESEND_API_KEY = 'qa-placeholder-never-sent';
  process.env.DAYBOOK_EMAIL_FROM = 'Daybook QA <notifications@example.test>';
  process.env.DAYBOOK_SITE_URL = 'https://daybook-mail-qa.example.test';
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://api.resend.com/emails', 'Only the mock provider may be invoked.');
    assert.equal(options.method, 'POST');
    const id = options.headers['Idempotency-Key'].replace(/^daybook-ticket\//, '');
    assert.ok(validIds.has(id), 'Only this run\'s isolated fixture events may be processed.');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.to, [email]);
    sent.push({ id, key: options.headers['Idempotency-Key'], body: options.body });
    const mode = modes.get(id);
    if (mode === 'timeout') throw new DOMException('Mock timeout', 'TimeoutError');
    if (mode === '503') return Response.json({ name: 'server_error' }, { status: 503 });
    if (mode === '401') return Response.json({ name: 'unauthorized' }, { status: 401 });
    if (mode === 'quota') return Response.json({ name: 'daily_quota_exceeded' }, { status: 429 });
    if (mode === '429' || mode === '429-date') return Response.json({ name: 'rate_limit_exceeded' }, {
      status: 429, headers: { 'Retry-After': mode === '429' ? '120' : new Date(Date.now() + 180000).toUTCString() },
    });
    // Allow concurrent workers to overlap without contacting any external service.
    await new Promise(resolve => setTimeout(resolve, 5));
    return Response.json({ id: `qa-${id}` });
  };
  const dbModule = await import('../db/index.ts');
  ({ notificationStatements, processOutbox, drainOutbox } = await import('../lib/mail.ts'));
  pool = dbModule.getPool(); database = dbModule.getDatabase();
  const now = new Date().toISOString();
  await database.batch([
    database.prepare('INSERT INTO organizations (id, "ownerId", name, "createdAt") VALUES ($1, $2, $3, $4)').bind(organizationId, ownerId, 'QA mail drain', now),
    database.prepare('INSERT INTO members (id, "organizationId", "ownerId", email, name, role, status, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)')
      .bind(memberId, organizationId, ownerId, email, 'QA mail drain member', 'agent', 'invited', now),
  ]);

  const bulk = await enqueue(21);
  const results = await Promise.all([drainOutbox(ownerId), drainOutbox(ownerId)]);
  assert.equal(results.reduce((sum, result) => sum + result.accepted, 0), 21, 'One trigger drains more than two or ten messages.');
  assert.equal(sent.length, 21, 'Concurrent workers must send every event exactly once.');
  assert.deepEqual(sent.map(item => item.id).sort(), bulk.sort());
  assert.equal((await drainOutbox(ownerId)).processed, 0, 'Accepted messages remain terminal.');
  await clear();

  await enqueue(8);
  assert.deepEqual(await drainOutbox(ownerId, { maxMessages: 3 }), { configured: true, processed: 3, accepted: 3 });
  assert.equal((await drainOutbox(ownerId)).accepted, 5, 'Quantity limits leave the remainder available.');
  await clear();

  const [budgetId] = await enqueue();
  assert.equal((await drainOutbox(ownerId, { maxDurationMs: 1 })).accepted, 0, 'An exhausted time budget must not start a provider send.');
  const budgetRow = await row(budgetId);
  assert.equal(budgetRow.attempts, 0);
  assert.equal(budgetRow.status, 'queued');
  assert.equal(budgetRow.leaseUntil, null, 'Budget exhaustion does not strand a claim.');
  assert.equal(sent.length, 0);
  await clear();

  const throttled = await enqueue(21);
  modes.set(throttled[0], '429');
  const throttleStart = Date.now();
  assert.deepEqual(await drainOutbox(ownerId), { configured: true, processed: 1, accepted: 0 });
  assert.equal(sent.length, 1, '429 stops the drain before spending attempts across the queue.');
  const limitedRow = await row(throttled[0]);
  assert.equal(limitedRow.status, 'queued');
  assert.equal(limitedRow.lastErrorCode, 'rate_limit_exceeded');
  assert.ok(Date.parse(limitedRow.nextAttemptAt) >= throttleStart + 120000, 'Numeric Retry-After is persisted.');
  assert.equal((await drainOutbox(ownerId)).processed, 0, 'Subsequent triggers respect the persisted provider cooldown.');
  assert.equal((await processOutbox(ownerId, 1, throttled[1])).processed, 0, 'A targeted send cannot bypass a current throttle.');
  const unattempted = (await pool.query('SELECT count(*)::int AS n FROM "mailOutbox" WHERE "ownerId" = $1 AND attempts = 0', [ownerId])).rows[0].n;
  assert.equal(unattempted, 20);
  modes.delete(throttled[0]); await makeDue(throttled[0]);
  assert.equal((await drainOutbox(ownerId)).accepted, 21, 'A later trigger drains all work after cooldown.');
  const throttledSends = sent.filter(item => item.id === throttled[0]);
  assert.equal(throttledSends.length, 2);
  assert.deepEqual(throttledSends[0], throttledSends[1], 'A retry preserves payload and idempotency key.');
  await clear();

  const [dateId] = await enqueue(); modes.set(dateId, '429-date');
  const dateStart = Date.now();
  await processOutbox(ownerId, 1, dateId);
  assert.ok(Date.parse((await row(dateId)).nextAttemptAt) >= dateStart + 179000, 'HTTP-date Retry-After is persisted.');
  await clear();

  for (const failure of ['timeout', '503']) {
    const [id] = await enqueue(); modes.set(id, failure);
    assert.equal((await drainOutbox(ownerId)).accepted, 0);
    const failedAttempt = await row(id);
    assert.equal(failedAttempt.status, 'queued'); assert.equal(failedAttempt.attempts, 1);
    assert.equal(failedAttempt.lastErrorCode, 'provider_unavailable');
    assert.ok(Date.parse(failedAttempt.nextAttemptAt) > Date.now());
    assert.equal((await drainOutbox(ownerId)).processed, 0, 'Backoff does not become a busy retry loop.');
    modes.delete(id); await makeDue(id);
    assert.equal((await drainOutbox(ownerId)).accepted, 1);
    assert.deepEqual(sent[0], sent[1], 'An ambiguous timeout retries the same provider operation.');
    await clear();
  }

  for (const failure of ['401', 'quota']) {
    const ids = await enqueue(3); modes.set(ids[0], failure);
    assert.deepEqual(await drainOutbox(ownerId), { configured: true, processed: 1, accepted: 0 });
    assert.equal(sent.length, 1, 'Configuration/quota failures do not fail the entire backlog.');
    assert.equal((await row(ids[0])).status, 'failed');
    assert.equal((await row(ids[1])).attempts, 0);
    await clear();
  }

  const [expiredLease, liveLease] = await enqueue(2);
  await pool.query('UPDATE "mailOutbox" SET status = $1, "leaseUntil" = $2 WHERE id = $3 AND "ownerId" = $4', ['processing', new Date(Date.now() - 1000).toISOString(), expiredLease, ownerId]);
  await pool.query('UPDATE "mailOutbox" SET status = $1, "leaseUntil" = $2 WHERE id = $3 AND "ownerId" = $4', ['processing', new Date(Date.now() + 90000).toISOString(), liveLease, ownerId]);
  const liveBefore = await row(liveLease);
  assert.equal((await drainOutbox(ownerId)).accepted, 1, 'Interrupted expired claims are recoverable.');
  assert.equal(sent[0].id, expiredLease);
  assert.deepEqual(await row(liveLease), liveBefore, 'An unexpired claim belongs to its current worker.');
  await clear();

  const [ambiguous, exhausted] = await enqueue(2);
  await pool.query('UPDATE "mailOutbox" SET attempts = 1, "firstAttemptAt" = $1 WHERE id = $2 AND "ownerId" = $3', [new Date(Date.now() - 25 * 3600000).toISOString(), ambiguous, ownerId]);
  await pool.query('UPDATE "mailOutbox" SET attempts = 6, "firstAttemptAt" = $1 WHERE id = $2 AND "ownerId" = $3', [new Date().toISOString(), exhausted, ownerId]);
  assert.equal((await drainOutbox(ownerId)).accepted, 0);
  assert.equal((await row(ambiguous)).status, 'unknown');
  assert.equal((await row(ambiguous)).lastErrorCode, 'idempotency_expired');
  assert.equal((await row(exhausted)).lastErrorCode, 'retry_exhausted');
  assert.equal((await drainOutbox(ownerId)).processed, 0);
  assert.equal(sent.length, 0, 'Unknown outcomes are never automatically re-sent with a new key.');
  await clear();

  const [revoked] = await enqueue();
  await pool.query('UPDATE members SET status = $1 WHERE id = $2 AND "ownerId" = $3', ['revoked', memberId, ownerId]);
  assert.equal((await drainOutbox(ownerId)).accepted, 0);
  assert.equal((await row(revoked)).status, 'cancelled');
  assert.equal(sent.length, 0, 'Revoked recipients receive no mail.');
  console.log(JSON.stringify({ result: 'passed', checks: ['QA-only', 'multi-batch-drain', 'concurrent-claims', 'accepted-deduplication', 'message-budget', 'time-budget-release', '429-stops-batch', 'persisted-cooldown', 'retry-after-seconds-and-date', 'stable-payload-and-key', 'timeout-and-503-backoff', 'permanent-error-stop', 'expired-lease-recovery', 'live-lease-isolation', 'unknown-no-resend', 'revoked-recipient'], externalEmailRequests: 0 }));
} finally {
  globalThis.fetch = originalFetch;
  process.env.DAYBOOK_SITE_URL = originalSiteUrl;
  delete process.env.RESEND_API_KEY; delete process.env.DAYBOOK_EMAIL_FROM;
  if (pool) {
    try {
      await pool.query('DELETE FROM "mailOutbox" WHERE "ownerId" = $1 AND "recipientMemberId" = $2', [ownerId, memberId]);
      await pool.query('DELETE FROM members WHERE id = $1 AND "ownerId" = $2 AND "organizationId" = $3', [memberId, ownerId, organizationId]);
      await pool.query('DELETE FROM organizations WHERE id = $1 AND "ownerId" = $2', [organizationId, ownerId]);
      for (const [sql, value] of [
        ['SELECT count(*)::int AS n FROM "mailOutbox" WHERE "ownerId" = $1', ownerId],
        ['SELECT count(*)::int AS n FROM members WHERE "organizationId" = $1', organizationId],
        ['SELECT count(*)::int AS n FROM organizations WHERE id = $1', organizationId],
      ]) assert.equal((await pool.query(sql, [value])).rows[0].n, 0, 'QA fixtures must be removed.');
    } finally { await pool.end(); }
  }
}
