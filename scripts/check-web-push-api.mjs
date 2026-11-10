/** Isolated Web Push security/queue checks. NEVER sends to a push provider.
 * Run after starting the QA server: node --env-file=.env.test.local --import tsx scripts/check-web-push-api.mjs
 */
import assert from 'node:assert/strict';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const expectedHost = 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
assert.equal(new URL(process.env.DATABASE_URL).hostname, expectedHost);
assert.equal(process.env.DAYBOOK_QA_DATABASE_HOST, expectedHost);
assert.equal(new URL(process.env.DAYBOOK_SITE_URL).origin, 'http://127.0.0.1:5173');
assert.ok(!process.env.RESEND_API_KEY && !process.env.DAYBOOK_EMAIL_FROM, 'Email must stay disabled in QA.');
const origin = process.env.DAYBOOK_SITE_URL;
const fixture = JSON.parse(await readFile(new URL('../work/ticket-updates-qa.json', import.meta.url), 'utf8'));
assert.equal(fixture.databaseHost, expectedHost);
assert.equal(fixture.origin, origin);
for (const person of [fixture.owner, fixture.client]) assert.ok(person.email.endsWith('@example.test'));
const owner = fixture.owner,
  client = fixture.client;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const runId = randomUUID();
const eventIds = [],
  subscriptionIds = [];
let originalMemberStatus, originalRequesterId, clientMemberId;

async function api(person, path, method = 'GET', body, headers = {}) {
  if (body && method === 'POST' && (path === '/api/tickets' || /^\/api\/tickets\/\d+\/messages$/.test(path))) {
    body = { ...body, operationId: body.operationId ?? randomUUID() };
  }
  if (
    body &&
    method === 'PATCH' &&
    /^\/api\/tickets\/\d+$/.test(path) &&
    ('assigneeMemberId' in body || 'assignee' in body) &&
    body.expectedVersion === undefined
  ) {
    const row = (await pool.query('SELECT version FROM tickets WHERE id=$1', [Number(path.split('/').at(-1))])).rows[0];
    body = { ...body, expectedVersion: row?.version ?? 0 };
  }
  const cookie = Object.entries(person?.cookies || {})
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  const response = await fetch(`${origin}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(cookie ? { cookie } : {}),
      'x-vercel-forwarded-for': person?.testIp || '192.0.2.230',
      ...(method === 'GET' ? {} : { origin }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (person)
    for (const line of response.headers.getSetCookie()) {
      const [entry] = line.split(';');
      const divider = entry.indexOf('='),
        name = entry.slice(0, divider),
        value = entry.slice(divider + 1);
      if (value) person.cookies[name] = value;
      else delete person.cookies[name];
    }
  return { status: response.status, headers: response.headers, body: await response.json().catch(() => ({})) };
}
function status(result, expected, label) {
  assert.equal(result.status, expected, `${label}: HTTP ${result.status}, expected ${expected}`);
  return result.body;
}
function browserSubscription() {
  const curve = createECDH('prime256v1');
  curve.generateKeys();
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/daybook-qa-${runId}-${randomUUID()}`,
    keys: { p256dh: curve.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  };
}
async function register(person, input) {
  const response = await api(person, '/api/push', 'POST', { expectedMemberId: person.memberId, subscription: input });
  assert.ok([200, 201].includes(response.status), `Register device: HTTP ${response.status}`);
  assert.deepEqual(
    Object.keys(response.body),
    ['subscriptionId'],
    'Subscription endpoint and keys must remain private.',
  );
  assert.ok(typeof response.body.subscriptionId === 'string');
  subscriptionIds.push(response.body.subscriptionId);
  return response.body.subscriptionId;
}

try {
  assert.equal(
    (await pool.query('SELECT COUNT(*)::int AS n FROM "pushSubscriptions" WHERE active = true')).rows[0].n,
    0,
    'QA requires no pre-existing active push devices, preventing unrelated delivery processing.',
  );
  for (const person of [owner, client])
    status(
      await api(person, '/api/auth/sign-in/email', 'POST', { email: person.email, password: person.password }),
      200,
      'QA sign-in',
    );
  const ownerWorkspace = status(await api(owner, '/api/workspace'), 200, 'Owner workspace');
  const clientWorkspace = status(await api(client, '/api/workspace'), 200, 'Client workspace');
  assert.equal(ownerWorkspace.viewer.role, 'owner');
  assert.equal(clientWorkspace.viewer.role, 'client');
  clientMemberId = clientWorkspace.viewer.id;
  const ownerMemberId = ownerWorkspace.viewer.id;
  owner.memberId = ownerMemberId;
  client.memberId = clientMemberId;
  const member = (await pool.query('SELECT "ownerId", status FROM members WHERE id = $1', [clientMemberId])).rows[0];
  const ownerId = member.ownerId;
  originalMemberStatus = member.status;
  originalRequesterId = (
    await pool.query('SELECT "requesterMemberId" FROM tickets WHERE id = $1 AND "ownerId" = $2', [
      fixture.ticketId,
      ownerId,
    ])
  ).rows[0].requesterMemberId;
  assert.equal(originalRequesterId, clientMemberId);
  for (const [path, method, body] of [
    ['/api/push', 'GET'],
    ['/api/push', 'POST', { subscription: browserSubscription() }],
    ['/api/push', 'PATCH', { endpoint: browserSubscription().endpoint }],
    ['/api/push', 'DELETE', { endpoint: browserSubscription().endpoint }],
    ['/api/push/receipt', 'POST', { subscriptionId: randomUUID(), test: true }],
    ['/api/push/diagnostics', 'POST', { subscriptionId: randomUUID(), test: true, stage: 'shown' }],
    ['/api/push/test', 'POST', { subscriptionId: randomUUID() }],
  ])
    status(await api(null, path, method, body), 401, `Unauthenticated ${method} ${path}`);

  const config = await api(owner, '/api/push');
  status(config, 200, 'Push config');
  assert.ok(config.headers.get('cache-control')?.includes('no-store'));
  assert.equal(config.body.configured, true, 'QA needs its own generated VAPID keys.');
  assert.deepEqual(Object.keys(config.body).sort(), ['configured', 'publicKey']);
  assert.equal(typeof config.body.publicKey, 'string');
  const ownerDevice = browserSubscription(),
    clientDevice = browserSubscription();
  status(
    await api(
      owner,
      '/api/push',
      'POST',
      { expectedMemberId: ownerMemberId, subscription: ownerDevice },
      { origin: 'https://untrusted.example' },
    ),
    403,
    'Cross-origin subscription',
  );
  status(
    await api(owner, '/api/push', 'POST', { expectedMemberId: clientMemberId, subscription: ownerDevice }),
    409,
    'Changed-account registration',
  );
  for (const endpoint of [
    'https://127.0.0.1/push',
    'https://169.254.169.254/latest/meta-data',
    'https://fcm.googleapis.com.evil.example/push',
  ]) {
    status(
      await api(owner, '/api/push', 'POST', {
        expectedMemberId: ownerMemberId,
        subscription: { ...ownerDevice, endpoint },
      }),
      400,
      'Unsafe endpoint',
    );
  }
  const ownerSub = await register(owner, ownerDevice),
    clientSub = await register(client, clientDevice);
  await register(owner, ownerDevice);
  assert.equal(
    (
      await pool.query('SELECT COUNT(*)::int AS n FROM "pushSubscriptions" WHERE endpoint = $1 AND active = true', [
        ownerDevice.endpoint,
      ])
    ).rows[0].n,
    1,
    'Repeated activation keeps one device.',
  );
  assert.equal(
    (
      await pool.query('SELECT COUNT(*)::int AS n FROM "pushDeliveries" WHERE "subscriptionId" = ANY($1)', [
        [ownerSub, clientSub],
      ])
    ).rows[0].n,
    0,
    'Registration must not replay historical events.',
  );
  assert.deepEqual(
    status(await api(client, '/api/push', 'PATCH', { endpoint: ownerDevice.endpoint }), 200, 'Foreign status'),
    { enabled: false, subscriptionId: null },
  );
  status(await api(client, '/api/push', 'DELETE', { endpoint: ownerDevice.endpoint }), 200, 'Foreign disable');
  assert.equal(
    status(
      await api(owner, '/api/push', 'PATCH', { endpoint: ownerDevice.endpoint }),
      200,
      'Owner status after foreign disable',
    ).enabled,
    true,
  );

  const { Database } = await import('../db/database.ts');
  const { notificationStatements } = await import('../lib/mail.ts');
  const { processPushOutbox } = await import('../lib/push.ts');
  const database = new Database(pool);
  async function event(eventType, recipient, key = randomUUID()) {
    const eventKey = `qa-push-${runId}-${key}`;
    await database.batch(
      notificationStatements(database, {
        ownerId,
        event: eventType,
        recipientMemberId: recipient,
        ticketId: fixture.ticketId,
        eventKey,
      }),
    );
    const row = (
      await pool.query('SELECT id FROM "mailOutbox" WHERE "eventKey" = $1', [`${eventType}:${eventKey}:${recipient}`])
    ).rows[0];
    assert.ok(row?.id);
    eventIds.push(row.id);
    return row.id;
  }
  const clientReply = await event('client_replied', ownerMemberId);
  const teamReply = await event('agent_replied', clientMemberId);
  const createdTicket = await event('ticket_created', ownerMemberId);
  const invitation = await event('invitation', clientMemberId);
  assert.deepEqual(
    (await pool.query('SELECT "subscriptionId" FROM "pushDeliveries" WHERE "eventId" = $1', [clientReply])).rows.map(
      row => row.subscriptionId,
    ),
    [ownerSub],
  );
  assert.deepEqual(
    (await pool.query('SELECT "subscriptionId" FROM "pushDeliveries" WHERE "eventId" = $1', [teamReply])).rows.map(
      row => row.subscriptionId,
    ),
    [clientSub],
  );
  assert.equal(
    (await pool.query('SELECT COUNT(*)::int AS n FROM "pushDeliveries" WHERE "eventId" = $1', [invitation])).rows[0].n,
    0,
    'Invitations do not generate ticket pushes.',
  );

  const receipt = status(
    await api(client, '/api/push/receipt', 'POST', { subscriptionId: clientSub, eventId: teamReply }),
    200,
    'Client receipt',
  );
  assert.deepEqual(Object.keys(receipt).sort(), ['body', 'tag', 'title', 'url']);
  assert.ok(receipt.url.includes(`ticket=${fixture.ticketId}`));
  assert.ok(!JSON.stringify(receipt).includes(fixture.ticketSubject), 'Lock-screen payload must omit ticket subject.');
  status(
    await api(owner, '/api/push/receipt', 'POST', { subscriptionId: clientSub, eventId: teamReply }),
    404,
    'Different-account receipt',
  );
  status(
    await api(client, '/api/push/receipt', 'POST', { subscriptionId: clientSub, eventId: clientReply }),
    404,
    'Different recipient event',
  );
  const diagnostic = { subscriptionId: clientSub, eventId: teamReply, stage: 'shown' };
  const diagnosticResult = await api(client, '/api/push/diagnostics', 'POST', diagnostic);
  assert.deepEqual(status(diagnosticResult, 200, 'Own display diagnostic'), { ok: true });
  assert.ok(
    diagnosticResult.headers.get('cache-control')?.includes('no-store'),
    'Display diagnostics must not be cached.',
  );
  status(
    await api(client, '/api/push/diagnostics', 'POST', {
      ...diagnostic,
      stage: 'display_failed',
      reason: 'not_allowed',
    }),
    200,
    'Bounded display failure diagnostic',
  );
  status(await api(owner, '/api/push/diagnostics', 'POST', diagnostic), 404, 'Different-account display diagnostic');
  status(
    await api(client, '/api/push/diagnostics', 'POST', { ...diagnostic, eventId: clientReply }),
    404,
    'Different recipient diagnostic event',
  );
  status(
    await api(client, '/api/push/diagnostics', 'POST', {
      ...diagnostic,
      stage: 'display_failed',
      reason: 'https://private-endpoint.example/raw-error',
    }),
    400,
    'Raw diagnostic errors must not reach logs',
  );
  status(
    await api(client, '/api/push/diagnostics', 'POST', diagnostic, { origin: 'https://untrusted.example' }),
    403,
    'Cross-origin display diagnostic',
  );
  status(
    await api(owner, '/api/push/test', 'POST', { subscriptionId: clientSub }),
    429,
    'Cannot test another account device',
  );
  await pool.query('UPDATE members SET status = $1 WHERE id = $2', ['revoked', clientMemberId]);
  status(
    await api(client, '/api/push/receipt', 'POST', { subscriptionId: clientSub, eventId: teamReply }),
    403,
    'Revoked member receipt',
  );
  status(await api(client, '/api/push/diagnostics', 'POST', diagnostic), 403, 'Revoked member display diagnostic');
  await pool.query('UPDATE members SET status = $1 WHERE id = $2', [originalMemberStatus, clientMemberId]);
  await pool.query('UPDATE tickets SET "requesterMemberId" = NULL WHERE id = $1', [fixture.ticketId]);
  status(
    await api(client, '/api/push/receipt', 'POST', { subscriptionId: clientSub, eventId: teamReply }),
    404,
    'Former requester receipt',
  );
  status(await api(client, '/api/push/diagnostics', 'POST', diagnostic), 404, 'Former requester display diagnostic');
  await pool.query('UPDATE tickets SET "requesterMemberId" = $1 WHERE id = $2', [
    originalRequesterId,
    fixture.ticketId,
  ]);

  const deliveries = [];
  const send = async (subscription, payload) => {
    assert.ok(
      [ownerDevice.endpoint, clientDevice.endpoint].includes(subscription.endpoint),
      'Only current QA devices may reach the mock sender.',
    );
    deliveries.push(JSON.parse(payload));
    await new Promise(resolve => setTimeout(resolve, 25));
  };
  // The injected sender NEVER performs network I/O. Concurrent dispatches must claim distinct rows.
  await Promise.all([
    processPushOutbox(ownerId, { send, sleep: async () => {} }),
    processPushOutbox(ownerId, { send, sleep: async () => {} }),
  ]);
  assert.deepEqual(
    deliveries.map(item => item.eventId).sort(),
    [clientReply, teamReply, createdTicket].sort(),
    'Every event/device delivers once across concurrent processors.',
  );
  for (const payload of deliveries) assert.deepEqual(Object.keys(payload).sort(), ['eventId', 'subscriptionId']);
  await processPushOutbox(ownerId, { send, sleep: async () => {} });
  assert.equal(deliveries.length, 3, 'Accepted rows must not be re-sent.');

  const bulkEvents = [];
  for (let count = 0; count < 21; count++) bulkEvents.push(await event('agent_replied', clientMemberId));
  await processPushOutbox(ownerId, { send, sleep: async () => {} });
  assert.deepEqual(
    deliveries
      .slice(3)
      .map(item => item.eventId)
      .sort(),
    bulkEvents.sort(),
    'The 21st device/event must not wait for another ticket trigger.',
  );

  const retryEvent = await event('agent_replied', clientMemberId);
  let retryAttempts = 0;
  await processPushOutbox(ownerId, {
    send: async (_subscription, body) => {
      assert.equal(JSON.parse(body).eventId, retryEvent);
      if (++retryAttempts < 3) throw { statusCode: 503 };
    },
    sleep: async () => {},
  });
  assert.equal(retryAttempts, 3, 'Transient provider failures receive bounded retries.');
  assert.equal(
    (await pool.query('SELECT status FROM "pushDeliveries" WHERE "eventId" = $1', [retryEvent])).rows[0].status,
    'accepted',
  );

  const oldBindingEvent = await event('client_replied', ownerMemberId);
  const changedKeys = { ...ownerDevice, keys: browserSubscription().keys };
  status(
    await api(client, '/api/push', 'POST', { expectedMemberId: clientMemberId, subscription: changedKeys }),
    409,
    'Another account cannot take an endpoint without its keys',
  );
  assert.equal(
    (await pool.query('SELECT "memberId" FROM "pushSubscriptions" WHERE id = $1', [ownerSub])).rows[0].memberId,
    ownerMemberId,
  );
  await register(client, ownerDevice);
  status(
    await api(owner, '/api/push/receipt', 'POST', { subscriptionId: ownerSub, eventId: oldBindingEvent }),
    404,
    'Previous account loses endpoint binding',
  );
  status(
    await api(client, '/api/push/receipt', 'POST', { subscriptionId: ownerSub, eventId: oldBindingEvent }),
    404,
    'New binding cannot read old recipient events',
  );
  assert.equal(
    (await pool.query('SELECT status FROM "pushDeliveries" WHERE "eventId" = $1', [oldBindingEvent])).rows[0].status,
    'cancelled',
  );
  await register(owner, ownerDevice);
  await register(owner, changedKeys);
  status(
    await api(owner, '/api/push/receipt', 'POST', { subscriptionId: ownerSub, eventId: clientReply }),
    404,
    'Renewed device keys do not expose prior history',
  );

  const expiredEvent = await event('client_replied', ownerMemberId);
  await processPushOutbox(ownerId, {
    send: async () => {
      throw { statusCode: 410 };
    },
    sleep: async () => {},
  });
  assert.equal(
    (await pool.query('SELECT active FROM "pushSubscriptions" WHERE id = $1', [ownerSub])).rows[0].active,
    false,
    '410 disables an expired subscription.',
  );
  const expiredDelivery = (
    await pool.query('SELECT status, "lastErrorCode" FROM "pushDeliveries" WHERE "eventId" = $1', [expiredEvent])
  ).rows[0];
  assert.ok(['cancelled', 'failed'].includes(expiredDelivery.status));
  assert.equal(expiredDelivery.lastErrorCode, 'expired_subscription');
  status(
    await api(owner, '/api/push/receipt', 'POST', { subscriptionId: ownerSub, eventId: clientReply }),
    404,
    'Disabled device receipt',
  );
  status(await api(client, '/api/push', 'DELETE', { endpoint: clientDevice.endpoint }), 200, 'Disable own device');
  assert.equal(
    status(await api(client, '/api/push', 'PATCH', { endpoint: clientDevice.endpoint }), 200, 'Disabled own status')
      .enabled,
    false,
  );
  status(await api(client, '/api/push/diagnostics', 'POST', diagnostic), 404, 'Disabled device display diagnostic');
  console.log(
    JSON.stringify({
      result: 'passed',
      checks: [
        'QA-only',
        'authenticated-access',
        'origin-check',
        'changed-account-registration',
        'SSRF',
        'private-config',
        'no-history-replay',
        'device-isolation',
        'recipient-queue',
        'generic-payload',
        'bounded-display-diagnostics',
        'diagnostic-access-controls',
        'revocation',
        'current-ticket-scope',
        'concurrent-claims',
        'accepted-deduplication',
        'multi-batch-drain',
        'bounded-retries',
        'endpoint-rebinding',
        'expired-endpoint-cleanup',
        'disable',
      ],
      externalPushRequests: 0,
    }),
  );
} finally {
  try {
    if (clientMemberId && originalMemberStatus)
      await pool.query('UPDATE members SET status = $1 WHERE id = $2', [originalMemberStatus, clientMemberId]);
    if (originalRequesterId !== undefined)
      await pool.query('UPDATE tickets SET "requesterMemberId" = $1 WHERE id = $2', [
        originalRequesterId,
        fixture.ticketId,
      ]);
    if (eventIds.length) await pool.query('DELETE FROM "pushDeliveries" WHERE "eventId" = ANY($1)', [eventIds]);
    if (subscriptionIds.length) {
      await pool.query('DELETE FROM "pushDeliveries" WHERE "subscriptionId" = ANY($1)', [subscriptionIds]);
      await pool.query('DELETE FROM "pushSubscriptions" WHERE id = ANY($1)', [subscriptionIds]);
    }
    if (eventIds.length) await pool.query('DELETE FROM "mailOutbox" WHERE id = ANY($1)', [eventIds]);
  } finally {
    await pool.end();
  }
}
