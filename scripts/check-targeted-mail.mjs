/** Verify one explicitly selected email without touching older queued messages.
 * Uses only the fixed isolated QA database, fictitious members and a mocked Resend
 * fetch. No app server, real API key or external email requests are involved.
 * Run: node --env-file=.env.test.local --import tsx scripts/check-targeted-mail.mjs
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const expectedHost = 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
assert.equal(new URL(process.env.DATABASE_URL).hostname, expectedHost);
assert.equal(process.env.DAYBOOK_QA_DATABASE_HOST, expectedHost);
assert.equal(new URL(process.env.DAYBOOK_SITE_URL).origin, 'http://127.0.0.1:5173');
assert.ok(!Object.hasOwn(process.env, 'RESEND_API_KEY'), 'Do not run with an email API key configured.');
assert.ok(!Object.hasOwn(process.env, 'DAYBOOK_EMAIL_FROM'), 'Do not run with a real sender configured.');

const runId = randomUUID(), ownerId = randomUUID();
const organizationId = `qa-target-mail-${runId}`;
const targetMemberId = randomUUID(), olderMemberId = randomUUID();
const targetEmail = `target-${runId}@example.test`;
const olderEmail = `older-${runId}@example.test`;
const originalFetch = globalThis.fetch, originalSiteUrl = process.env.DAYBOOK_SITE_URL;
const sent = [];
let pool;

try {
  // These values exist only in this test process; the provider call is intercepted.
  process.env.RESEND_API_KEY = 'qa-placeholder-never-sent';
  process.env.DAYBOOK_EMAIL_FROM = 'Daybook QA <notifications@example.test>';
  process.env.DAYBOOK_SITE_URL = 'https://daybook-mail-qa.example.test';
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://api.resend.com/emails', 'All fetch calls must be intercepted provider requests.');
    assert.equal(options.method, 'POST');
    const payload = JSON.parse(options.body);
    assert.deepEqual(payload.to, [targetEmail], 'Only the specifically selected fictitious recipient may be sent.');
    sent.push({ payload, key: options.headers['Idempotency-Key'] });
    return Response.json({ id: `qa-provider-${runId}` });
  };
  const { getPool, getDatabase } = await import('../db/index.ts');
  const { notificationStatements, processOutbox } = await import('../lib/mail.ts');
  pool = getPool();
  const database = getDatabase(), now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 3600000).toISOString();
  await database.batch([
    database.prepare('INSERT INTO organizations (id, "ownerId", name, "createdAt") VALUES ($1, $2, $3, $4)')
      .bind(organizationId, ownerId, 'QA selected email', now),
    ...[[targetMemberId, targetEmail, 'agent'], [olderMemberId, olderEmail, 'client']].map(([id, email, role]) =>
      database.prepare('INSERT INTO members (id, "organizationId", "ownerId", email, name, role, status, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)')
        .bind(id, organizationId, ownerId, email, 'QA selected email member', role, 'invited', now)),
    ...notificationStatements(database, {
      ownerId, event: 'invitation', eventKey: `qa-older-${runId}`, recipientMemberId: olderMemberId,
      actionUrl: `${process.env.DAYBOOK_SITE_URL}/login?invite=qa-older`, expiresAt,
    }),
    ...notificationStatements(database, {
      ownerId, event: 'invitation', eventKey: `qa-target-${runId}`, recipientMemberId: targetMemberId,
      actionUrl: `${process.env.DAYBOOK_SITE_URL}/login?invite=qa-target`, expiresAt,
    }),
  ]);
  await pool.query('UPDATE "mailOutbox" SET "createdAt" = $1 WHERE "ownerId" = $2 AND "recipientMemberId" = $3',
    [new Date(Date.now() - 60000).toISOString(), ownerId, olderMemberId]);
  const before = (await pool.query('SELECT * FROM "mailOutbox" WHERE "ownerId" = $1 ORDER BY "createdAt"', [ownerId])).rows;
  assert.equal(before.length, 2);
  const older = before.find(row => row.recipientMemberId === olderMemberId);
  const target = before.find(row => row.recipientMemberId === targetMemberId);
  assert.equal(before[0].id, older.id, 'The unselected message must be older than the target.');

  const empty = { configured: true, processed: 0, accepted: 0 };
  assert.deepEqual(await processOutbox(ownerId, 5, randomUUID()), empty, 'Unknown ID must not process another queued email.');
  assert.deepEqual(await processOutbox(ownerId, 5, "' OR 1=1 --"), empty, 'Event ID must be bound as data.');
  assert.deepEqual(await processOutbox(randomUUID(), 5, target.id), empty, 'An event from another owner is inaccessible.');
  assert.deepEqual(await processOutbox(ownerId, 5, target.id), { configured: true, processed: 1, accepted: 1 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].key, `daybook-ticket/${target.id}`);
  assert.deepEqual(await processOutbox(ownerId, 5, target.id), empty, 'An accepted target is not sent twice.');
  const after = (await pool.query('SELECT * FROM "mailOutbox" WHERE "ownerId" = $1', [ownerId])).rows;
  assert.deepEqual(after.find(row => row.id === older.id), older, 'The entire unselected row must remain unchanged.');
  const delivered = after.find(row => row.id === target.id);
  assert.equal(delivered.status, 'accepted');
  assert.equal(delivered.attempts, 1);
  assert.equal(delivered.providerId, `qa-provider-${runId}`);
  assert.equal(sent.length, 1);
  console.log(JSON.stringify({ result: 'passed', checks: ['fixed-QA-host', 'fictitious-credentials', 'target-only', 'older-row-unchanged', 'owner-scope', 'bound-event-id', 'accepted-idempotency'], mockedEmailRequests: sent.length, externalEmailRequests: 0 }));
} finally {
  globalThis.fetch = originalFetch;
  process.env.DAYBOOK_SITE_URL = originalSiteUrl;
  delete process.env.RESEND_API_KEY;
  delete process.env.DAYBOOK_EMAIL_FROM;
  if (pool) {
    try {
      await pool.query('DELETE FROM "mailOutbox" WHERE "ownerId" = $1 AND "recipientMemberId" IN ($2, $3)', [ownerId, targetMemberId, olderMemberId]);
      await pool.query('DELETE FROM members WHERE "ownerId" = $1 AND "organizationId" = $2 AND id IN ($3, $4)', [ownerId, organizationId, targetMemberId, olderMemberId]);
      await pool.query('DELETE FROM organizations WHERE id = $1 AND "ownerId" = $2', [organizationId, ownerId]);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM "mailOutbox" WHERE "ownerId" = $1', [ownerId])).rows[0].n, 0);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM members WHERE "organizationId" = $1', [organizationId])).rows[0].n, 0);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM organizations WHERE id = $1', [organizationId])).rows[0].n, 0);
    } finally { await pool.end(); }
  }
}
