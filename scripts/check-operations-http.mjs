/** Real sessions -> HTTP operations -> isolated QA only. Run serially after 0004.
 * node --env-file=.env.test.local --import tsx scripts/check-operations-http.mjs
 * Never starts a server, edits global settings, or configures a delivery provider.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { provisionOwner } from './provision-owner.mjs';
import { readAllTicketPages, readAllConversationPages } from './qa-paged-read.mjs';
import { addSlaHours } from '../lib/sla-policy.ts';

assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1', 'QA opt-in required.');
assert.equal(
  new URL(process.env.DATABASE_URL).hostname,
  'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech',
);
assert.equal(process.env.DAYBOOK_SITE_URL, 'http://127.0.0.1:5175', 'Use the dedicated operations QA server.');
for (const name of ['RESEND_API_KEY', 'DAYBOOK_EMAIL_FROM', 'VAPID_PRIVATE_KEY'])
  assert.ok(!process.env[name], `${name} must be absent.`);

const origin = process.env.DAYBOOK_SITE_URL;
const runId = randomUUID(),
  prefix = `QA operations ${runId}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 15000 });
const owner = { cookies: new Map(), ip: '192.0.2.181' };
const anonymous = { cookies: new Map(), ip: '192.0.2.182' };
const password = process.env.DAYBOOK_QA_OWNER_PASSWORD || 'Local-QA-only!Daybook-2026';
const memberIds = [],
  userIds = [],
  ticketIds = [],
  companyIds = [],
  operationIds = [],
  ruleIds = [];
const completed = [],
  report = { runId, scenarios: completed, counts: {}, cleaned: false };
let spaceOwnerId,
  department,
  sharedBefore,
  phase = 'guards',
  failure;

async function api(actor, path, method = 'GET', body, extraHeaders = {}) {
  const cookie = [...actor.cookies].map(([key, value]) => `${key}=${value}`).join('; ');
  const response = await fetch(`${origin}${path}`, {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(45000),
    headers: {
      ...(cookie ? { cookie } : {}),
      'x-vercel-forwarded-for': actor.ip,
      ...(actor.id ? { 'X-Daybook-Member-Id': actor.id } : {}),
      ...(method === 'GET' ? {} : { origin, 'content-type': 'application/json' }),
      ...extraHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const line of response.headers.getSetCookie()) {
    const [part] = line.split(';'),
      at = part.indexOf('=');
    if (part.slice(at + 1)) actor.cookies.set(part.slice(0, at), part.slice(at + 1));
    else actor.cookies.delete(part.slice(0, at));
  }
  return { status: response.status, data: await response.json().catch(() => null) };
}
function ok(result, status = 200) {
  // Do not include invitation URLs, credentials, or successful auth payloads in logs.
  assert.equal(
    result.status,
    status,
    `${phase}: expected HTTP ${status}, received ${result.status}; ${result.data?.error || ''}`,
  );
  return result.data;
}
function passed(label) {
  completed.push(label);
  console.log(`PASS HTTP operations: ${label}`);
}
async function snapshotShared() {
  const settings = (await pool.query('SELECT data FROM settings WHERE "ownerId"=$1', [spaceOwnerId])).rows;
  const notifications = (await pool.query('SELECT * FROM "notificationSettings" WHERE "ownerId"=$1', [spaceOwnerId]))
    .rows;
  const defaultPolicy = (
    await pool.query('SELECT * FROM "servicePolicies" WHERE "ownerId"=$1 AND "scopeKey"=\'default\'', [spaceOwnerId])
  ).rows;
  return { settings, notifications, defaultPolicy };
}
async function invite(label, role, customerCompanyId) {
  const actor = { cookies: new Map(), ip: `192.0.2.${183 + memberIds.length}` };
  const email = `qa-operations-${label}-${runId}@example.test`,
    name = `QA ${label} ${runId}`;
  const invited = ok(
    await api(owner, '/api/members', 'POST', {
      name,
      email,
      role,
      ...(customerCompanyId ? { customerCompanyId } : {}),
    }),
    201,
  );
  memberIds.push(invited.member.id);
  const registered = ok(
    await api(
      actor,
      '/api/auth/sign-up/email',
      'POST',
      { email, password, name },
      {
        'x-daybook-invite': new URL(invited.invitationUrl).searchParams.get('invite'),
      },
    ),
  );
  if (registered.user?.id) userIds.push(registered.user.id);
  actor.id = invited.member.id;
  assert.equal(ok(await api(actor, '/api/workspace')).viewer.id, actor.id);
  return actor;
}
function ticketPayload(label, extra = {}) {
  const operationId = randomUUID();
  operationIds.push(operationId);
  return {
    operationId,
    subject: `${prefix} ${label}`,
    body: 'Solicitud ficticia para validar operaciones.',
    department,
    priority: 'normal',
    ...extra,
  };
}
async function createTicket(actor, label, extra = {}) {
  const payload = ticketPayload(label, extra),
    ticket = ok(await api(actor, '/api/tickets', 'POST', payload), 201).ticket;
  ticketIds.push(ticket.id);
  assert.ok(
    !('slaPolicySnapshot' in ticket) && !('slaStartedAt' in ticket),
    'No internal SLA configuration in creation response.',
  );
  return { ticket, payload };
}
async function storedTicket(id) {
  const row = (await pool.query('SELECT * FROM tickets WHERE id=$1 AND "ownerId"=$2', [id, spaceOwnerId])).rows[0];
  assert.ok(row && row.subject.startsWith(prefix), "Only inspect this run's tickets.");
  return row;
}
async function patchTicket(id, changes) {
  const current = await storedTicket(id);
  return ok(await api(owner, `/api/tickets/${id}`, 'PATCH', { expectedVersion: current.version, ...changes })).ticket;
}
async function message(actor, ticketId, body, kind = 'reply', checkReplay = false) {
  const operationId = randomUUID();
  operationIds.push(operationId);
  const payload = { operationId, body, kind },
    path = `/api/tickets/${ticketId}/messages`;
  const sent = ok(await api(actor, path, 'POST', payload), 201).message;
  if (checkReplay) {
    const before = await replayState(ticketId, actor.id);
    assert.deepEqual(ok(await api(actor, path, 'POST', payload), 201).message, sent);
    assert.deepEqual(await replayState(ticketId, actor.id), before);
    ok(await api(actor, path, 'POST', { ...payload, body: `${body} changed` }), 409);
    assert.deepEqual(await replayState(ticketId, actor.id), before);
  }
  return sent;
}
async function outcomes(ticketId) {
  return (
    await pool.query(
      'SELECT * FROM "ticketSlaOutcomes" WHERE "ownerId"=$1 AND "ticketId"=$2 ORDER BY "resolvedAt",id',
      [spaceOwnerId, ticketId],
    )
  ).rows;
}
async function availability(memberId) {
  const result = ok(await api(owner, '/api/agent-availability')).agents.find(agent => agent.memberId === memberId);
  assert.ok(result);
  return result;
}
async function replayState(ticketId, memberId) {
  return (
    await pool.query(
      `SELECT
    (SELECT count(*)::integer FROM tickets WHERE "ownerId"=$1 AND id=$2) AS tickets,
    (SELECT version FROM tickets WHERE "ownerId"=$1 AND id=$2) AS version,
    (SELECT count(*)::integer FROM messages WHERE "ownerId"=$1 AND "ticketId"=$2) AS messages,
    (SELECT count(*)::integer FROM "ticketEvents" WHERE "ownerId"=$1 AND "ticketId"=$2) AS events,
    (SELECT count(*)::integer FROM "mailOutbox" WHERE "ownerId"=$1 AND "ticketId"=$2) AS notices,
    (SELECT "lastAssignedAt" FROM "agentAvailability" WHERE "ownerId"=$1 AND "memberId"=$3) AS "lastAssignedAt"`,
      [spaceOwnerId, ticketId, memberId],
    )
  ).rows[0];
}

try {
  phase = 'authentication';
  ok(await api(anonymous, '/api/metrics/agents'), 401);
  ok(await api(anonymous, '/api/service-policies'), 401);
  const email = process.env.DAYBOOK_QA_OWNER_EMAIL || process.env.DAYBOOK_OWNER_EMAIL || 'OWNER@example.test';
  assert.ok(email.endsWith('@example.test'), 'Owner must be fictitious.');
  if ((await api(owner, '/api/auth/sign-in/email', 'POST', { email, password })).status !== 200) {
    const invitation = await provisionOwner(pool, { email, name: 'QA propietario', siteUrl: origin });
    ok(
      await api(
        owner,
        '/api/auth/sign-up/email',
        'POST',
        { email, password, name: 'QA propietario' },
        {
          'x-daybook-invite': new URL(invitation.invitationUrl).searchParams.get('invite'),
        },
      ),
    );
  }
  const workspace = ok(await api(owner, '/api/workspace'));
  owner.id = workspace.viewer.id;
  department = workspace.settings.departments[0];
  assert.ok(department);
  spaceOwnerId = (await pool.query('SELECT "ownerId" FROM organizations WHERE id=\'daybook\'')).rows[0].ownerId;
  sharedBefore = await snapshotShared();
  // Do not alter existing routing or consume real agents' capacity to isolate a test.
  const initialRules = ok(await api(owner, '/api/assignment-rules')).rules;
  assert.ok(
    !initialRules.some(
      rule => rule.enabled && !rule.customerCompanyId && (!rule.department || rule.department === department),
    ),
    'Run before seeding generic enabled assignment rules; never edit shared QA routing for this test.',
  );
  const companyA = ok(await api(owner, '/api/companies', 'POST', { name: `${prefix} A` }), 201).company;
  companyIds.push(companyA.id);
  const companyB = ok(await api(owner, '/api/companies', 'POST', { name: `${prefix} B` }), 201).company;
  companyIds.push(companyB.id);
  const agentA = await invite('agent-a', 'agent'),
    agentB = await invite('agent-b', 'agent');
  const clientA = await invite('client-a', 'client', companyA.id),
    clientB = await invite('client-b', 'client', companyB.id);
  passed('invite-only owner, two agents and two isolated client companies');

  phase = 'policy authorization and versions';
  const initialPolicy = {
    calendar: { mode: 'always', timeZone: 'UTC', week: [], holidays: [] },
    slaHours: { urgent: 1, high: 1, normal: 2, low: 4 },
  };
  const businessPolicy = {
    calendar: {
      mode: 'business',
      timeZone: 'UTC',
      week: [1, 2, 3, 4, 5].map(day => ({ day, start: '09:00', end: '17:00' })),
      holidays: [],
    },
    slaHours: { urgent: 1, high: 3, normal: 6, low: 12 },
  };
  const inherited = ok(await api(owner, `/api/service-policies/${companyA.id}`)).policy;
  assert.equal(inherited.override, false);
  assert.equal(inherited.version, 0);
  let policy = ok(
    await api(owner, `/api/service-policies/${companyA.id}`, 'PUT', {
      expectedId: inherited.id,
      expectedVersion: 0,
      ...initialPolicy,
    }),
  ).policy;
  assert.equal(policy.override, true);
  assert.equal(policy.version, 1);
  ok(
    await api(owner, `/api/service-policies/${companyA.id}`, 'PUT', {
      expectedId: inherited.id,
      expectedVersion: 0,
      ...businessPolicy,
    }),
    409,
  );
  assert.equal(ok(await api(owner, `/api/service-policies/${companyB.id}`)).policy.override, false);
  // A version number may repeat after an override is removed and recreated.
  // The old row identity must never authorize changing or deleting its replacement.
  const policyBPath = `/api/service-policies/${companyB.id}`;
  const oldPolicyB = ok(
    await api(owner, policyBPath, 'PUT', { expectedId: null, expectedVersion: 0, ...initialPolicy }),
  ).policy;
  const inheritedB = ok(
    await api(owner, policyBPath, 'DELETE', { expectedId: oldPolicyB.id, expectedVersion: oldPolicyB.version }),
  ).policy;
  assert.equal(inheritedB.id, null);
  assert.equal(inheritedB.override, false);
  const newPolicyB = ok(
    await api(owner, policyBPath, 'PUT', { expectedId: null, expectedVersion: 0, ...businessPolicy }),
  ).policy;
  assert.notEqual(newPolicyB.id, oldPolicyB.id);
  assert.equal(newPolicyB.version, oldPolicyB.version);
  ok(
    await api(owner, policyBPath, 'PUT', {
      expectedId: oldPolicyB.id,
      expectedVersion: oldPolicyB.version,
      ...initialPolicy,
    }),
    409,
  );
  ok(await api(owner, policyBPath, 'DELETE', { expectedId: oldPolicyB.id, expectedVersion: oldPolicyB.version }), 409);
  const retainedB = ok(await api(owner, policyBPath)).policy;
  assert.equal(retainedB.id, newPolicyB.id);
  assert.deepEqual(retainedB.slaHours, businessPolicy.slaHours);
  assert.equal(
    ok(await api(owner, policyBPath, 'DELETE', { expectedId: newPolicyB.id, expectedVersion: newPolicyB.version }))
      .policy.override,
    false,
  );
  for (const actor of [agentA, clientA]) {
    ok(await api(actor, '/api/service-policies'), 403);
    ok(
      await api(actor, `/api/service-policies/${companyA.id}`, 'PUT', {
        expectedId: policy.id,
        expectedVersion: 1,
        ...businessPolicy,
      }),
      403,
    );
    ok(await api(actor, '/api/assignment-rules'), 403);
    ok(await api(actor, '/api/metrics/agents'), 403);
  }
  ok(await api(clientA, '/api/agent-availability'), 403);
  ok(
    await api(clientA, '/api/agent-availability', 'PATCH', {
      memberId: clientA.id,
      expectedVersion: 0,
      available: true,
    }),
    403,
  );
  ok(
    await api(clientA, '/api/assignment-rules', 'POST', {
      name: `${prefix} forbidden rule`,
      agentMemberIds: [agentA.id],
    }),
    403,
  );
  ok(await api(owner, '/api/metrics/agents', 'GET', undefined, { 'X-Daybook-Member-Id': clientA.id }), 409);
  ok(await api(owner, '/api/metrics/agents?from=2026-01-01&to=2027-12-31'), 400);
  passed(
    'admin-only policies/metrics/rules, member intent, company overrides, stale versions and delete/recreate identity conflicts',
  );

  phase = 'snapshot and actual-author metrics';
  const journey = (await createTicket(clientA, 'SLA journey')).ticket;
  const control = (await createTicket(clientB, 'company B control')).ticket;
  const original = await storedTicket(journey.id);
  assert.equal(original.customerCompanyId, companyA.id);
  assert.equal(original.dueAt, addSlaHours(original.createdAt, 2, initialPolicy.calendar));
  assert.deepEqual(JSON.parse(original.slaPolicySnapshot).slaHours, initialPolicy.slaHours);
  policy = ok(
    await api(owner, `/api/service-policies/${companyA.id}`, 'PUT', {
      expectedId: policy.id,
      expectedVersion: policy.version,
      ...businessPolicy,
    }),
  ).policy;
  assert.equal(
    (await storedTicket(journey.id)).dueAt,
    original.dueAt,
    'Editing policy must not rewrite an existing ticket.',
  );
  await patchTicket(journey.id, { priority: 'high' });
  const high = await storedTicket(journey.id);
  assert.equal(
    high.dueAt,
    addSlaHours(original.createdAt, 1, initialPolicy.calendar),
    'Priority change uses the ticket snapshot.',
  );
  const note = `${prefix} INTERNAL NOTE`,
    publicReply = `${prefix} public agent B reply`;
  await message(agentA, journey.id, note, 'note');
  await message(agentB, journey.id, publicReply, 'reply', true);
  const clientFeed = ok(await api(clientA, '/api/tickets/updates'));
  assert.ok(clientFeed.tickets.length <= 50);
  assert.deepEqual(clientFeed.messages, []);
  clientFeed.tickets = await readAllTicketPages(async path => ok(await api(clientA, path)));
  const clientMessages = await readAllConversationPages(async path => ok(await api(clientA, path)), journey.id);
  assert.ok(clientFeed.tickets.some(ticket => ticket.id === journey.id));
  assert.ok(!clientFeed.tickets.some(ticket => ticket.id === control.id));
  assert.ok(clientMessages.some(item => item.body === publicReply));
  assert.ok(clientMessages.every(item => item.kind !== 'note' && item.body !== note));
  assert.ok(clientFeed.tickets.every(ticket => !('slaPolicySnapshot' in ticket) && !('slaStartedAt' in ticket)));
  const otherFeed = ok(await api(clientB, '/api/tickets/updates'));
  otherFeed.tickets = await readAllTicketPages(async path => ok(await api(clientB, path)));
  ok(await api(clientB, `/api/tickets/${journey.id}/conversation`), 404);
  assert.ok(!otherFeed.tickets.some(ticket => ticket.id === journey.id));
  ok(
    await api(clientB, `/api/tickets/${journey.id}/messages`, 'POST', {
      operationId: randomUUID(),
      body: 'Forbidden cross-company comment.',
      kind: 'reply',
    }),
    404,
  );
  await patchTicket(journey.id, { status: 'resolved' });
  await patchTicket(journey.id, { status: 'resolved' });
  const firstOutcomes = await outcomes(journey.id);
  assert.equal(firstOutcomes.length, 1, 'Repeated resolved PATCH cannot fabricate another resolution.');
  assert.equal(firstOutcomes[0].actorMemberId, owner.id);
  assert.equal(firstOutcomes[0].dueAt, high.dueAt);
  assert.equal(firstOutcomes[0].policySnapshot, original.slaPolicySnapshot);
  const metrics = ok(await api(owner, `/api/metrics/agents?companyId=${companyA.id}`));
  const metricA = metrics.agents.find(item => item.memberId === agentA.id),
    metricB = metrics.agents.find(item => item.memberId === agentB.id);
  assert.ok(metricA && metricB);
  assert.equal(metricA.publicReplies, 0);
  assert.equal(metricA.firstResponseCount, 0);
  assert.equal(metricB.publicReplies, 1);
  assert.equal(metricB.firstResponseCount, 1);
  assert.equal(metrics.agents.find(item => item.memberId === owner.id).resolutions, 1);
  const metricsB = ok(await api(owner, `/api/metrics/agents?companyId=${companyB.id}`));
  assert.equal(metricsB.agents.find(item => item.memberId === agentB.id).publicReplies, 0);
  passed('two-company isolation, protected notes, snapshot priority deadlines and genuine author/resolver metrics');

  phase = 'reopening cycles';
  await patchTicket(journey.id, { status: 'open' });
  const staffReopened = await storedTicket(journey.id);
  assert.deepEqual(JSON.parse(staffReopened.slaPolicySnapshot).calendar, businessPolicy.calendar);
  assert.equal(staffReopened.dueAt, addSlaHours(staffReopened.slaStartedAt, 3, businessPolicy.calendar));
  await patchTicket(journey.id, { status: 'resolved' });
  assert.equal((await outcomes(journey.id)).length, 2);
  const changedPolicy = { ...businessPolicy, slaHours: { ...businessPolicy.slaHours, high: 4 } };
  policy = ok(
    await api(owner, `/api/service-policies/${companyA.id}`, 'PUT', {
      expectedId: policy.id,
      expectedVersion: policy.version,
      ...changedPolicy,
    }),
  ).policy;
  await message(clientA, journey.id, `${prefix} reopen as client`);
  const clientReopened = await storedTicket(journey.id);
  assert.equal(clientReopened.status, 'open');
  assert.deepEqual(JSON.parse(clientReopened.slaPolicySnapshot).slaHours, changedPolicy.slaHours);
  assert.equal(clientReopened.dueAt, addSlaHours(clientReopened.slaStartedAt, 4, businessPolicy.calendar));
  assert.equal((await outcomes(journey.id)).length, 2, 'Reopening is not a resolution.');
  passed('staff and client reopening start new SLA cycles using the current company policy');

  phase = 'availability permissions';
  const initialAvailability = ok(await api(agentA, '/api/agent-availability')).agents;
  assert.deepEqual(
    initialAvailability.map(item => item.memberId),
    [agentA.id],
  );
  let a = initialAvailability[0];
  a = ok(
    await api(agentA, '/api/agent-availability', 'PATCH', {
      memberId: agentA.id,
      expectedVersion: a.version,
      available: false,
    }),
  ).agent;
  assert.equal(a.available, false);
  a = ok(
    await api(agentA, '/api/agent-availability', 'PATCH', {
      memberId: agentA.id,
      expectedVersion: a.version,
      available: true,
    }),
  ).agent;
  ok(
    await api(agentA, '/api/agent-availability', 'PATCH', {
      memberId: agentA.id,
      expectedVersion: a.version,
      capacity: 2,
    }),
    403,
  );
  ok(
    await api(agentA, '/api/agent-availability', 'PATCH', {
      memberId: agentB.id,
      expectedVersion: 0,
      available: false,
    }),
    403,
  );
  for (const actor of [agentA, agentB]) {
    const current = await availability(actor.id);
    const saved = ok(
      await api(owner, '/api/agent-availability', 'PATCH', {
        memberId: actor.id,
        expectedVersion: current.version,
        available: true,
        capacity: 2,
      }),
    ).agent;
    assert.equal(saved.capacity, 2);
    assert.equal(saved.openTickets, 0);
    ok(
      await api(owner, '/api/agent-availability', 'PATCH', {
        memberId: actor.id,
        expectedVersion: current.version,
        available: false,
      }),
      409,
    );
  }
  passed('agents control only their own availability; administrators set capacity with concurrency protection');

  phase = 'automatic assignment concurrency';
  let rule = ok(
    await api(owner, '/api/assignment-rules', 'POST', {
      name: `${prefix} routing`,
      customerCompanyId: companyA.id,
      department,
      position: 0,
      agentMemberIds: [agentA.id, agentB.id],
    }),
    201,
  ).rule;
  ruleIds.push(rule.id);
  assert.equal(rule.enabled, false);
  const disabled = (await createTicket(clientA, 'rule disabled')).ticket;
  assert.equal(disabled.assigneeMemberId, null);
  const oldVersion = rule.version;
  rule = ok(
    await api(owner, `/api/assignment-rules/${rule.id}`, 'PATCH', { expectedVersion: oldVersion, enabled: true }),
  ).rule;
  ok(
    await api(owner, `/api/assignment-rules/${rule.id}`, 'PATCH', { expectedVersion: oldVersion, enabled: false }),
    409,
  );
  assert.equal((await storedTicket(disabled.id)).assigneeMemberId, null, 'Rules apply only to new tickets.');
  const batch = Array.from({ length: 6 }, (_, index) => ticketPayload(`concurrent ${index + 1}`));
  const batchResults = await Promise.allSettled(batch.map(payload => api(clientA, '/api/tickets', 'POST', payload)));
  const created = batchResults.map(result => {
    assert.equal(result.status, 'fulfilled');
    const ticket = ok(result.value, 201).ticket;
    ticketIds.push(ticket.id);
    return ticket;
  });
  const assigned = created.filter(ticket => ticket.assigneeMemberId),
    unassigned = created.filter(ticket => !ticket.assigneeMemberId);
  assert.equal(assigned.length, 4);
  assert.equal(unassigned.length, 2);
  assert.equal(assigned.filter(ticket => ticket.assigneeMemberId === agentA.id).length, 2);
  assert.equal(assigned.filter(ticket => ticket.assigneeMemberId === agentB.id).length, 2);
  for (const actor of [agentA, agentB]) assert.equal((await availability(actor.id)).openTickets, 2);
  for (const ticket of assigned) {
    const events = (
      await pool.query('SELECT action FROM "ticketEvents" WHERE "ownerId"=$1 AND "ticketId"=$2', [
        spaceOwnerId,
        ticket.id,
      ])
    ).rows;
    assert.equal(events.filter(item => item.action === 'automatic_assignment').length, 1);
  }
  const replayTicket = assigned[0],
    replayPayload = batch[created.findIndex(ticket => ticket.id === replayTicket.id)];
  const beforeReplay = await replayState(replayTicket.id, replayTicket.assigneeMemberId);
  const replayed = ok(await api(clientA, '/api/tickets', 'POST', replayPayload), 201).ticket;
  assert.deepEqual(replayed, replayTicket);
  assert.deepEqual(
    await replayState(replayTicket.id, replayTicket.assigneeMemberId),
    beforeReplay,
    'Replay cannot route again, add messages/events or enqueue notices.',
  );
  ok(
    await api(clientA, '/api/tickets', 'POST', {
      ...replayPayload,
      body: 'Different content with the same operation ID.',
    }),
    409,
  );
  assert.deepEqual(await replayState(replayTicket.id, replayTicket.assigneeMemberId), beforeReplay);
  report.counts.concurrent = {
    created: created.length,
    assigned: assigned.length,
    unassigned: unassigned.length,
    perAgent: 2,
  };
  passed(
    'six concurrent real creates respect two-agent capacity; idempotent replay preserves assignment, events and notices',
  );

  phase = 'explicit routing decisions';
  await patchTicket(replayTicket.id, { status: 'resolved' });
  const explicitNull = (await createTicket(clientA, 'client null routing', { assigneeMemberId: null })).ticket;
  assert.equal(
    explicitNull.assigneeMemberId,
    replayTicket.assigneeMemberId,
    'A client cannot bypass automatic routing with null.',
  );
  const manual = (
    await createTicket(owner, 'manual assignment', { requesterMemberId: clientA.id, assigneeMemberId: agentA.id })
  ).ticket;
  assert.equal(manual.assigneeMemberId, agentA.id, 'Manual decisions remain possible beyond automatic capacity.');
  const manualEvents = (
    await pool.query('SELECT action FROM "ticketEvents" WHERE "ownerId"=$1 AND "ticketId"=$2', [
      spaceOwnerId,
      manual.id,
    ])
  ).rows;
  assert.ok(manualEvents.every(item => item.action !== 'automatic_assignment'));
  rule = ok(
    await api(owner, `/api/assignment-rules/${rule.id}`, 'PATCH', { expectedVersion: rule.version, enabled: false }),
  ).rule;
  assert.equal(rule.enabled, false);
  assert.equal((await createTicket(clientA, 'rule disabled again')).ticket.assigneeMemberId, null);
  // Reuse the existing fake account to prove permissions are read from current
  // membership, rather than trusting the role captured in its signed-in session.
  ok(await api(owner, `/api/members/${agentA.id}`, 'PATCH', { role: 'admin' }));
  ok(await api(agentA, '/api/service-policies'));
  ok(await api(owner, `/api/members/${agentA.id}`, 'PATCH', { status: 'revoked' }));
  ok(await api(agentA, '/api/service-policies'), 403);
  ok(await api(agentA, '/api/metrics/agents'), 403);
  ok(await api(agentA, '/api/agent-availability'), 403);
  passed('explicit manual assignment, client null protection, disabled routing and fresh membership revocation');
  assert.deepEqual(
    await snapshotShared(),
    sharedBefore,
    'No shared settings, notification configuration or default SLA changes.',
  );
  report.counts.tickets = ticketIds.length;
  report.counts.fakeMembers = memberIds.length;
} catch (error) {
  failure = error;
  report.failedPhase = phase;
} finally {
  // Recover partially successful creates using unique fictitious identifiers.
  // No production endpoints, non-test accounts, shared defaults or other runs.
  let cleanupError;
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    if (spaceOwnerId) {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`daybook-ticket-work:${spaceOwnerId}`]);
      const recoveredMembers = (
        await tx.query('SELECT id,"userId" FROM members WHERE "ownerId"=$1 AND email LIKE $2', [
          spaceOwnerId,
          `qa-operations-%-${runId}@example.test`,
        ])
      ).rows;
      for (const row of recoveredMembers) {
        if (!memberIds.includes(row.id)) memberIds.push(row.id);
        if (row.userId && !userIds.includes(row.userId)) userIds.push(row.userId);
      }
      const recoveredCompanies = (
        await tx.query('SELECT id FROM "customerCompanies" WHERE "ownerId"=$1 AND name=ANY($2::text[])', [
          spaceOwnerId,
          [`${prefix} A`, `${prefix} B`],
        ])
      ).rows;
      for (const row of recoveredCompanies) if (!companyIds.includes(row.id)) companyIds.push(row.id);
      const recoveredTickets = (
        await tx.query(
          'SELECT id FROM tickets WHERE "ownerId"=$1 AND ("creationKey"=ANY($2::text[]) OR subject LIKE $3)',
          [spaceOwnerId, operationIds, `${prefix}%`],
        )
      ).rows;
      for (const row of recoveredTickets) if (!ticketIds.includes(row.id)) ticketIds.push(row.id);
      const mailScope =
        'SELECT id FROM "mailOutbox" WHERE "ownerId"=$1 AND ("ticketId"=ANY($2::int[]) OR "recipientMemberId"=ANY($3::text[]))';
      const values = [spaceOwnerId, ticketIds, memberIds];
      await tx.query(`DELETE FROM "mailDeliveryEvents" WHERE "outboxId" IN (${mailScope})`, values);
      await tx.query(`DELETE FROM "pushDeliveries" WHERE "eventId" IN (${mailScope})`, values);
      await tx.query(
        'DELETE FROM "mailOutbox" WHERE "ownerId"=$1 AND ("ticketId"=ANY($2::int[]) OR "recipientMemberId"=ANY($3::text[]))',
        values,
      );
      await tx.query('DELETE FROM "pushSubscriptions" WHERE "ownerId"=$1 AND "memberId"=ANY($2::text[])', [
        spaceOwnerId,
        memberIds,
      ]);
      for (const table of [
        'inboundMailReceipts',
        'ticketSatisfaction',
        'escalationOccurrences',
        'reminderOccurrences',
        'ticketSlaOutcomes',
        'attachments',
        'ticketEvents',
        'messages',
      ]) {
        await tx.query(`DELETE FROM "${table}" WHERE "ownerId"=$1 AND "ticketId"=ANY($2::int[])`, [
          spaceOwnerId,
          ticketIds,
        ]);
      }
      await tx.query('DELETE FROM attachments WHERE "ownerId"=$1 AND "memberId"=ANY($2::text[])', [
        spaceOwnerId,
        memberIds,
      ]);
      await tx.query(
        'DELETE FROM operations WHERE "ownerId"=$1 AND ("operationId"=ANY($2::text[]) OR "memberId"=ANY($3::text[]))',
        [spaceOwnerId, operationIds, memberIds],
      );
      await tx.query('DELETE FROM tickets WHERE "ownerId"=$1 AND id=ANY($2::int[])', [spaceOwnerId, ticketIds]);
      await tx.query(
        'DELETE FROM "assignmentRules" WHERE "ownerId"=$1 AND (id=ANY($2::text[]) OR "customerCompanyId"=ANY($3::text[]) OR name=$4)',
        [spaceOwnerId, ruleIds, companyIds, `${prefix} routing`],
      );
      await tx.query('DELETE FROM "servicePolicies" WHERE "ownerId"=$1 AND "customerCompanyId"=ANY($2::text[])', [
        spaceOwnerId,
        companyIds,
      ]);
      await tx.query('DELETE FROM "agentAvailability" WHERE "ownerId"=$1 AND "memberId"=ANY($2::text[])', [
        spaceOwnerId,
        memberIds,
      ]);
      await tx.query('DELETE FROM invitations WHERE "ownerId"=$1 AND "memberId"=ANY($2::text[])', [
        spaceOwnerId,
        memberIds,
      ]);
      await tx.query('DELETE FROM members WHERE "ownerId"=$1 AND id=ANY($2::text[])', [spaceOwnerId, memberIds]);
      await tx.query('DELETE FROM "customerCompanies" WHERE "ownerId"=$1 AND id=ANY($2::text[])', [
        spaceOwnerId,
        companyIds,
      ]);
      // Better Auth sessions/accounts cascade; the persistent QA owner is retained.
      await tx.query('DELETE FROM "authUser" WHERE id=ANY($1::text[]) OR email LIKE $2', [
        userIds,
        `qa-operations-%-${runId}@example.test`,
      ]);
      const remaining = (
        await tx.query(
          `SELECT
        (SELECT count(*)::integer FROM members WHERE "ownerId"=$1 AND email LIKE $2) AS members,
        (SELECT count(*)::integer FROM "authUser" WHERE email LIKE $2) AS users,
        (SELECT count(*)::integer FROM tickets WHERE "ownerId"=$1 AND (id=ANY($3::int[]) OR subject LIKE $4)) AS tickets,
        (SELECT count(*)::integer FROM "customerCompanies" WHERE "ownerId"=$1 AND id=ANY($5::text[])) AS companies,
        (SELECT count(*)::integer FROM operations WHERE "ownerId"=$1 AND "operationId"=ANY($6::text[])) AS operations,
        (SELECT count(*)::integer FROM "ticketSlaOutcomes" WHERE "ownerId"=$1 AND "ticketId"=ANY($3::int[])) AS outcomes,
        (SELECT count(*)::integer FROM "assignmentRules" WHERE "ownerId"=$1 AND name=$7) AS rules`,
          [
            spaceOwnerId,
            `qa-operations-%-${runId}@example.test`,
            ticketIds,
            `${prefix}%`,
            companyIds,
            operationIds,
            `${prefix} routing`,
          ],
        )
      ).rows[0];
      assert.ok(
        Object.values(remaining).every(value => value === 0),
        'All HTTP fixture data must be removed.',
      );
      report.remainingFixtures = remaining;
    }
    await tx.query('COMMIT');
    report.cleaned = true;
  } catch (error) {
    cleanupError = error;
    await tx.query('ROLLBACK').catch(() => {});
  } finally {
    tx.release();
  }
  // Only revoke this script's owner session; never delete other owner sessions.
  if (owner.cookies.size) {
    try {
      ok(await api(owner, '/api/auth/sign-out', 'POST', {}));
    } catch (error) {
      cleanupError ||= error;
    }
  }
  if (sharedBefore) {
    try {
      assert.deepEqual(await snapshotShared(), sharedBefore, 'Shared QA settings must be unchanged after cleanup.');
    } catch (error) {
      cleanupError ||= error;
    }
  }
  await pool.end();
  if (cleanupError) {
    report.cleaned = false;
    report.cleanupError = cleanupError.message;
    failure ||= cleanupError;
  }
  await mkdir(new URL('../work/', import.meta.url), { recursive: true });
  await writeFile(
    new URL('../work/OPERATIONS_HTTP_RESULT.json', import.meta.url),
    JSON.stringify({ ...report, ok: !failure, finishedAt: new Date().toISOString() }, null, 2) + '\n',
    { mode: 0o600 },
  );
}
if (failure) throw failure;
console.log('PASS HTTP operations: all scenarios and fixture cleanup complete; no real email or push delivery.');
