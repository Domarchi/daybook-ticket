/** Coordinator-only SERIAL HTTP QA, after additive 0006 and a compiled QA
 * server on 127.0.0.1:5175. Fictitious accounts/tickets only; shared settings
 * are read and checked unchanged. No provider, archive or inbound retry calls.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { provisionOwner } from './provision-owner.mjs';
import { metricsDate, shiftMetricsDate } from '../lib/agent-metrics-model.ts';

assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
const databaseUrl = new URL(process.env.DATABASE_URL);
assert.equal(databaseUrl.hostname, 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
assert.equal(databaseUrl.pathname, '/daybook_ticket');
assert.equal(process.env.DAYBOOK_SITE_URL, 'http://127.0.0.1:5175');
for (const name of ['RESEND_API_KEY', 'RESEND_INBOUND_API_KEY', 'DAYBOOK_EMAIL_FROM', 'VAPID_PRIVATE_KEY']) assert.ok(!process.env[name], `${name} must be absent.`);
assert.notEqual(process.env.DAYBOOK_NOTIFICATION_JOB_ENABLED, 'true');
assert.notEqual(process.env.DAYBOOK_AUTOMATIC_BACKUP_ENABLED, 'true');
const origin = process.env.DAYBOOK_SITE_URL, runId = randomUUID(), prefix = `QA reliability ${runId}`;
const emailPattern = `qa-reliability-%-${runId}@example.test`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 15000 });
const owner = { cookies: new Map(), ip: '198.51.100.151' }, anonymous = { cookies: new Map(), ip: '198.51.100.152' };
const actors = [], memberIds = [], userIds = [], companyIds = [], ticketIds = [], operationIds = [], passed = [];
const password = process.env.DAYBOOK_QA_OWNER_PASSWORD || 'Local-QA-only!Daybook-2026';
let spaceOwnerId, failure, sharedBefore, sharedSettingsUnchanged = null;
let httpRequests = 0;

async function api(actor, path, method = 'GET', body, headers = {}) {
  assert.ok(path.startsWith('/api/') && !path.startsWith('//'), 'Only local application API paths are permitted.');
  const target = new URL(path, origin); assert.equal(target.origin, origin);
  const cookie = [...actor.cookies].map(([key, value]) => `${key}=${value}`).join('; ');
  httpRequests++;
  const response = await fetch(target, { method, redirect: 'manual', signal: AbortSignal.timeout(45000), headers: {
    ...(cookie ? { cookie } : {}), 'x-vercel-forwarded-for': actor.ip,
    ...(actor.id ? { 'X-Daybook-Member-Id': actor.id } : {}),
    ...(method === 'GET' ? {} : { origin, 'content-type': 'application/json' }), ...headers,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  for (const line of response.headers.getSetCookie()) {
    const [part] = line.split(';'), at = part.indexOf('=');
    if (part.slice(at + 1)) actor.cookies.set(part.slice(0, at), part.slice(at + 1)); else actor.cookies.delete(part.slice(0, at));
  }
  return { status: response.status, data: await response.json().catch(() => null) };
}
function ok(result, status = 200) {
  assert.equal(result.status, status, `Expected HTTP ${status}; received ${result.status}: ${result.data?.error || ''}`);
  return result.data;
}
function success(name) { passed.push(name); console.log(`PASS HTTP reliability: ${name}`); }
async function invite(label, role, customerCompanyId) {
  const actor = { cookies: new Map(), ip: `198.51.100.${153 + actors.length}`, name: `QA reliability ${label}` };
  actors.push(actor);
  const email = `qa-reliability-${label}-${runId}@example.test`;
  const invited = ok(await api(owner, '/api/members', 'POST', { name: actor.name, email, role, ...(customerCompanyId ? { customerCompanyId } : {}) }), 201);
  memberIds.push(invited.member.id); actor.id = invited.member.id;
  const registered = ok(await api(actor, '/api/auth/sign-up/email', 'POST', { email, password, name: actor.name },
    { 'x-daybook-invite': new URL(invited.invitationUrl).searchParams.get('invite') }));
  if (registered.user?.id) userIds.push(registered.user.id);
  return actor;
}
async function storedTicket(id) {
  const row = (await pool.query('SELECT id,version,subject,"isTest" FROM tickets WHERE id=$1 AND "ownerId"=$2', [id, spaceOwnerId])).rows[0];
  assert.ok(row?.subject.startsWith(prefix), 'Only this run\'s fictitious tickets may be changed.');
  return row;
}
async function patchTicket(actor, id, body, expectedStatus = 200) {
  const stored = await storedTicket(id);
  return ok(await api(actor, `/api/tickets/${id}`, 'PATCH', { expectedVersion: stored.version, ...body }), expectedStatus);
}
async function createTicket(actor, department, label) {
  const operationId = randomUUID(); operationIds.push(operationId);
  const payload = { operationId, subject: `${prefix} ${label}`, body: 'Solicitud ficticia para comprobar confiabilidad.', department, priority: 'normal' };
  const ticket = ok(await api(actor, '/api/tickets', 'POST', payload), 201).ticket;
  ticketIds.push(ticket.id);
  assert.equal(ok(await api(actor, '/api/tickets', 'POST', payload), 201).ticket.id, ticket.id, 'Creation retry remains idempotent.');
  return ticket;
}
async function message(actor, ticketId, body, kind = 'reply') {
  const operationId = randomUUID(); operationIds.push(operationId);
  return ok(await api(actor, `/api/tickets/${ticketId}/messages`, 'POST', { operationId, body, kind }), 201).message;
}
async function metrics(actor, companyId, includeTests = false) {
  const today = metricsDate(new Date()), query = new URLSearchParams({ from: shiftMetricsDate(today, -1), to: today, companyId, includeTests: String(includeTests) });
  return ok(await api(actor, `/api/metrics/agents?${query}`));
}
function agentMetric(report, id) { const row = report.agents.find(item => item.memberId === id); assert.ok(row, 'The fictitious agent must have a metrics row.'); return row; }
function assertMetric(row, { publicReplies = 0, resolutions = 0, currentOpen = 0, firstResponseCount = 0 }) {
  assert.equal(row.publicReplies, publicReplies); assert.equal(row.resolutions, resolutions);
  assert.equal(row.currentOpen, currentOpen); assert.equal(row.firstResponseCount, firstResponseCount);
}
function assertNoPrivateKeys(value) {
  const forbidden = new Set(['email', 'tabId', 'role', 'authorRole', 'envelopeJson', 'envelopeHash', 'payloadJson', 'headers', 'download_url', 'apiKey', 'tokenSecret', 'webhookSecret', 'leaseToken', 'key', 'keyId', 'pathname', 'archiveSha256']);
  const visit = item => item && typeof item === 'object' && Object.entries(item).some(([key, child]) => forbidden.has(key) || visit(child));
  assert.equal(Boolean(visit(value)), false, 'The response must not expose private fields.');
}
async function sharedSnapshot(client = pool) {
  const snapshot = {};
  for (const table of ['settings', 'notificationSettings', 'escalationSettings', 'automaticBackupSettings']) {
    snapshot[table] = (await client.query(`SELECT * FROM "${table}" WHERE "ownerId"=$1`, [spaceOwnerId])).rows;
  }
  return JSON.stringify(snapshot);
}

try {
  for (const path of ['/api/metrics/agents', '/api/email-inbound', '/api/backups/schedule', '/api/tickets/1/presence', '/api/tickets/1/progress']) ok(await api(anonymous, path), 401);
  const email = process.env.DAYBOOK_QA_OWNER_EMAIL || process.env.DAYBOOK_OWNER_EMAIL;
  assert.ok(email?.toLowerCase().endsWith('@example.test'));
  if ((await api(owner, '/api/auth/sign-in/email', 'POST', { email, password })).status !== 200) {
    const invitation = await provisionOwner(pool, { email, name: 'QA propietario', siteUrl: origin });
    ok(await api(owner, '/api/auth/sign-up/email', 'POST', { email, password, name: 'QA propietario' },
      { 'x-daybook-invite': new URL(invitation.invitationUrl).searchParams.get('invite') }));
  }
  const workspace = ok(await api(owner, '/api/workspace')); owner.id = workspace.viewer.id;
  spaceOwnerId = (await pool.query('SELECT "ownerId" FROM organizations WHERE id=\'daybook\'')).rows[0].ownerId;
  assert.equal(workspace.mailStatus.configured, false, 'The compiled server must have real mail disabled.');
  assert.equal(ok(await api(owner, '/api/push')).configured, false, 'The compiled server must have real push disabled.');
  assert.equal(ok(await api(owner, '/api/email-inbound')).configured, false, 'The compiled server must have receiving disabled.');
  sharedBefore = await sharedSnapshot();
  for (const label of ['A', 'B']) companyIds.push(ok(await api(owner, '/api/companies', 'POST', { name: `${prefix} ${label}` }), 201).company.id);
  const admin = await invite('admin', 'admin'), agent = await invite('agent', 'agent');
  const customer = await invite('client', 'client', companyIds[0]), outsider = await invite('other', 'client', companyIds[1]);
  const ticket = await createTicket(customer, workspace.settings.departments[0], 'baseline');
  assert.equal(Boolean(ticket.isTest), false, 'Fictitious names alone do not set the flag.');
  await patchTicket(admin, ticket.id, { assigneeMemberId: agent.id });
  for (const actor of [agent, customer]) {
    await patchTicket(actor, ticket.id, { isTest: true }, 403);
    ok(await api(actor, `/api/members/${customer.id}`, 'PATCH', { isTest: true }), 403);
    ok(await api(actor, '/api/metrics/agents'), 403);
    ok(await api(actor, '/api/satisfaction'), 403);
  }
  success('current-account and administrative test-flag ACL');

  const privateSentinel = `PRIVATE_RELIABILITY_NOTE_${runId}`;
  await message(agent, ticket.id, `${privateSentinel} first`, 'note');
  const publicReply = await message(agent, ticket.id, 'Respuesta pública ficticia del equipo.');
  await message(customer, ticket.id, 'Información adicional ficticia del cliente.');
  await message(agent, ticket.id, `${privateSentinel} last`, 'note');
  const progress = ok(await api(customer, `/api/tickets/${ticket.id}/progress`));
  assert.equal(progress.responsibleName, agent.name); assert.equal(progress.firstResponseAt, publicReply.createdAt);
  assert.match(progress.nextStep, /revisará tu último mensaje/); assertNoPrivateKeys(progress);
  assert.equal(JSON.stringify(progress).includes(privateSentinel), false);
  assert.deepEqual(Object.keys(progress).sort(), ['ticketId', 'status', 'responsibleName', 'receivedAt', 'firstResponseAt', 'resolvedAt', 'deadlineAt', 'nextStep'].sort());
  ok(await api(outsider, `/api/tickets/${ticket.id}/progress`), 404);
  const publicConversation = ok(await api(customer, `/api/tickets/${ticket.id}/conversation`));
  assert.equal(publicConversation.messages.some(item => item.kind === 'note' || item.body.includes(privateSentinel)), false);
  success('public progress uses actual assignee and public replies, with private notes and foreign clients excluded');

  const agentTab = randomUUID(), otherTab = randomUUID(), adminTab = randomUUID();
  ok(await api(agent, `/api/tickets/${ticket.id}/presence`, 'POST', { tabId: agentTab, activity: 'viewing' }));
  ok(await api(admin, `/api/tickets/${ticket.id}/presence`, 'POST', { tabId: adminTab, activity: 'note' }));
  let page = ok(await api(agent, `/api/tickets/${ticket.id}/presence`));
  assert.equal(page.people.length, 1); assert.equal(page.people[0].memberId, admin.id); assert.equal(page.people[0].activity, 'note'); assertNoPrivateKeys(page);
  ok(await api(agent, `/api/tickets/${ticket.id}/presence`, 'POST', { tabId: agentTab, activity: 'reply' }));
  ok(await api(agent, `/api/tickets/${ticket.id}/presence`, 'POST', { tabId: otherTab, activity: 'viewing' }));
  page = ok(await api(admin, `/api/tickets/${ticket.id}/presence`));
  assert.equal(page.people.length, 1); assert.equal(page.people[0].memberId, agent.id); assert.equal(page.people[0].activity, 'reply'); assertNoPrivateKeys(page);
  for (const [method, body] of [['GET', undefined], ['POST', { tabId: randomUUID(), activity: 'reply' }], ['DELETE', { tabId: agentTab }]]) {
    ok(await api(customer, `/api/tickets/${ticket.id}/presence`, method, body), 403);
  }
  ok(await api(agent, `/api/tickets/${ticket.id}/presence`, 'POST', { tabId: agentTab, activity: 'reply', body: 'This draft must never be accepted.' }), 400);
  ok(await api(owner, `/api/members/${agent.id}`, 'PATCH', { status: 'revoked' }));
  assert.equal(ok(await api(admin, `/api/tickets/${ticket.id}/presence`)).people.length, 0);
  ok(await api(agent, `/api/tickets/${ticket.id}/presence`, 'POST', { tabId: agentTab, activity: 'reply' }), 403);
  ok(await api(owner, `/api/members/${agent.id}`, 'PATCH', { status: 'active' }));
  for (const [actor, tabId] of [[agent, agentTab], [agent, otherTab], [admin, adminTab]]) ok(await api(actor, `/api/tickets/${ticket.id}/presence`, 'DELETE', { tabId }));
  assert.equal(ok(await api(admin, `/api/tickets/${ticket.id}/presence`)).people.length, 0);
  success('two real staff sessions see viewing and typing, deduplicate tabs, release presence, and recheck revocation');

  await patchTicket(agent, ticket.id, { status: 'resolved' });
  const baseline = { publicReplies: 1, resolutions: 1, firstResponseCount: 1 };
  assertMetric(agentMetric(await metrics(admin, companyIds[0]), agent.id), baseline);
  const beforeFlag = await storedTicket(ticket.id);
  await patchTicket(admin, ticket.id, { isTest: true });
  ok(await api(admin, `/api/tickets/${ticket.id}`, 'PATCH', { expectedVersion: beforeFlag.version, isTest: false }), 409);
  assertMetric(agentMetric(await metrics(admin, companyIds[0]), agent.id), {});
  assertMetric(agentMetric(await metrics(admin, companyIds[0], true), agent.id), baseline);
  await patchTicket(admin, ticket.id, { isTest: false });
  assertMetric(agentMetric(await metrics(admin, companyIds[0]), agent.id), baseline);
  ok(await api(admin, `/api/members/${customer.id}`, 'PATCH', { isTest: true }));
  assertMetric(agentMetric(await metrics(admin, companyIds[0]), agent.id), {});
  const inherited = await createTicket(customer, workspace.settings.departments[0], 'inherited');
  assert.equal(inherited.isTest, true, 'A new client ticket inherits the current account designation.');
  await patchTicket(admin, inherited.id, { assigneeMemberId: agent.id });
  const invalidOperation = randomUUID(); operationIds.push(invalidOperation);
  ok(await api(customer, '/api/tickets', 'POST', { operationId: invalidOperation, subject: `${prefix} forbidden override`, body: 'Fictitious request', department: workspace.settings.departments[0], isTest: false }), 400);
  assertMetric(agentMetric(await metrics(admin, companyIds[0], true), agent.id), { ...baseline, currentOpen: 1 });
  ok(await api(admin, `/api/members/${customer.id}`, 'PATCH', { isTest: false }));
  assertMetric(agentMetric(await metrics(admin, companyIds[0]), agent.id), baseline);
  assert.equal((await storedTicket(inherited.id)).isTest, true, 'Removing the account flag does not silently erase the inherited ticket flag.');
  await patchTicket(admin, inherited.id, { isTest: false });
  assertMetric(agentMetric(await metrics(admin, companyIds[0]), agent.id), { ...baseline, currentOpen: 1 });
  assert.equal(ok(await api(customer, `/api/tickets/${ticket.id}/progress`)).deadlineAt, null);
  success('test flags exclude workload/public response/SLA metrics, include explicitly, inherit on creation and reverse without deleting history');

  const health = ok(await api(admin, '/api/email-inbound'));
  assert.ok(health.health?.counts && Array.isArray(health.jobs)); assertNoPrivateKeys(health);
  for (const actor of [agent, customer]) {
    const limited = ok(await api(actor, '/api/email-inbound'));
    assert.equal('health' in limited || 'jobs' in limited || 'recent' in limited || 'domain' in limited, false);
    ok(await api(actor, `/api/email-inbound/${randomUUID()}/retry`, 'POST', { operationId: randomUUID() }), 403);
  }
  const backup = ok(await api(owner, '/api/backups/schedule'));
  assert.ok(backup.settings && backup.configuration && Array.isArray(backup.runs));
  assert.equal(backup.configuration.ready, false); assertNoPrivateKeys(backup);
  const forbiddenSettings = { enabled: false, localTime: '03:00', retention: 7, storageBudgetMiB: 512, version: backup.settings.version, planConfirmed: false };
  for (const actor of [admin, agent, customer]) {
    ok(await api(actor, '/api/backups/schedule'), 403);
    ok(await api(actor, '/api/backups/schedule', 'PATCH', forbiddenSettings), 403);
    ok(await api(actor, `/api/backups/schedule/${randomUUID()}/download`), 403);
  }
  sharedSettingsUnchanged = await sharedSnapshot() === sharedBefore;
  assert.equal(sharedSettingsUnchanged, true, 'All shared operational settings must remain unchanged.');
  success('inbound health is admin-only, backup status/settings/download are owner-only, and shared settings stay unchanged');
} catch (error) { failure = error; }
finally {
  // Close fictitious sessions before their backing accounts are removed.
  for (const actor of actors) if (actor.cookies.size) { try { await api(actor, '/api/auth/sign-out', 'POST', {}); } catch { /* DB cascade below also invalidates sessions. */ } }
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    if (spaceOwnerId) {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`daybook-ticket-work:${spaceOwnerId}`]);
      for (const row of (await tx.query('SELECT id,"userId" FROM members WHERE "ownerId"=$1 AND email LIKE $2', [spaceOwnerId, emailPattern])).rows) {
        if (!memberIds.includes(row.id)) memberIds.push(row.id);
        if (row.userId && !userIds.includes(row.userId)) userIds.push(row.userId);
      }
      for (const row of (await tx.query('SELECT id FROM "authUser" WHERE email LIKE $1', [emailPattern])).rows) if (!userIds.includes(row.id)) userIds.push(row.id);
      for (const row of (await tx.query('SELECT id FROM tickets WHERE "ownerId"=$1 AND subject LIKE $2', [spaceOwnerId, `${prefix}%`])).rows) if (!ticketIds.includes(row.id)) ticketIds.push(row.id);
      for (const row of (await tx.query('SELECT id FROM "customerCompanies" WHERE "ownerId"=$1 AND name LIKE $2', [spaceOwnerId, `${prefix}%`])).rows) if (!companyIds.includes(row.id)) companyIds.push(row.id);
      const values = [spaceOwnerId, ticketIds, memberIds];
      const mailScope = 'SELECT id FROM "mailOutbox" WHERE "ownerId"=$1 AND ("ticketId"=ANY($2::int[]) OR "recipientMemberId"=ANY($3::text[]))';
      const jobScope = 'SELECT "providerId" FROM "inboundMailJobs" WHERE "ownerId"=$1 AND ("ticketId"=ANY($2::int[]) OR "memberId"=ANY($3::text[]))';
      const attachmentScope = 'SELECT id FROM attachments WHERE "ownerId"=$1 AND ("ticketId"=ANY($2::int[]) OR "memberId"=ANY($3::text[]))';
      await tx.query(`DELETE FROM "inboundMailJobFiles" WHERE "providerId" IN (${jobScope}) OR "attachmentId" IN (${attachmentScope})`, values);
      await tx.query(`DELETE FROM "inboundMailJobs" WHERE "providerId" IN (${jobScope})`, values);
      await tx.query('DELETE FROM "inboundMailReceipts" WHERE "ownerId"=$1 AND ("ticketId"=ANY($2::int[]) OR "memberId"=ANY($3::text[]))', values);
      await tx.query('DELETE FROM "ticketPresence" WHERE "ownerId"=$1 AND ("ticketId"=ANY($2::int[]) OR "memberId"=ANY($3::text[]))', values);
      await tx.query(`DELETE FROM "mailDeliveryEvents" WHERE "outboxId" IN (${mailScope})`, values);
      await tx.query(`DELETE FROM "pushDeliveries" WHERE "eventId" IN (${mailScope}) OR "subscriptionId" IN (SELECT id FROM "pushSubscriptions" WHERE "ownerId"=$1 AND "memberId"=ANY($3::text[]))`, values);
      await tx.query(`DELETE FROM "mailOutbox" WHERE id IN (${mailScope})`, values);
      for (const table of ['escalationOccurrences', 'ticketSatisfaction', 'reminderOccurrences', 'ticketSlaOutcomes', 'attachments', 'ticketEvents', 'messages']) {
        await tx.query(`DELETE FROM "${table}" WHERE "ownerId"=$1 AND "ticketId"=ANY($2::int[])`, [spaceOwnerId, ticketIds]);
      }
      await tx.query('DELETE FROM operations WHERE "ownerId"=$1 AND ("operationId"=ANY($2::text[]) OR "memberId"=ANY($3::text[]))', [spaceOwnerId, operationIds, memberIds]);
      await tx.query('DELETE FROM tickets WHERE "ownerId"=$1 AND id=ANY($2::int[])', [spaceOwnerId, ticketIds]);
      await tx.query('DELETE FROM "pushSubscriptions" WHERE "ownerId"=$1 AND "memberId"=ANY($2::text[])', [spaceOwnerId, memberIds]);
      await tx.query('DELETE FROM "agentAvailability" WHERE "ownerId"=$1 AND "memberId"=ANY($2::text[])', [spaceOwnerId, memberIds]);
      await tx.query('DELETE FROM invitations WHERE "ownerId"=$1 AND "memberId"=ANY($2::text[])', [spaceOwnerId, memberIds]);
      await tx.query('DELETE FROM members WHERE "ownerId"=$1 AND id=ANY($2::text[])', [spaceOwnerId, memberIds]);
      await tx.query('DELETE FROM "customerCompanies" WHERE "ownerId"=$1 AND id=ANY($2::text[])', [spaceOwnerId, companyIds]);
      await tx.query('DELETE FROM "authUser" WHERE id=ANY($1::text[]) OR email LIKE $2', [userIds, emailPattern]);
      const remaining = (await tx.query(`SELECT
        (SELECT count(*)::int FROM "authUser" WHERE email LIKE $2) AS users,
        (SELECT count(*)::int FROM members WHERE "ownerId"=$1 AND email LIKE $2) AS members,
        (SELECT count(*)::int FROM tickets WHERE "ownerId"=$1 AND id=ANY($3::int[])) AS tickets,
        (SELECT count(*)::int FROM "customerCompanies" WHERE "ownerId"=$1 AND id=ANY($4::text[])) AS companies,
        (SELECT count(*)::int FROM operations WHERE "ownerId"=$1 AND ("memberId"=ANY($5::text[]) OR "operationId"=ANY($6::text[]))) AS operations,
        (SELECT count(*)::int FROM "mailOutbox" WHERE "ownerId"=$1 AND ("ticketId"=ANY($3::int[]) OR "recipientMemberId"=ANY($5::text[]))) AS notices,
        (SELECT count(*)::int FROM "ticketPresence" WHERE "ownerId"=$1 AND ("ticketId"=ANY($3::int[]) OR "memberId"=ANY($5::text[]))) AS presence,
        (SELECT count(*)::int FROM "inboundMailJobs" WHERE "ownerId"=$1 AND ("ticketId"=ANY($3::int[]) OR "memberId"=ANY($5::text[]))) AS inbound,
        (SELECT count(*)::int FROM "ticketSatisfaction" WHERE "ownerId"=$1 AND "ticketId"=ANY($3::int[])) AS surveys,
        (SELECT count(*)::int FROM "ticketSlaOutcomes" WHERE "ownerId"=$1 AND "ticketId"=ANY($3::int[])) AS outcomes`,
      [spaceOwnerId, emailPattern, ticketIds, companyIds, memberIds, operationIds])).rows[0];
      assert.equal(Object.values(remaining).every(value => value === 0), true, 'All fictitious users, tickets, operations, notices and dependent rows must be removed.');
      if (sharedBefore) {
        sharedSettingsUnchanged = await sharedSnapshot(tx) === sharedBefore;
        assert.equal(sharedSettingsUnchanged, true, 'Cleanup must preserve shared operational settings.');
      }
    }
    await tx.query('COMMIT');
  } catch (error) { await tx.query('ROLLBACK').catch(() => undefined); failure ||= error; }
  finally { tx.release(); }
  if (owner.cookies.size) { try { ok(await api(owner, '/api/auth/sign-out', 'POST', {})); } catch (error) { failure ||= error; } }
  await pool.end();
  await mkdir(new URL('../work/', import.meta.url), { recursive: true });
  await writeFile(new URL('../work/RELIABILITY_HTTP_RESULT.json', import.meta.url), JSON.stringify({ ok: !failure, passed,
    ticketCount: ticketIds.length, fictitiousAccounts: memberIds.length, localHttpRequests: httpRequests,
    externalEmailRequests: 0, sharedSettingsUnchanged, completedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
}
if (failure) throw failure;
console.log('PASS HTTP reliability: permissions, flags, reporting, presence, public progress, health, owner-only backups and fixture cleanup.');
