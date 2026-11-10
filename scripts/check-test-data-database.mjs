/** SERIAL. Fictitious rollback-only QA data; no deliveries or provider credentials. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { getAgentMetrics } from '../lib/agent-metrics.ts';
import { getSatisfactionReport } from '../lib/satisfaction.ts';
import { parseMetricsQuery } from '../lib/agent-metrics-model.ts';
const url = new URL(process.env.DATABASE_URL);
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
assert.equal(url.hostname, 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
assert.equal(url.pathname, '/daybook_ticket');
assert.ok(!process.env.RESEND_API_KEY && !process.env.RESEND_INBOUND_API_KEY && !process.env.VAPID_PRIVATE_KEY);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 }),
  tx = await pool.connect();
const owner = `qa-test-data-${randomUUID()}`,
  org = owner,
  agent = randomUUID(),
  client = randomUUID(),
  now = new Date().toISOString();
try {
  await tx.query('BEGIN');
  await tx.query('INSERT INTO organizations (id,"ownerId",name,"createdAt") VALUES ($1,$1,\'QA ficticio\',$2)', [
    owner,
    now,
  ]);
  for (const [id, role] of [
    [agent, 'admin'],
    [client, 'client'],
  ])
    await tx.query(
      'INSERT INTO members (id,"ownerId","organizationId",name,email,role,status,"createdAt","updatedAt") VALUES ($1,$2,$2,\'QA ficticio\',$3,$4,\'active\',$5,$5)',
      [id, owner, `${id}@example.test`, role, now],
    );
  const ticket = (
    await tx.query(
      `INSERT INTO tickets ("ownerId","creationKey",subject,"requesterName","requesterEmail","requesterMemberId",department,assignee,"assigneeMemberId",status,priority,"createdAt","updatedAt","dueAt") VALUES ($1,$2,'PRUEBA no inferida','QA cliente','client@example.test',$3,'Soporte','QA agente',$4,'open','normal',$5,$5,$5) RETURNING id`,
      [owner, randomUUID(), client, agent, now],
    )
  ).rows[0].id;
  await tx.query(
    'INSERT INTO messages ("ownerId","ticketId",author,"authorMemberId","authorRole",body,kind,"createdAt") VALUES ($1,$2,\'QA agente\',$3,\'admin\',\'QA respuesta ficticia\',\'reply\',$4)',
    [owner, ticket, agent, now],
  );
  const outcome = randomUUID();
  await tx.query(
    'INSERT INTO "ticketSlaOutcomes" (id,"ownerId","ticketId","actorMemberId","startedAt","dueAt","resolvedAt") VALUES ($1,$2,$3,$4,$5,$5,$5)',
    [outcome, owner, ticket, agent, now],
  );
  await tx.query(
    'INSERT INTO "ticketSatisfaction" (id,"ownerId","ticketId","resolutionKey","resolvedAt","requesterMemberId","resolverMemberId",score,"submittedAt","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,3,$5,$5)',
    [randomUUID(), owner, ticket, outcome, now, client, agent],
  );
  const access = { ownerId: owner, organizationId: org, role: 'admin', member: { id: agent, status: 'active' } },
    period = parseMetricsQuery(new URLSearchParams());
  const metrics = () => getAgentMetrics(tx, access, period),
    satisfaction = () => getSatisfactionReport(tx, access, period, null);
  assert.equal((await metrics()).agents[0].currentOpen, 1);
  assert.equal((await satisfaction()).totals.responses, 1, 'Name does not infer test status');
  for (const designation of ['ticket', 'member']) {
    await tx.query(
      designation === 'ticket'
        ? 'UPDATE tickets SET "isTest"=true WHERE id=$1'
        : 'UPDATE members SET "isTest"=true WHERE id=$1',
      [designation === 'ticket' ? ticket : client],
    );
    const excluded = (await metrics()).agents[0];
    assert.equal(excluded.currentOpen, 0);
    assert.equal(excluded.resolutions, 0);
    assert.equal(excluded.publicReplies, 0);
    assert.equal((await satisfaction()).totals.responses, 0);
    assert.equal((await getAgentMetrics(tx, access, { ...period, includeTests: true })).agents[0].resolutions, 1);
    assert.equal(
      (await getSatisfactionReport(tx, access, { ...period, includeTests: true }, null)).totals.averageScore,
      3,
    );
    await tx.query(
      designation === 'ticket'
        ? 'UPDATE tickets SET "isTest"=false WHERE id=$1'
        : 'UPDATE members SET "isTest"=false WHERE id=$1',
      [designation === 'ticket' ? ticket : client],
    );
  }
  assert.equal((await metrics()).agents[0].resolutions, 1);
  assert.equal((await satisfaction()).totals.responses, 1, 'Unmark restores aggregates without deleting history');
  await tx.query('ROLLBACK');
  assert.equal(
    (await tx.query('SELECT count(*)::int AS n FROM organizations WHERE "ownerId"=$1', [owner])).rows[0].n,
    0,
  );
  console.log(
    JSON.stringify({
      result: 'PASS',
      checks: [
        'explicit-designation',
        'no-text-inference',
        'requester-history',
        'workload-replies-sla-csat-exclusion',
        'include-tests',
        'reversible-without-deletion',
      ],
      fixturesRemaining: 0,
      externalEmailRequests: 0,
    }),
  );
} finally {
  await tx.query('ROLLBACK').catch(() => undefined);
  tx.release();
  await pool.end();
}
