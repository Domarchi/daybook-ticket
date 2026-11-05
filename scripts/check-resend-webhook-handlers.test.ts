import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import type { Database } from '../db/database';
import { receiveInboundEmail, type InboundResult } from '../lib/inbound-email';
import { inboundConfiguration, makeInboundAddress } from '../lib/inbound-email-validation';
import { DELIVERY_EVENT_TYPES } from '../lib/mail-delivery-validation';
import { createResendWebhookHandlers } from '../lib/resend-webhook-handlers';

const deliverySecret = `whsec_${Buffer.from('fictional-delivery-webhook-secret-32').toString('base64')}`;
const inboundSecret = `whsec_${Buffer.from('fictional-inbound-webhook-secret-32').toString('base64')}`;
const memberId = '11111111-1111-4111-8111-111111111111';
const providerId = '33333333-3333-4333-8333-333333333333';
const scope = { id: memberId, kind: 'new' as const, ownerId: 'fictional-owner', memberId, email: 'client@example.test' };
function environment(mode?: string): Record<string, string | undefined> {
  return { DAYBOOK_INBOUND_ENABLED: 'true', DAYBOOK_INBOUND_WEBHOOK_MODE: mode, DAYBOOK_INBOUND_DOMAIN: 'fictional.resend.app',
    DAYBOOK_INBOUND_TOKEN_SECRET: 'fictional-token-secret-only-qa-32bytes', RESEND_INBOUND_API_KEY: 'fictional-inbound-api-key',
    RESEND_INBOUND_WEBHOOK_SECRET: inboundSecret, RESEND_WEBHOOK_SECRET: deliverySecret, DAYBOOK_NOTIFICATION_ENVIRONMENT: 'qa' };
}
const address = makeInboundAddress(scope, inboundConfiguration(environment()))!;
const processed: InboundResult = { status: 'processed', reasonCode: null, ownerId: scope.ownerId, ticketId: 42, messageId: 55 };
function rawEvent(type = 'email.received', to = [address]): Buffer {
  return Buffer.from(JSON.stringify({ type, created_at: new Date().toISOString(), data: {
    email_id: providerId, from: 'QA Client <client@example.test>', to, subject: 'Fictional request',
  } }));
}
function request(raw: Buffer, secret = deliverySecret): Request {
  const id = 'msg_fictional_shared', timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`${id}.${timestamp}.`).update(raw).digest('base64');
  return new Request('https://qa.example.test/api/webhooks/resend', { method: 'POST', body: new Uint8Array(raw),
    headers: { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` } });
}
function harness(env = environment('shared'), result = processed) {
  const calls = { received: 0, delivered: 0, scheduled: 0, notified: 0 };
  const pending: (() => Promise<void>)[] = [];
  const handlers = createResendWebhookHandlers({ env,
    receive: async (envelope, config) => {
      calls.received++; assert.equal(envelope.webhookId, 'msg_fictional_shared'); assert.equal(config.webhookMode, env.DAYBOOK_INBOUND_WEBHOOK_MODE || 'independent');
      return result;
    },
    recordDelivery: async receipt => { calls.delivered++; assert.equal(receipt.environment, null); },
    after: task => { calls.scheduled++; pending.push(task); },
    dispatchNotifications: async ownerId => { calls.notified++; assert.equal(ownerId, scope.ownerId); },
  });
  return { handlers, calls, pending };
}

test('shared signing mode is explicit; independent is the default and unknown modes fail closed', () => {
  const independent = inboundConfiguration(environment());
  assert.equal(independent.webhookMode, 'independent'); assert.equal(independent.webhookSecret, inboundSecret); assert.equal(independent.enabled, true);
  const env = environment('shared'); delete env.RESEND_INBOUND_WEBHOOK_SECRET;
  const shared = inboundConfiguration(env);
  assert.equal(shared.webhookMode, 'shared'); assert.equal(shared.webhookSecret, deliverySecret); assert.equal(shared.enabled, true);
  assert.equal(makeInboundAddress(scope, shared), address, 'Changing only signature mode does not rotate private addresses.');
  assert.equal(shared.apiKey, env.RESEND_INBOUND_API_KEY, 'The restricted sending API key is never substituted.');
  assert.equal(inboundConfiguration(environment('typo')).enabled, false);
  assert.equal(inboundConfiguration({ ...environment('shared'), RESEND_WEBHOOK_SECRET: undefined }).enabled, false);
  assert.equal(inboundConfiguration({ ...env, RESEND_INBOUND_API_KEY: undefined, RESEND_API_KEY: 'fictional-sending-key' }).enabled, false);
});

test('shared route processes a signed incoming event with injected database and provider transport', async () => {
  const env = environment('shared'), calls = { database: 0, provider: 0, transaction: 0, after: 0, notify: 0 };
  const pending: (() => Promise<void>)[] = [];
  const database = {
    prepare: (sql: string) => {
      calls.database++; assert.match(sql, /SELECT m\.\* FROM members/);
      return { bind: (id: string) => {
        assert.equal(id, memberId);
        return { first: async () => ({ id: memberId, ownerId: scope.ownerId, organizationId: 'daybook', email: scope.email, role: 'client', status: 'active', userId: 'fictional-user' }) };
      } };
    },
    // Transaction semantics already have dedicated tests. No SQL callback runs here.
    transaction: async () => { calls.transaction++; return processed; },
  } as unknown as Database;
  const handlers = createResendWebhookHandlers({ env,
    receive: (envelope, config) => receiveInboundEmail(database, envelope, { config, retrieve: async id => {
      calls.provider++; assert.equal(id, providerId);
      return { id, from: scope.email, to: [address], subject: 'Fictional request', text: 'Help please', html: null,
        headers: {}, attachments: [], authentication: { dkim: 'pass', dmarc: 'gray' } };
    } }),
    recordDelivery: async () => { assert.fail('An incoming event must not enter delivery tracking.'); },
    after: task => { calls.after++; pending.push(task); },
    dispatchNotifications: async ownerId => { calls.notify++; assert.equal(ownerId, scope.ownerId); },
  });
  const response = await handlers.delivery(request(rawEvent()));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { received: true });
  assert.deepEqual(calls, { database: 1, provider: 1, transaction: 1, after: 1, notify: 0 });
  await pending[0](); assert.equal(calls.notify, 1);
});

test('default independent mode leaves incoming events ignored; an invalid mode retries instead of dropping mail', async () => {
  for (const mode of [undefined, 'independent', 'typo']) {
    const { handlers, calls } = harness(environment(mode));
    assert.equal((await handlers.delivery(request(rawEvent()))).status, mode === 'typo' ? 503 : 200);
    assert.deepEqual(calls, { received: 0, delivered: 0, scheduled: 0, notified: 0 });
  }
});

test('shared route authenticates exact bytes with only the existing delivery signing secret', async () => {
  const { handlers, calls } = harness();
  const raw = rawEvent(), tampered = request(raw);
  const changed = new Request(tampered.url, { method: 'POST', headers: tampered.headers, body: Buffer.concat([raw, Buffer.from(' ')]) });
  for (const input of [changed, request(raw, inboundSecret), new Request(tampered.url, { method: 'POST', body: new Uint8Array(raw) })]) {
    assert.equal((await handlers.delivery(input)).status, 400);
  }
  const malformed = request(Buffer.from('{private-malformed-json'), inboundSecret);
  assert.equal((await handlers.delivery(malformed)).status, 400, 'Authentication must reject the wrong key before decoding JSON.');
  assert.deepEqual(calls, { received: 0, delivered: 0, scheduled: 0, notified: 0 });
});

test('shared incoming configuration failures retry while valid delivery receipts still record', async () => {
  for (const key of ['DAYBOOK_INBOUND_ENABLED', 'DAYBOOK_INBOUND_DOMAIN', 'DAYBOOK_INBOUND_TOKEN_SECRET', 'RESEND_INBOUND_API_KEY']) {
    const env = environment('shared');
    if (key === 'DAYBOOK_INBOUND_ENABLED') env[key] = 'false'; else delete env[key];
    const { handlers, calls } = harness(env);
    assert.equal((await handlers.delivery(request(rawEvent()))).status, 503, key);
    assert.equal((await handlers.delivery(request(rawEvent('email.delivered', ['client@example.test'])))).status, 200, key);
    assert.deepEqual(calls, { received: 0, delivered: 1, scheduled: 0, notified: 0 });
  }
  const { handlers, calls } = harness({ ...environment('shared'), RESEND_WEBHOOK_SECRET: undefined });
  assert.equal((await handlers.delivery(request(rawEvent()))).status, 503);
  assert.equal(calls.received, 0);
});

test('all existing delivery event types still record in shared mode with receiving paused', async () => {
  const { handlers, calls } = harness({ ...environment('shared'), DAYBOOK_INBOUND_ENABLED: 'false' });
  for (const type of DELIVERY_EVENT_TYPES) {
    assert.equal((await handlers.delivery(request(rawEvent(type, ['client@example.test'])))).status, 200, type);
  }
  assert.deepEqual(calls, { received: 0, delivered: DELIVERY_EVENT_TYPES.length, scheduled: 0, notified: 0 });
});

test('independent route keeps its separate signature and is unavailable in shared mode', async () => {
  const independent = harness(environment());
  assert.equal((await independent.handlers.inbound(request(rawEvent(), deliverySecret))).status, 400);
  assert.equal((await independent.handlers.inbound(request(rawEvent(), inboundSecret))).status, 200);
  assert.equal(independent.calls.received, 1);
  const shared = harness();
  assert.equal((await shared.handlers.inbound(request(rawEvent(), inboundSecret))).status, 503);
  assert.equal((await shared.handlers.inbound(request(rawEvent(), deliverySecret))).status, 503);
  assert.equal(shared.calls.received, 0);
});

test('foreign and ignored mail never schedules notifications; incoming service failures retry privately', async () => {
  const foreign = harness();
  assert.equal((await foreign.handlers.delivery(request(rawEvent('email.received', ['foreign@unrelated.resend.app'])))).status, 200);
  assert.equal(foreign.calls.received, 0);
  const ignored = harness(environment('shared'), { ...processed, status: 'ignored', reasonCode: 'sender_mismatch', ownerId: null });
  assert.equal((await ignored.handlers.delivery(request(rawEvent()))).status, 200);
  assert.equal(ignored.calls.received, 1); assert.equal(ignored.calls.scheduled, 0);
  const originalError = console.error, logs: unknown[][] = [];
  console.error = (...args: unknown[]) => { logs.push(args); };
  try {
    const unavailable = createResendWebhookHandlers({ env: environment('shared'), after: () => assert.fail('No failed work may schedule.'),
      receive: async () => { throw new Error('private-provider-detail-client@example.test'); } });
    const response = await unavailable.delivery(request(rawEvent()));
    assert.equal(response.status, 503);
    assert.doesNotMatch(JSON.stringify(await response.json()) + JSON.stringify(logs), /private-provider-detail|client@example/);
  } finally { console.error = originalError; }
});
