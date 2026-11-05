/** SERIAL HTTP QA. Real fictitious sessions, fixed QA database, no external providers.
 * Requires the compiled QA server on 127.0.0.1:5175 and additive 0005.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { provisionOwner } from './provision-owner.mjs';

assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
assert.equal(new URL(process.env.DATABASE_URL).hostname, 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
assert.equal(process.env.DAYBOOK_SITE_URL, 'http://127.0.0.1:5175');
for (const name of ['RESEND_API_KEY', 'RESEND_INBOUND_API_KEY', 'DAYBOOK_EMAIL_FROM', 'VAPID_PRIVATE_KEY']) assert.ok(!process.env[name], `${name} must be absent.`);
const origin = process.env.DAYBOOK_SITE_URL, runId = randomUUID(), prefix = `QA service-plus automation ${runId}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 15000 });
const owner = { cookies: new Map(), ip: '198.51.100.201' }, anonymous = { cookies: new Map(), ip: '198.51.100.202' };
const memberIds = [], userIds = [], companyIds = [], ticketIds = [], operationIds = [], passed = [];
const password = process.env.DAYBOOK_QA_OWNER_PASSWORD || 'Local-QA-only!Daybook-2026';
let spaceOwnerId, failure, beforeConfig;

async function api(actor, path, method = 'GET', body, headers = {}) {
  const cookie = [...actor.cookies].map(([key, value]) => `${key}=${value}`).join('; ');
  const response = await fetch(`${origin}${path}`, { method, redirect: 'manual', signal: AbortSignal.timeout(45000), headers: {
    ...(cookie ? { cookie } : {}), 'x-vercel-forwarded-for': actor.ip,
    ...(actor.id ? { 'X-Daybook-Member-Id': actor.id } : {}),
    ...(method === 'GET' ? {} : { origin, 'content-type': 'application/json' }), ...headers,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  for (const line of response.headers.getSetCookie()) { const [part] = line.split(';'), at = part.indexOf('='); if (part.slice(at + 1)) actor.cookies.set(part.slice(0, at), part.slice(at + 1)); else actor.cookies.delete(part.slice(0, at)); }
  return { status: response.status, data: await response.json().catch(() => null) };
}
function ok(result, status = 200) { assert.equal(result.status, status, `Expected HTTP ${status}; got ${result.status}: ${result.data?.error || ''}`); return result.data; }
function success(name) { passed.push(name); console.log(`PASS HTTP service-plus: ${name}`); }
async function invite(label, role, customerCompanyId, companyAccess) {
  const actor = { cookies: new Map(), ip: `198.51.100.${203 + memberIds.length}` };
  const email = `qa-service-plus-${label}-${runId}@example.test`;
  const invited = ok(await api(owner, '/api/members', 'POST', { name: `QA ${label}`, email, role, ...(customerCompanyId ? { customerCompanyId } : {}), ...(companyAccess ? { companyAccess } : {}) }), 201);
  memberIds.push(invited.member.id);
  const registered = ok(await api(actor, '/api/auth/sign-up/email', 'POST', { email, password, name: `QA ${label}` }, { 'x-daybook-invite': new URL(invited.invitationUrl).searchParams.get('invite') }));
  if (registered.user?.id) userIds.push(registered.user.id);
  actor.id = invited.member.id; return actor;
}
async function patch(id, body, actor = owner) {
  const stored = (await pool.query('SELECT version,subject FROM tickets WHERE id=$1 AND "ownerId"=$2', [id, spaceOwnerId])).rows[0];
  assert.ok(stored?.subject.startsWith(prefix));
  return ok(await api(actor, `/api/tickets/${id}`, 'PATCH', { expectedVersion: stored.version, ...body })).ticket;
}
try {
  for (const path of ['/api/escalations', '/api/satisfaction', '/api/tickets/1/satisfaction']) ok(await api(anonymous, path), 401);
  const email = process.env.DAYBOOK_QA_OWNER_EMAIL || process.env.DAYBOOK_OWNER_EMAIL;
  assert.ok(email?.toLowerCase().endsWith('@example.test'));
  if ((await api(owner, '/api/auth/sign-in/email', 'POST', { email, password })).status !== 200) {
    const invitation = await provisionOwner(pool, { email, name: 'QA propietario', siteUrl: origin });
    ok(await api(owner, '/api/auth/sign-up/email', 'POST', { email, password, name: 'QA propietario' }, { 'x-daybook-invite': new URL(invitation.invitationUrl).searchParams.get('invite') }));
  }
  const workspace = ok(await api(owner, '/api/workspace')); owner.id = workspace.viewer.id;
  spaceOwnerId = (await pool.query('SELECT "ownerId" FROM organizations WHERE id=\'daybook\'')).rows[0].ownerId;
  beforeConfig = (await pool.query('SELECT * FROM "escalationSettings" WHERE "ownerId"=$1', [spaceOwnerId])).rows;
  for (const label of ['A', 'B']) companyIds.push(ok(await api(owner, '/api/companies', 'POST', { name: `${prefix} ${label}` }), 201).company.id);
  const agent = await invite('agent', 'agent'), client = await invite('client', 'client', companyIds[0]), manager = await invite('manager', 'client', companyIds[0], 'manager'), foreignClient = await invite('other', 'client', companyIds[1]);
  for (const actor of [agent, client, manager]) { ok(await api(actor, '/api/escalations'), 403); ok(await api(actor, '/api/satisfaction'), 403); }
  const policy = ok(await api(owner, '/api/escalations'));
  const { activatedAt: _activated, ...policyBody } = policy; void _activated;
  ok(await api(owner, '/api/escalations', 'PATCH', { ...policyBody, version: policy.version + 1 }), 409);
  ok(await api(client, '/api/escalations', 'PATCH', policyBody), 403);
  success('current-account and admin-only APIs, configuration conflict without shared edits');
  const createOperation = randomUUID(); operationIds.push(createOperation);
  const ticket = ok(await api(client, '/api/tickets', 'POST', { operationId: createOperation, subject: `${prefix} ticket`, body: 'Solicitud ficticia para evaluar atención.', department: workspace.settings.departments[0], priority: 'normal' }), 201).ticket;
  ticketIds.push(ticket.id);
  assert.equal(ok(await api(client, `/api/tickets/${ticket.id}/satisfaction`)).satisfaction, null);
  await patch(ticket.id, { status: 'resolved' }, agent);
  let survey = ok(await api(client, `/api/tickets/${ticket.id}/satisfaction`)).satisfaction;
  assert.ok(survey?.available);
  const surveyAlerts = ok(await api(client, '/api/alerts')).items.filter(item => item.ticketId === ticket.id && item.event === 'satisfaction_requested');
  assert.equal(surveyAlerts.length, 1, 'The client sees one persistent survey invitation in its alert center.');
  assert.equal(ok(await api(manager, `/api/tickets/${ticket.id}/satisfaction`)).satisfaction, null);
  ok(await api(foreignClient, `/api/tickets/${ticket.id}/satisfaction`), 404);
  ok(await api(client, `/api/tickets/${ticket.id}/satisfaction`, 'GET', undefined, { 'X-Daybook-Member-Id': owner.id }), 409);
  const payload = { operationId: randomUUID(), satisfactionId: survey.id, score: 5, comment: 'Prueba ficticia <script>sin ejecución</script>' }; operationIds.push(payload.operationId);
  ok(await api(agent, `/api/tickets/${ticket.id}/satisfaction`, 'POST', payload), 403);
  ok(await api(manager, `/api/tickets/${ticket.id}/satisfaction`, 'POST', { ...payload, operationId: randomUUID() }), 409);
  ok(await api(client, `/api/tickets/${ticket.id}/satisfaction`, 'POST', { ...payload, score: 6 }), 400);
  const rated = ok(await api(client, `/api/tickets/${ticket.id}/satisfaction`, 'POST', payload)).satisfaction;
  assert.equal(rated.score, 5); assert.equal(rated.available, false);
  assert.deepEqual(ok(await api(client, `/api/tickets/${ticket.id}/satisfaction`, 'POST', payload)).satisfaction, rated, 'Exact retry returns the original result.');
  ok(await api(client, `/api/tickets/${ticket.id}/satisfaction`, 'POST', { ...payload, score: 1 }), 409);
  const otherOperation = randomUUID(); operationIds.push(otherOperation);
  ok(await api(client, `/api/tickets/${ticket.id}/satisfaction`, 'POST', { ...payload, operationId: otherOperation }), 409);
  success('real closure creates one survey, requester-only rating and idempotent retry');
  await patch(ticket.id, { status: 'open' });
  await patch(ticket.id, { status: 'resolved' }, agent);
  survey = ok(await api(client, `/api/tickets/${ticket.id}/satisfaction`)).satisfaction;
  assert.notEqual(survey.id, rated.id); assert.equal(survey.available, true);
  await patch(ticket.id, { status: 'open' });
  const staleOperation = randomUUID(); operationIds.push(staleOperation);
  ok(await api(client, `/api/tickets/${ticket.id}/satisfaction`, 'POST', { ...payload, satisfactionId: survey.id, operationId: staleOperation }), 409);
  await patch(ticket.id, { status: 'resolved' });
  const latest = ok(await api(client, `/api/tickets/${ticket.id}/satisfaction`)).satisfaction;
  assert.notEqual(latest.id, survey.id); assert.equal(latest.available, true);
  ok(await api(owner, `/api/members/${client.id}`, 'PATCH', { customerCompanyId: companyIds[1] }));
  ok(await api(client, `/api/tickets/${ticket.id}/satisfaction`), 404);
  ok(await api(owner, `/api/members/${client.id}`, 'PATCH', { customerCompanyId: companyIds[0] }));
  ok(await api(owner, `/api/members/${client.id}`, 'PATCH', { status: 'revoked' }));
  ok(await api(client, `/api/tickets/${ticket.id}/satisfaction`), 403);
  ok(await api(owner, `/api/members/${client.id}`, 'PATCH', { status: 'active' }));
  success('reopened cycles, transferred company and revoked account re-check permissions');
  const summary = ok(await api(owner, `/api/satisfaction?companyId=${companyIds[0]}&agentId=${agent.id}`));
  assert.equal(summary.totals.responses, 1); assert.equal(summary.totals.averageScore, 5);
  assert.equal(summary.totals.invitations, 2); assert.equal(summary.agents[0].id, agent.id);
  assert.equal(summary.recent[0].comment, payload.comment, 'API preserves text; UI must escape it.');
  const outbox = (await pool.query('SELECT count(*)::int AS n,count(DISTINCT "satisfactionId")::int AS distinct_ids FROM "mailOutbox" WHERE "ownerId"=$1 AND "ticketId"=$2 AND event=\'satisfaction_requested\'', [spaceOwnerId, ticket.id])).rows[0];
  assert.equal(outbox.n, 3); assert.equal(outbox.distinct_ids, 3);
  assert.deepEqual((await pool.query('SELECT * FROM "escalationSettings" WHERE "ownerId"=$1', [spaceOwnerId])).rows, beforeConfig);
  success('frozen agent/company summaries and one invitation per actual resolution');
} catch (error) { failure = error; }
finally {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    if (spaceOwnerId) {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`daybook-ticket-work:${spaceOwnerId}`]);
      const recovered = (await tx.query('SELECT id,"userId" FROM members WHERE "ownerId"=$1 AND email LIKE $2', [spaceOwnerId, `qa-service-plus-%-${runId}@example.test`])).rows;
      for (const row of recovered) { if (!memberIds.includes(row.id)) memberIds.push(row.id); if (row.userId && !userIds.includes(row.userId)) userIds.push(row.userId); }
      for (const row of (await tx.query('SELECT id FROM tickets WHERE "ownerId"=$1 AND subject LIKE $2', [spaceOwnerId, `${prefix}%`])).rows) if (!ticketIds.includes(row.id)) ticketIds.push(row.id);
      for (const row of (await tx.query('SELECT id FROM "customerCompanies" WHERE "ownerId"=$1 AND name LIKE $2', [spaceOwnerId, `${prefix}%`])).rows) if (!companyIds.includes(row.id)) companyIds.push(row.id);
      const values = [spaceOwnerId, ticketIds, memberIds];
      const mailScope = 'SELECT id FROM "mailOutbox" WHERE "ownerId"=$1 AND ("ticketId"=ANY($2::int[]) OR "recipientMemberId"=ANY($3::text[]))';
      await tx.query(`DELETE FROM "mailDeliveryEvents" WHERE "outboxId" IN (${mailScope})`, values);
      await tx.query(`DELETE FROM "pushDeliveries" WHERE "eventId" IN (${mailScope})`, values);
      await tx.query(`DELETE FROM "mailOutbox" WHERE id IN (${mailScope})`, values);
      for (const table of ['escalationOccurrences', 'ticketSatisfaction', 'reminderOccurrences', 'ticketSlaOutcomes', 'attachments', 'ticketEvents', 'messages']) await tx.query(`DELETE FROM "${table}" WHERE "ownerId"=$1 AND "ticketId"=ANY($2::int[])`, [spaceOwnerId, ticketIds]);
      await tx.query('DELETE FROM operations WHERE "ownerId"=$1 AND ("operationId"=ANY($2::text[]) OR "memberId"=ANY($3::text[]))', [spaceOwnerId, operationIds, memberIds]);
      await tx.query('DELETE FROM tickets WHERE "ownerId"=$1 AND id=ANY($2::int[])', [spaceOwnerId, ticketIds]);
      await tx.query('DELETE FROM "agentAvailability" WHERE "ownerId"=$1 AND "memberId"=ANY($2::text[])', [spaceOwnerId, memberIds]);
      await tx.query('DELETE FROM invitations WHERE "ownerId"=$1 AND "memberId"=ANY($2::text[])', [spaceOwnerId, memberIds]);
      await tx.query('DELETE FROM members WHERE "ownerId"=$1 AND id=ANY($2::text[])', [spaceOwnerId, memberIds]);
      await tx.query('DELETE FROM "customerCompanies" WHERE "ownerId"=$1 AND id=ANY($2::text[])', [spaceOwnerId, companyIds]);
      await tx.query('DELETE FROM "authUser" WHERE id=ANY($1::text[]) OR email LIKE $2', [userIds, `qa-service-plus-%-${runId}@example.test`]);
      assert.equal((await tx.query('SELECT count(*)::int AS n FROM tickets WHERE "ownerId"=$1 AND subject LIKE $2', [spaceOwnerId, `${prefix}%`])).rows[0].n, 0);
      assert.equal((await tx.query('SELECT count(*)::int AS n FROM members WHERE "ownerId"=$1 AND email LIKE $2', [spaceOwnerId, `qa-service-plus-%-${runId}@example.test`])).rows[0].n, 0);
      const remaining = (await tx.query(`SELECT
        (SELECT count(*)::int FROM "authUser" WHERE email LIKE $2) AS users,
        (SELECT count(*)::int FROM "customerCompanies" WHERE "ownerId"=$1 AND id=ANY($3::text[])) AS companies,
        (SELECT count(*)::int FROM operations WHERE "ownerId"=$1 AND ("memberId"=ANY($4::text[]) OR "operationId"=ANY($5::text[]))) AS operations,
        (SELECT count(*)::int FROM "mailOutbox" WHERE "ownerId"=$1 AND ("ticketId"=ANY($6::int[]) OR "recipientMemberId"=ANY($4::text[]))) AS notices,
        (SELECT count(*)::int FROM "ticketSatisfaction" WHERE "ownerId"=$1 AND "ticketId"=ANY($6::int[])) AS surveys,
        (SELECT count(*)::int FROM "ticketSlaOutcomes" WHERE "ownerId"=$1 AND "ticketId"=ANY($6::int[])) AS outcomes`,
      [spaceOwnerId, `qa-service-plus-%-${runId}@example.test`, companyIds, memberIds, operationIds, ticketIds])).rows[0];
      assert.ok(Object.values(remaining).every(value => value === 0), 'All fictitious HTTP users, companies, operations, notices, surveys and outcomes must be removed.');
    }
    await tx.query('COMMIT');
  } catch (error) { await tx.query('ROLLBACK').catch(() => undefined); failure ||= error; }
  finally { tx.release(); }
  if (owner.cookies.size) { try { ok(await api(owner, '/api/auth/sign-out', 'POST', {})); } catch (error) { failure ||= error; } }
  await pool.end();
  await mkdir(new URL('../work/', import.meta.url), { recursive: true });
  await writeFile(new URL('../work/SERVICE_PLUS_AUTOMATION_HTTP_RESULT.json', import.meta.url), JSON.stringify({ ok: !failure, passed, ticketCount: ticketIds.length, fakeAccounts: memberIds.length, externalEmailRequests: 0, completedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
}
if (failure) throw failure;
console.log('PASS HTTP service-plus automation: all sessions, surveys, permissions, replays and cleanup.');
