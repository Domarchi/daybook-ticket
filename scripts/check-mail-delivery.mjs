/** QA-only integration: mocked provider, fictitious identities, no real sends.
 * Run in series: node --env-file=.env.test.local --import tsx scripts/check-mail-delivery.mjs
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const expectedHost = 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
assert.equal(new URL(process.env.DATABASE_URL).hostname, expectedHost);
assert.equal(process.env.DAYBOOK_QA_DATABASE_HOST, expectedHost);
assert.ok(['http://127.0.0.1:5173', 'http://127.0.0.1:5175'].includes(new URL(process.env.DAYBOOK_SITE_URL).origin));
assert.ok(!Object.hasOwn(process.env, 'RESEND_API_KEY'));
assert.ok(!Object.hasOwn(process.env, 'DAYBOOK_EMAIL_FROM'));

const runId = randomUUID(), ownerId = randomUUID(), memberId = randomUUID();
const organizationId = `qa-mail-delivery-${runId}`, email = `qa-delivery-${runId}@example.test`;
const originalFetch = globalThis.fetch;
const originalSite = process.env.DAYBOOK_SITE_URL, originalEnvironment = process.env.DAYBOOK_NOTIFICATION_ENVIRONMENT;
const bodies = new Map(), modes = new Map(), receiptIds = new Set();
let pool, database, notificationStatements, processOutbox, recordDeliveryReceipt, normalizeDeliveryWebhook;

function receipt(type, providerId, outboxId, { legacy = false, at = new Date().toISOString(), received = new Date(), tags } = {}) {
  const id = `msg_${randomUUID()}`; receiptIds.add(id);
  const data = { email_id: providerId, from: 'Daybook QA <notifications@example.test>', to: [email],
    ...(legacy ? {} : { tags: tags ?? { app: 'daybook_ticket', environment: 'qa', outbox_id: outboxId } }) };
  return normalizeDeliveryWebhook(Buffer.from(JSON.stringify({ type, created_at: at, data })), id, 'qa', received);
}
async function enqueue(mode) {
  const key = randomUUID();
  await database.batch(notificationStatements(database, { ownerId, event: 'invitation', eventKey: key, recipientMemberId: memberId,
    actionUrl: `${process.env.DAYBOOK_SITE_URL}/login?invite=qa-only`, expiresAt: new Date(Date.now() + 3600000).toISOString() }));
  const row = (await pool.query('SELECT * FROM "mailOutbox" WHERE "ownerId" = $1 AND "eventKey" = $2', [ownerId, `invitation:${key}:${memberId}`])).rows[0];
  modes.set(row.id, mode); return row;
}
async function row(id) { return (await pool.query('SELECT * FROM "mailOutbox" WHERE id = $1 AND "ownerId" = $2', [id, ownerId])).rows[0]; }

try {
  process.env.RESEND_API_KEY = 'qa-mock-no-external-delivery';
  process.env.DAYBOOK_EMAIL_FROM = 'Daybook QA <notifications@example.test>';
  process.env.DAYBOOK_SITE_URL = 'https://daybook-delivery-qa.example.test';
  process.env.DAYBOOK_NOTIFICATION_ENVIRONMENT = 'qa';
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://api.resend.com/emails'); assert.equal(options.method, 'POST');
    const id = options.headers['Idempotency-Key'].replace(/^daybook-ticket\//, '');
    assert.ok(modes.has(id), 'Only this test fixture may send');
    const payload = JSON.parse(options.body); assert.deepEqual(payload.to, [email]);
    const previous = bodies.get(id) ?? []; previous.push(options.body); bodies.set(id, previous);
    const providerId = `qa-provider-${id}`, mode = modes.get(id);
    if (mode === 'retry' && previous.length === 1) return Response.json({ name: 'rate_limit_exceeded' }, { status: 429 });
    if (mode === 'early-v2' || mode === 'early-v1') {
      const delivery = receipt('email.delivered', providerId, id, { legacy: mode === 'early-v1' });
      assert.equal(await recordDeliveryReceipt(database, delivery), mode === 'early-v1' ? 'pending' : 'tracked');
      assert.equal(await recordDeliveryReceipt(database, delivery), 'duplicate');
      if (mode === 'early-v1') {
        const pending = (await pool.query('SELECT "ownerId", "outboxId" FROM "mailDeliveryEvents" WHERE id = $1', [delivery.id])).rows[0];
        assert.deepEqual(pending, { ownerId: null, outboxId: null });
      }
    }
    return Response.json({ id: providerId });
  };
  const dbModule = await import('../db/index.ts'); pool = dbModule.getPool(); database = dbModule.getDatabase();
  ({ notificationStatements, processOutbox } = await import('../lib/mail.ts'));
  ({ recordDeliveryReceipt } = await import('../lib/mail-delivery.ts'));
  ({ normalizeDeliveryWebhook } = await import('../lib/mail-delivery-validation.ts'));
  const now = new Date().toISOString();
  await database.batch([
    database.prepare('INSERT INTO organizations (id, "ownerId", name, "createdAt") VALUES ($1,$2,$3,$4)').bind(organizationId, ownerId, 'QA delivery only', now),
    database.prepare('INSERT INTO members (id,"organizationId","ownerId",email,name,role,status,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)')
      .bind(memberId, organizationId, ownerId, email, 'Fictitious QA member', 'agent', 'invited', now),
  ]);

  const v2 = await enqueue('early-v2');
  assert.equal(v2.templateVersion, 2); assert.equal(v2.environment, 'qa');
  assert.equal((await processOutbox(ownerId, 1, v2.id)).accepted, 1);
  assert.equal((await row(v2.id)).deliveryStatus, 'delivered');
  const frozen = JSON.parse((await row(v2.id)).payloadJson);
  assert.ok(frozen.html); assert.equal(frozen.attachments.length, 1); assert.ok(frozen.tags.some(tag => tag.name === 'outbox_id' && tag.value === v2.id));
  assert.equal((await processOutbox(ownerId, 1, v2.id)).processed, 0);

  const v1 = await enqueue('early-v1');
  const legacyBody = `{ "from":"Daybook QA <notifications@example.test>", "to":["${email}"],"subject":"Original legacy title","text":"Original body\\n exact" }`;
  await pool.query('UPDATE "mailOutbox" SET "templateVersion" = 1, environment = NULL, "payloadJson" = $1 WHERE id = $2 AND "ownerId" = $3', [legacyBody, v1.id, ownerId]);
  assert.equal((await processOutbox(ownerId, 1, v1.id)).accepted, 1);
  assert.equal(bodies.get(v1.id)[0], legacyBody, 'A v1 frozen body is sent byte-for-byte');
  assert.equal((await row(v1.id)).deliveryStatus, 'delivered', 'Untagged early legacy receipts are adopted at acceptance');
  const adopted = (await pool.query('SELECT "ownerId", "outboxId" FROM "mailDeliveryEvents" WHERE "providerId" = $1', [`qa-provider-${v1.id}`])).rows;
  assert.deepEqual(adopted, [{ ownerId, outboxId: v1.id }]);

  const retry = await enqueue('retry');
  assert.equal((await processOutbox(ownerId, 1, retry.id)).accepted, 0);
  await pool.query('UPDATE "mailOutbox" SET "nextAttemptAt" = $1 WHERE id = $2 AND "ownerId" = $3', [new Date(Date.now() - 1000).toISOString(), retry.id, ownerId]);
  assert.equal((await processOutbox(ownerId, 1, retry.id)).accepted, 1);
  assert.equal(bodies.get(retry.id)[0], bodies.get(retry.id)[1], 'V2 body + attachments + tags remain identical on retry');
  assert.equal((await row(retry.id)).deliveryStatus, 'untracked', 'API acceptance alone never fabricates delivery');
  const providerId = `qa-provider-${retry.id}`;
  const base = Date.now() - 60_000;
  await Promise.all([
    recordDeliveryReceipt(database, receipt('email.delivered', providerId, retry.id, { at: new Date(base + 2000).toISOString() })),
    recordDeliveryReceipt(database, receipt('email.sent', providerId, retry.id, { at: new Date(base).toISOString() })),
    recordDeliveryReceipt(database, receipt('email.delivery_delayed', providerId, retry.id, { at: new Date(base + 1000).toISOString() })),
  ]);
  assert.equal((await row(retry.id)).deliveryStatus, 'delivered');
  await recordDeliveryReceipt(database, receipt('email.bounced', providerId, retry.id, { at: new Date(base + 3000).toISOString() }));
  await recordDeliveryReceipt(database, receipt('email.sent', providerId, retry.id));
  assert.equal((await row(retry.id)).deliveryStatus, 'bounced');
  assert.equal((await row(retry.id)).status, 'accepted', 'Processing state is independent of delivery');
  assert.equal(receipt('email.delivered', providerId, retry.id, { tags: { app: 'other_app', environment: 'qa', outbox_id: retry.id } }), null);
  assert.equal(await recordDeliveryReceipt(database, receipt('email.delivered', `qa-unknown-${runId}`, randomUUID())), 'ignored');
  const orphanProvider = `qa-orphan-${runId}`, old = new Date(Date.now() - 25 * 3600000);
  const oldReceipt = receipt('email.sent', orphanProvider, null, { legacy: true, at: old.toISOString(), received: old });
  assert.equal(await recordDeliveryReceipt(database, oldReceipt), 'pending');
  await recordDeliveryReceipt(database, receipt('email.delivered', providerId, retry.id));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM "mailDeliveryEvents" WHERE id = $1', [oldReceipt.id])).rows[0].n, 0, 'Expired orphan receipts are pruned');
  const schema = (await pool.query('SELECT * FROM "mailDeliveryEvents" WHERE "ownerId" = $1 LIMIT 1', [ownerId])).rows[0];
  assert.deepEqual(Object.keys(schema).sort(), ['id', 'occurredAt', 'outboxId', 'ownerId', 'payloadHash', 'providerId', 'receivedAt', 'eventType'].sort(), 'No raw body, address or subject is retained');
  console.log(JSON.stringify({ result: 'passed', checks: ['v2-CID-template', 'early-v2', 'legacy-frozen-bytes', 'early-legacy-orphan-adoption', 'duplicate-receipt', 'retry-frozen-body', 'acceptance-not-delivery', 'concurrent-out-of-order', 'no-delivery-regression', 'shared-account-isolation', 'orphan-24h-cleanup', 'minimal-receipts'], mockedEmailRequests: [...bodies.values()].reduce((sum, value) => sum + value.length, 0), externalEmailRequests: 0 }));
} finally {
  globalThis.fetch = originalFetch;
  process.env.DAYBOOK_SITE_URL = originalSite;
  if (originalEnvironment === undefined) delete process.env.DAYBOOK_NOTIFICATION_ENVIRONMENT; else process.env.DAYBOOK_NOTIFICATION_ENVIRONMENT = originalEnvironment;
  delete process.env.RESEND_API_KEY; delete process.env.DAYBOOK_EMAIL_FROM;
  if (pool) {
    try {
      await pool.query('DELETE FROM "mailDeliveryEvents" WHERE "ownerId" = $1 OR id = ANY($2::text[])', [ownerId, [...receiptIds]]);
      await pool.query('DELETE FROM "mailOutbox" WHERE "ownerId" = $1', [ownerId]);
      await pool.query('DELETE FROM members WHERE "ownerId" = $1 AND "organizationId" = $2', [ownerId, organizationId]);
      await pool.query('DELETE FROM organizations WHERE id = $1 AND "ownerId" = $2', [organizationId, ownerId]);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM "mailDeliveryEvents" WHERE "ownerId" = $1 OR id = ANY($2::text[])', [ownerId, [...receiptIds]])).rows[0].n, 0);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM "mailOutbox" WHERE "ownerId" = $1', [ownerId])).rows[0].n, 0);
    } finally { await pool.end(); }
  }
}
