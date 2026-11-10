/** Shared notification routing and access checks against the isolated QA app/database.
 * No email provider or active push devices may be configured. Restores settings and
 * removes this run's fictitious members/tickets in finally. Never run in production.
 * Run: node --env-file=.env.test.local --import tsx scripts/check-notification-responsibles.mjs
 */
import assert from 'node:assert/strict';
import { withQaCleanup } from './qa-cleanup-transaction.mjs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const expectedHost = 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech';
const origin = new URL(process.env.DAYBOOK_SITE_URL).origin;
assert.ok(['http://127.0.0.1:5173', 'http://127.0.0.1:5175'].includes(origin), 'Use only an approved local QA origin.');
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
assert.equal(new URL(process.env.DATABASE_URL).hostname, expectedHost);
assert.equal(process.env.DAYBOOK_QA_DATABASE_HOST, expectedHost);
assert.equal(new URL(process.env.DAYBOOK_SITE_URL).origin, origin);
assert.ok(!process.env.RESEND_API_KEY && !process.env.DAYBOOK_EMAIL_FROM, 'Email must stay disabled in QA.');
const ownerEmail = process.env.DAYBOOK_QA_OWNER_EMAIL || process.env.DAYBOOK_OWNER_EMAIL;
assert.ok(ownerEmail?.endsWith('@example.test'));
const owner = {
  email: ownerEmail,
  password: process.env.DAYBOOK_QA_OWNER_PASSWORD || 'Local-QA-only!Daybook-2026',
  cookies: {},
  testIp: '192.0.2.231',
};
let client;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const runId = randomUUID();
const otherOrganization = `qa-notification-${runId}`;
const otherOwner = randomUUID();
const memberIds = [],
  authUserIds = [];
const operationIds = new Set();
let ownerId,
  organizationId,
  originalSettings,
  capturedSettings = false,
  appPool;

async function api(person, path, method = 'GET', body, headers = {}) {
  if (body && method === 'POST' && (path === '/api/tickets' || /^\/api\/tickets\/\d+\/messages$/.test(path))) {
    body = { ...body, operationId: body.operationId ?? randomUUID() };
    operationIds.add(body.operationId);
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
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
  const response = await fetch(`${origin}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(cookie ? { cookie } : {}),
      'x-vercel-forwarded-for': person?.testIp || '192.0.2.231',
      ...(method === 'GET' ? {} : { origin }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (person)
    for (const line of response.headers.getSetCookie()) {
      const [entry] = line.split(';'),
        divider = entry.indexOf('=');
      const key = entry.slice(0, divider),
        value = entry.slice(divider + 1);
      if (value) person.cookies[key] = value;
      else delete person.cookies[key];
    }
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
function status(result, expected, label) {
  assert.equal(result.status, expected, `${label}: HTTP ${result.status}, expected ${expected}`);
  return result.body;
}
const patch = (body, person = owner) => api(person, '/api/settings', 'PATCH', body);
const sameIds = (actual, expected, label) => assert.deepEqual([...actual].sort(), [...expected].sort(), label);
async function authUser(id = randomUUID()) {
  const now = new Date().toISOString();
  await pool.query(
    'INSERT INTO "authUser" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,\'QA notification account\',$2,true,$3,$3)',
    [id, `qa-${runId}-${id}@example.test`, now],
  );
  authUserIds.push(id);
  return id;
}
async function addMember(role, state, scope = {}) {
  const id = randomUUID(),
    now = new Date().toISOString();
  await pool.query(
    `INSERT INTO members (id, "organizationId", "ownerId", "userId", email, name, role, status, "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
    [
      id,
      scope.organizationId || organizationId,
      scope.ownerId || ownerId,
      state === 'active' ? await authUser() : null,
      `qa-${runId}-${id}@example.test`,
      'QA notification member',
      role,
      state,
      now,
    ],
  );
  memberIds.push(id);
  return id;
}
async function eventRecipients(ticketId, event) {
  return (
    await pool.query('SELECT "recipientMemberId" FROM "mailOutbox" WHERE "ticketId" = $1 AND event = $2 ORDER BY id', [
      ticketId,
      event,
    ])
  ).rows.map(row => row.recipientMemberId);
}

try {
  assert.equal(
    (await pool.query('SELECT COUNT(*)::int AS n FROM "pushSubscriptions" WHERE active = true')).rows[0].n,
    0,
    'QA requires no active push devices, preventing external delivery.',
  );
  status(
    await api(owner, '/api/auth/sign-in/email', 'POST', { email: owner.email, password: owner.password }),
    200,
    'QA owner sign-in',
  );
  const workspace = status(await api(owner, '/api/workspace'), 200, 'Owner workspace');
  assert.equal(workspace.viewer.role, 'owner');
  assert.equal(workspace.mailStatus.configured, false, 'The local app must also have email disabled.');
  const ownerMember = (
    await pool.query('SELECT * FROM members WHERE id = $1 AND email = $2', [workspace.viewer.id, owner.email])
  ).rows[0];
  assert.ok(ownerMember, 'The local app must use the same isolated database.');
  ({ ownerId, organizationId } = ownerMember);
  originalSettings = (await pool.query('SELECT data FROM settings WHERE "ownerId" = $1', [ownerId])).rows[0]?.data;
  capturedSettings = true;
  client = {
    email: `qa-notification-client-${runId}@example.test`,
    password: `Qa-${randomUUID()}!`,
    cookies: {},
    testIp: '192.0.2.232',
  };
  const invitation = status(
    await api(owner, '/api/members', 'POST', { name: 'QA notification client', email: client.email, role: 'client' }),
    201,
    'Invite fictitious client',
  );
  memberIds.push(invitation.member.id);
  const registered = status(
    await api(
      client,
      '/api/auth/sign-up/email',
      'POST',
      { email: client.email, password: client.password, name: 'QA notification client' },
      { 'x-daybook-invite': new URL(invitation.invitationUrl).searchParams.get('invite') },
    ),
    200,
    'Activate fictitious client',
  );
  if (registered.user?.id) authUserIds.push(registered.user.id);
  const clientWorkspace = status(await api(client, '/api/workspace'), 200, 'Client workspace');
  assert.equal(clientWorkspace.viewer.role, 'client');

  const access = { organizationId, ownerId, userId: ownerMember.userId, member: workspace.viewer, role: 'owner' };
  const { notificationRecipients } = await import('../lib/access.ts');
  const { getSettings } = await import('../lib/server.ts');
  const { getPool } = await import('../db/index.ts');
  appPool = getPool();

  const legacySettings = { ...workspace.settings };
  delete legacySettings.notificationMemberIds;
  await pool.query(
    'INSERT INTO settings ("ownerId", data) VALUES ($1, $2) ON CONFLICT ("ownerId") DO UPDATE SET data = excluded.data',
    [ownerId, JSON.stringify(legacySettings)],
  );
  assert.deepEqual(
    (await getSettings(ownerId)).notificationMemberIds,
    [],
    'Legacy settings receive the empty default.',
  );
  const invited = await addMember('agent', 'invited');
  const assigned = await addMember('admin', 'active');
  const revoked = await addMember('agent', 'revoked');
  await pool.query('INSERT INTO organizations (id, "ownerId", name, "createdAt") VALUES ($1, $2, $3, $4)', [
    otherOrganization,
    otherOwner,
    'QA notification organization',
    new Date().toISOString(),
  ]);
  const foreignOrganization = await addMember('agent', 'active', { organizationId: otherOrganization });
  const foreignOwner = await addMember('agent', 'active', { ownerId: otherOwner });

  status(await patch({ notificationMemberIds: [] }, null), 401, 'Anonymous settings');
  status(await patch({ notificationMemberIds: [] }, client), 403, 'Client cannot change notification recipients');
  status(
    await api(owner, '/api/settings', 'PATCH', { notificationMemberIds: [] }, { origin: 'https://untrusted.example' }),
    403,
    'Cross-origin settings',
  );
  for (const ids of [
    [clientWorkspace.viewer.id],
    [revoked],
    [foreignOwner],
    [foreignOrganization],
    [randomUUID()],
    ['invalid'],
    Array.from({ length: 21 }, () => randomUUID()),
  ]) {
    status(await patch({ notificationMemberIds: ids }), 400, 'Invalid or ineligible notification recipients');
  }
  const selected = [workspace.viewer.id, invited];
  sameIds(
    status(await patch({ notificationMemberIds: [...selected, invited] }), 200, 'Select owner and invited agent')
      .settings.notificationMemberIds,
    selected,
    'Duplicate IDs are removed.',
  );
  sameIds(
    status(await patch({ tagline: workspace.settings.tagline }), 200, 'Partial settings change').settings
      .notificationMemberIds,
    selected,
    'Omitted recipients remain unchanged.',
  );
  assert.deepEqual(
    status(await api(client, '/api/workspace'), 200, 'Sanitized client settings').settings.notificationMemberIds,
    [],
  );
  sameIds(
    await notificationRecipients(access, null),
    [workspace.viewer.id],
    'Invited staff do not receive notifications before activation.',
  );
  sameIds(
    await notificationRecipients(access, assigned),
    [workspace.viewer.id, assigned],
    'Active assignee is added to shared responsibles.',
  );
  await pool.query('UPDATE members SET status = $1, "userId" = $2 WHERE id = $3', [
    'active',
    await authUser(),
    invited,
  ]);
  sameIds(
    await notificationRecipients(access, workspace.viewer.id),
    selected,
    'Both responsible members receive an assigned ticket without duplicates.',
  );
  sameIds(
    await notificationRecipients(access, assigned),
    [...selected, assigned],
    'Another active assignee is included.',
  );
  for (const id of [clientWorkspace.viewer.id, revoked, foreignOwner, foreignOrganization]) {
    sameIds(await notificationRecipients(access, id), selected, 'Ineligible assignees are excluded.');
  }
  await pool.query('UPDATE members SET role = $1 WHERE id = $2', ['client', invited]);
  sameIds(
    await notificationRecipients(access, null),
    [workspace.viewer.id],
    'Changing a responsible member to client removes delivery access.',
  );
  await pool.query('UPDATE members SET role = $1, status = $2 WHERE id = $3', ['agent', 'revoked', invited]);
  sameIds(
    await notificationRecipients(access, null),
    [workspace.viewer.id],
    'Revoked responsible members stop receiving notifications.',
  );
  await pool.query('UPDATE members SET status = $1 WHERE id = $2', ['active', invited]);

  const input = {
    subject: `QA notification ${runId} client`,
    body: 'Fictitious shared notification test.',
    department: workspace.settings.departments[0],
    priority: 'normal',
  };
  const ticket = status(await api(client, '/api/tickets', 'POST', input), 201, 'Client creates test ticket').ticket;
  sameIds(
    await eventRecipients(ticket.id, 'ticket_created'),
    selected,
    'New client tickets notify both responsible members.',
  );
  status(
    await api(owner, `/api/tickets/${ticket.id}`, 'PATCH', { assigneeMemberId: workspace.viewer.id }),
    200,
    'Assign to one responsible',
  );
  status(
    await api(client, `/api/tickets/${ticket.id}/messages`, 'POST', {
      kind: 'reply',
      body: 'Fictitious client follow-up.',
    }),
    201,
    'Client reply',
  );
  sameIds(
    await eventRecipients(ticket.id, 'client_replied'),
    selected,
    'Client replies notify both even when assigned to one.',
  );
  status(
    await api(owner, `/api/tickets/${ticket.id}/messages`, 'POST', {
      kind: 'reply',
      body: 'Fictitious staff response.',
    }),
    201,
    'Staff reply',
  );
  sameIds(
    await eventRecipients(ticket.id, 'agent_replied'),
    [clientWorkspace.viewer.id],
    'Staff responses notify only the requesting client.',
  );
  const beforeNote = (
    await pool.query('SELECT COUNT(*)::int AS n FROM "mailOutbox" WHERE "ticketId" = $1', [ticket.id])
  ).rows[0].n;
  status(
    await api(owner, `/api/tickets/${ticket.id}/messages`, 'POST', {
      kind: 'note',
      body: 'Private fictitious staff note.',
    }),
    201,
    'Internal note',
  );
  assert.equal(
    (await pool.query('SELECT COUNT(*)::int AS n FROM "mailOutbox" WHERE "ticketId" = $1', [ticket.id])).rows[0].n,
    beforeNote,
    'Internal notes generate no notifications.',
  );
  const ownerTicket = status(
    await api(owner, '/api/tickets', 'POST', {
      ...input,
      subject: `QA notification ${runId} staff`,
      requesterMemberId: clientWorkspace.viewer.id,
      assigneeMemberId: workspace.viewer.id,
    }),
    201,
    'Staff creates test ticket',
  ).ticket;
  sameIds(
    await eventRecipients(ownerTicket.id, 'ticket_created'),
    [invited],
    'The sender does not receive their own new-ticket notification.',
  );

  status(await patch({ notificationMemberIds: [invited] }), 200, 'Single responsible');
  await pool.query('UPDATE members SET status = $1 WHERE id = $2', ['revoked', invited]);
  assert.deepEqual(
    await notificationRecipients(access, null),
    [],
    'A stale configured list does not broaden access to all staff.',
  );
  sameIds(await notificationRecipients(access, assigned), [assigned], 'A valid assignee still receives the event.');
  status(await patch({ notificationMemberIds: [] }), 200, 'Reset to automatic routing');
  sameIds(await notificationRecipients(access, assigned), [assigned], 'Empty list preserves assignee-only routing.');
  const activeStaff = (
    await pool.query(
      'SELECT id FROM members WHERE "ownerId" = $1 AND "organizationId" = $2 AND status = $3 AND role IN ($4, $5, $6)',
      [ownerId, organizationId, 'active', 'owner', 'admin', 'agent'],
    )
  ).rows.map(row => row.id);
  sameIds(
    await notificationRecipients(access, null),
    activeStaff,
    'Empty list preserves unassigned active-team routing.',
  );
  assert.equal(
    (
      await pool.query(
        'SELECT COUNT(*)::int AS n FROM "pushDeliveries" d JOIN "mailOutbox" m ON m.id = d."eventId" JOIN tickets t ON t.id = m."ticketId" WHERE t.subject LIKE $1',
        [`QA notification ${runId}%`],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await pool.query(
        'SELECT COUNT(*)::int AS n FROM "mailOutbox" m JOIN tickets t ON t.id = m."ticketId" WHERE t.subject LIKE $1 AND (m.attempts != 0 OR m.status != $2)',
        [`QA notification ${runId}%`, 'awaiting_configuration'],
      )
    ).rows[0].n,
    0,
  );
  console.log(
    JSON.stringify({
      result: 'passed',
      checks: [
        'QA-only',
        'legacy-default',
        'admin-only',
        'same-origin',
        'UUID-and-limit',
        'same-workspace-staff-only',
        'deduplication',
        'partial-update-preservation',
        'client-settings-privacy',
        'invited-activation',
        'shared-assignee-union',
        'role-and-revocation-filtering',
        'new-ticket-and-reply-routing',
        'staff-reply-client-only',
        'private-internal-notes',
        'sender-exclusion',
        'empty-list-fallback',
      ],
      externalEmailRequests: 0,
      externalPushRequests: 0,
    }),
  );
} finally {
  try {
    await withQaCleanup(pool, ownerId, async cleanup => {
      // Recover successful inserts whose HTTP/SQL response was interrupted.
      if (ownerId) {
        const recovered = (
          await cleanup.query(
            'SELECT id,"userId" FROM members WHERE "ownerId"=ANY($1::text[]) AND (email LIKE $2 OR email=$3)',
            [
              [ownerId, otherOwner],
              `qa-${runId}-%@example.test`,
              client?.email || `qa-notification-client-${runId}@example.test`,
            ],
          )
        ).rows;
        for (const row of recovered) {
          if (!memberIds.includes(row.id)) memberIds.push(row.id);
          if (row.userId && !authUserIds.includes(row.userId)) authUserIds.push(row.userId);
        }
        for (const row of (
          await cleanup.query('SELECT id FROM "authUser" WHERE email LIKE $1 OR email=$2', [
            `qa-${runId}-%@example.test`,
            client?.email || `qa-notification-client-${runId}@example.test`,
          ])
        ).rows)
          if (!authUserIds.includes(row.id)) authUserIds.push(row.id);
      }
      if (ownerId) {
        const tickets = (
          await cleanup.query('SELECT id FROM tickets WHERE "ownerId" = $1 AND subject LIKE $2', [
            ownerId,
            `QA notification ${runId}%`,
          ])
        ).rows.map(row => row.id);
        if (tickets.length) {
          await cleanup.query(
            'DELETE FROM "mailDeliveryEvents" WHERE "outboxId" IN (SELECT id FROM "mailOutbox" WHERE "ticketId"=ANY($1::int[]))',
            [tickets],
          );
          await cleanup.query(
            'DELETE FROM "pushDeliveries" WHERE "eventId" IN (SELECT id FROM "mailOutbox" WHERE "ticketId" = ANY($1))',
            [tickets],
          );
          await cleanup.query('DELETE FROM "mailOutbox" WHERE "ticketId" = ANY($1)', [tickets]);
          for (const table of [
            'inboundMailReceipts',
            'ticketSatisfaction',
            'escalationOccurrences',
            'reminderOccurrences',
            'ticketSlaOutcomes',
          ])
            await cleanup.query(`DELETE FROM "${table}" WHERE "ticketId"=ANY($1::int[])`, [tickets]);
          await cleanup.query('DELETE FROM "ticketEvents" WHERE "ticketId" = ANY($1)', [tickets]);
          await cleanup.query('DELETE FROM messages WHERE "ticketId" = ANY($1)', [tickets]);
          await cleanup.query('DELETE FROM tickets WHERE id = ANY($1)', [tickets]);
        }
      }
      if (operationIds.size)
        await cleanup.query('DELETE FROM operations WHERE "operationId"=ANY($1::text[])', [[...operationIds]]);
      if (capturedSettings) {
        if (originalSettings === undefined) await cleanup.query('DELETE FROM settings WHERE "ownerId" = $1', [ownerId]);
        else await cleanup.query('UPDATE settings SET data = $1 WHERE "ownerId" = $2', [originalSettings, ownerId]);
      }
      if (memberIds.length) {
        const values = [memberIds];
        await cleanup.query(
          'DELETE FROM "mailDeliveryEvents" WHERE "outboxId" IN (SELECT id FROM "mailOutbox" WHERE "recipientMemberId"=ANY($1::text[]))',
          values,
        );
        await cleanup.query(
          'DELETE FROM "pushDeliveries" WHERE "eventId" IN (SELECT id FROM "mailOutbox" WHERE "recipientMemberId"=ANY($1::text[]))',
          values,
        );
        await cleanup.query('DELETE FROM "mailOutbox" WHERE "recipientMemberId"=ANY($1::text[])', values);
        await cleanup.query('DELETE FROM invitations WHERE "memberId"=ANY($1::text[])', values);
        await cleanup.query('DELETE FROM members WHERE id=ANY($1::text[])', values);
      }
      await cleanup.query('DELETE FROM "authUser" WHERE id=ANY($1::text[]) OR email=$2', [
        authUserIds,
        client?.email || `qa-notification-client-${runId}@example.test`,
      ]);
      await cleanup.query('DELETE FROM organizations WHERE id = $1 AND "ownerId" = $2', [
        otherOrganization,
        otherOwner,
      ]);
      assert.equal(
        (await cleanup.query('SELECT count(*)::int AS n FROM members WHERE id=ANY($1::text[])', [memberIds])).rows[0].n,
        0,
      );
      assert.equal(
        (
          await cleanup.query('SELECT count(*)::int AS n FROM "authUser" WHERE id=ANY($1::text[]) OR email=$2', [
            authUserIds,
            client?.email || `qa-notification-client-${runId}@example.test`,
          ])
        ).rows[0].n,
        0,
      );
    });
    if (owner.cookies && Object.keys(owner.cookies).length)
      status(await api(owner, '/api/auth/sign-out', 'POST', {}), 200, 'Close test owner session');
    console.log(
      'QA notification responsibles cleanup PASS: fictitious accounts, memberships, tickets, operations and test sessions removed; shared settings restored.',
    );
  } finally {
    await Promise.all([pool.end(), appPool?.end()]);
  }
}
