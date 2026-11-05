/** Serial integration. Fictitious data, fixed QA host, no delivery providers.
 * Coordinator runs after additive migration 0004; never against production.
 * node --env-file=.env.test.local --import tsx scripts/check-agent-metrics-database.mjs
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { getAgentMetrics, recordSlaOutcome } from '../lib/agent-metrics.ts';
import { parseMetricsQuery } from '../lib/agent-metrics-model.ts';

assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
assert.equal(new URL(process.env.DATABASE_URL).hostname, 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
assert.ok(!process.env.RESEND_API_KEY && !process.env.DAYBOOK_EMAIL_FROM && !process.env.VAPID_PRIVATE_KEY);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
const run = randomUUID(), owner = `qa-metrics-${run}`, otherOwner = `qa-metrics-other-${run}`;
const org = `qa-metrics-${run}`, otherOrg = `qa-metrics-other-${run}`;
const company = randomUUID(), secondCompany = randomUUID(), foreignCompany = randomUUID();
const agentA = randomUUID(), agentB = randomUUID(), customer = randomUUID();
const now = '2026-11-04T19:00:00.000Z';
const tickets = [];
async function ticket(companyId, status, assignee, createdAt = '2026-11-01T12:00:00.000Z', ticketOwner = owner) {
  const result = await client.query(`INSERT INTO tickets ("ownerId","creationKey",subject,"requesterName","requesterEmail",department,status,priority,assignee,"assigneeMemberId","customerCompanyId","createdAt","updatedAt","dueAt")
    VALUES ($1,$2,'QA métricas','Cliente ficticio','client@example.test','Soporte',$3,'normal','QA',$4,$5,$6,$6,'2026-11-05T12:00:00.000Z') RETURNING id`, [ticketOwner, randomUUID(), status, assignee, companyId, createdAt]);
  tickets.push(result.rows[0].id); return result.rows[0].id;
}
async function message(ticketId, memberId, role, kind, createdAt, ticketOwner = owner) {
  await client.query('INSERT INTO messages ("ownerId","ticketId",author,"authorMemberId","authorRole",body,kind,"createdAt") VALUES ($1,$2,\'QA ficticio\',$3,$4,\'Contenido ficticio\',$5,$6)', [ticketOwner, ticketId, memberId, role, kind, createdAt]);
}
try {
  await client.query('BEGIN');
  await client.query('INSERT INTO organizations (id,"ownerId",name,"createdAt") VALUES ($1,$2,\'QA métricas\',$5),($3,$4,\'QA ajeno\',$5)', [org, owner, otherOrg, otherOwner, now]);
  for (const [id, ticketOwner, organization] of [[company, owner, org], [secondCompany, owner, org], [foreignCompany, otherOwner, otherOrg]]) await client.query('INSERT INTO "customerCompanies" (id,"ownerId","organizationId",name,"createdAt","updatedAt") VALUES ($1,$2,$3,\'QA empresa\',$4,$4)', [id, ticketOwner, organization, now]);
  for (const [id, role] of [[agentA, 'admin'], [agentB, 'agent'], [customer, 'client']]) await client.query('INSERT INTO members (id,"organizationId","ownerId","userId",name,email,role,status,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,\'QA integrante\',$5,$6,\'active\',$7,$7)', [id, org, owner, randomUUID(), `${id}@example.test`, role, now]);
  const resolved = await ticket(company, 'resolved', agentA);
  await message(resolved, customer, 'client', 'request', '2026-11-01T12:00:00.000Z');
  await message(resolved, agentB, 'agent', 'note', '2026-11-01T13:00:00.000Z');
  await message(resolved, agentA, 'admin', 'reply', '2026-11-01T14:00:00.000Z');
  await message(resolved, agentB, 'agent', 'reply', '2026-11-01T16:00:00.000Z');
  const pending = await ticket(company, 'pending', agentB, '2026-11-02T12:00:00.000Z');
  await message(pending, agentA, 'admin', 'request', '2026-11-02T12:00:00.000Z');
  await message(pending, customer, 'client', 'reply', '2026-11-02T12:30:00.000Z');
  await message(pending, agentB, 'agent', 'reply', '2026-11-02T15:00:00.000Z');
  const unknown = await ticket(company, 'resolved', null);
  await message(unknown, null, null, 'reply', '2026-11-01T13:00:00.000Z');
  await message(unknown, agentB, 'agent', 'reply', '2026-11-01T15:00:00.000Z');
  const unknownRole = await ticket(company, 'resolved', null);
  await message(unknownRole, agentB, 'legacy-role', 'note', '2026-11-01T12:30:00.000Z');
  await message(unknownRole, agentB, 'legacy-role', 'reply', '2026-11-01T13:00:00.000Z');
  await message(unknownRole, agentB, 'agent', 'reply', '2026-11-01T15:00:00.000Z');
  const legacy = await ticket(secondCompany, 'resolved', agentB);
  await message(legacy, agentB, 'agent', 'reply', '2026-11-01T14:00:00.000Z');
  await ticket(company, 'open', agentA, '2026-10-01T12:00:00.000Z');
  const foreign = await ticket(foreignCompany, 'open', null, '2026-11-01T12:00:00.000Z', otherOwner);
  await message(foreign, agentA, 'admin', 'reply', '2026-11-01T12:30:00.000Z', otherOwner);
  const base = { ownerId: owner, ticketId: resolved, actorMemberId: agentA, startedAt: '2026-11-01T12:00:00.000Z', dueAt: '2026-11-01T16:00:00.000Z', resolvedAt: '2026-11-01T17:00:00.000Z', customerCompanyId: company, policySnapshot: '{"qa":"frozen"}' };
  await recordSlaOutcome(client, base);
  await recordSlaOutcome(client, { ...base, actorMemberId: agentB, startedAt: '2026-11-02T12:00:00.000Z', resolvedAt: '2026-11-02T15:00:00.000Z', dueAt: '2026-11-02T16:00:00.000Z' });
  await recordSlaOutcome(client, { ...base, ticketId: unknown, actorMemberId: agentA, startedAt: null, resolvedAt: '2026-11-03T15:00:00.000Z', dueAt: '2026-11-03T16:00:00.000Z' });
  await assert.rejects(recordSlaOutcome(client, { ...base, ticketId: foreign }), error => error.status === 400);
  await assert.rejects(recordSlaOutcome(client, { ...base, actorMemberId: customer }), error => error.status === 400);
  await assert.rejects(recordSlaOutcome(client, { ...base, customerCompanyId: foreignCompany }), error => error.status === 400);
  // Edits after a resolution cannot rewrite its saved due date/company.
  await client.query('UPDATE tickets SET "dueAt"=\'2026-11-10T12:00:00.000Z\',"customerCompanyId"=$2 WHERE id=$1', [resolved, secondCompany]);
  await client.query('UPDATE members SET status=\'revoked\' WHERE id=$1', [agentB]);
  const access = { organizationId: org, ownerId: owner, userId: 'qa-identity', role: 'admin', member: { id: agentA } };
  const params = new URLSearchParams('from=2026-11-01&to=2026-11-03');
  const report = await getAgentMetrics(client, access, parseMetricsQuery(params, new Date(now)), new Date(now));
  const a = report.agents.find(row => row.memberId === agentA), b = report.agents.find(row => row.memberId === agentB);
  assert.equal(report.agents.length, 2); assert.equal(a.currentOpen, 1); assert.equal(b.currentPending, 1);
  assert.equal(a.firstResponseCount, 1); assert.equal(a.averageFirstResponseHours, 2);
  assert.equal(b.firstResponseCount, 2); assert.equal(b.averageFirstResponseHours, 2.5);
  assert.equal(a.publicReplies, 1); assert.equal(b.publicReplies, 5);
  assert.equal(a.resolutions, 2); assert.equal(a.measurableResolutions, 1); assert.equal(a.averageResolutionHours, 5); assert.equal(a.slaCompliancePercent, 50);
  assert.equal(b.resolutions, 1); assert.equal(b.averageResolutionHours, 3); assert.equal(b.slaCompliancePercent, 100); assert.equal(b.status, 'revoked');
  assert.equal(report.coverage.unknownPublicReplies, 2); assert.equal(report.coverage.unknownFirstResponseTickets, 2); assert.equal(report.coverage.historicalResolvedWithoutMeasurement, 2);
  const selected = await getAgentMetrics(client, access, parseMetricsQuery(new URLSearchParams(`${params}&companyId=${company}`), new Date(now)));
  assert.equal(selected.agents.find(row => row.memberId === agentA).resolutions, 2, 'Outcomes keep their company snapshot after the ticket moves');
  assert.equal(selected.agents.find(row => row.memberId === agentA).firstResponseCount, 0, 'Public-response filters use the present ticket company');
  await assert.rejects(getAgentMetrics(client, access, parseMetricsQuery(new URLSearchParams(`${params}&companyId=${foreignCompany}`), new Date(now))), error => error.status === 400);
  for (const role of ['client', 'agent']) await assert.rejects(getAgentMetrics(client, { ...access, role }, parseMetricsQuery(params, new Date(now))), error => error.status === 403);
  await client.query('ROLLBACK');
  const leftovers = (await client.query('SELECT count(*)::int AS n FROM organizations WHERE "ownerId"=ANY($1::text[])', [[owner, otherOwner]])).rows[0].n;
  assert.equal(leftovers, 0);
  console.log(JSON.stringify({ result: 'PASS', checks: ['real-author-first-response', 'notes-excluded', 'unknown-authors-and-non-null-roles', 'elapsed-hours', 'current-load', 'frozen-sla-company', 'reopening-cycles', 'tenant-company-scope', 'admin-only', 'rollback-cleanup'], externalEmailRequests: 0, fixturesRemaining: 0 }));
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally { client.release(); await pool.end(); }
