/** SERIAL QA integration. Explicit fixed host, fictitious data, no external deliveries.
 * node --env-file=.env.test.local --import tsx scripts/check-service-plus-automation-database.mjs
 * The coordinator applies migration 0005 first. Never execute on production.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Database } from '../db/database.ts';
import {
  getEscalationPolicy,
  saveEscalationPolicy,
  enqueueTicketEscalation,
  isEscalationEligibleForDelivery,
} from '../lib/escalations.ts';
import {
  createSatisfactionForResolution,
  getTicketSatisfaction,
  submitTicketSatisfaction,
  isSatisfactionEligibleForDelivery,
  getSatisfactionReport,
} from '../lib/satisfaction.ts';
import { recordSlaOutcome } from '../lib/agent-metrics.ts';
import { parseMetricsQuery } from '../lib/agent-metrics-model.ts';
import { databaseCheckCi } from './database-check-target.mjs';
const databaseCi = databaseCheckCi();

if (!databaseCi) {
  assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
  assert.equal(
    new URL(process.env.DATABASE_URL).hostname,
    'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech',
  );
}
assert.ok(
  !process.env.RESEND_API_KEY &&
    !process.env.RESEND_INBOUND_API_KEY &&
    !process.env.DAYBOOK_EMAIL_FROM &&
    !process.env.VAPID_PRIVATE_KEY,
  'Delivery providers must remain disabled.',
);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
const database = new Database(pool),
  run = randomUUID(),
  ownerId = `qa-service-plus-${run}`,
  orgId = `qa-service-plus-${run}`;
const agentA = randomUUID(),
  agentB = randomUUID(),
  customer = randomUUID(),
  manager = randomUUID(),
  companyA = randomUUID(),
  companyB = randomUUID();
const now = new Date(),
  hour = 3600_000,
  at = delta => new Date(now.getTime() + delta).toISOString();
const member = (id, role, customerCompanyId = null, companyAccess = 'own') => ({
  id,
  name: 'QA ficticio',
  email: `${id}@example.test`,
  role,
  status: 'active',
  hasAccount: true,
  customerCompanyId,
  companyAccess,
  createdAt: at(-10 * hour),
  updatedAt: at(-10 * hour),
});
const access = (id, role, companyId = null, companyAccess = 'own') => ({
  ownerId,
  organizationId: orgId,
  userId: `qa-user-${id}`,
  role,
  member: member(id, role, companyId, companyAccess),
});
const admin = access(agentA, 'admin'),
  clientAccess = access(customer, 'client', companyA),
  managerAccess = access(manager, 'client', companyA, 'manager');
const transaction = fn => database.transaction(fn);
async function message(ticketId, role, kind, createdAt, authorId = role === 'client' ? customer : agentA) {
  return (
    await pool.query(
      'INSERT INTO messages ("ownerId","ticketId",author,"authorMemberId","authorRole",body,kind,"createdAt") VALUES ($1,$2,\'QA ficticio\',$3,$4,\'Prueba ficticia\',$5,$6) RETURNING id',
      [ownerId, ticketId, authorId, role, kind, createdAt],
    )
  ).rows[0].id;
}
async function ticket({ dueAt = at(8 * hour), clientAt = at(-5 * hour), status = 'open', assigned = agentA } = {}) {
  const row = (
    await pool.query(
      `INSERT INTO tickets ("ownerId","creationKey",subject,"requesterName","requesterEmail","requesterMemberId","customerCompanyId",department,assignee,"assigneeMemberId",status,priority,"createdAt","updatedAt","dueAt")
    VALUES ($1,$2,'QA escalamiento y encuesta','Cliente ficticio',$3,$4,$5,'Soporte','QA',$6,$7,'normal',$8,$8,$9) RETURNING *`,
      [ownerId, randomUUID(), `${customer}@example.test`, customer, companyA, assigned, status, clientAt, dueAt],
    )
  ).rows[0];
  await message(row.id, 'client', 'request', clientAt);
  return row;
}
async function occurrences(ticketId) {
  return (
    await pool.query(
      'SELECT * FROM "escalationOccurrences" WHERE "ownerId"=$1 AND "ticketId"=$2 ORDER BY "createdAt",id',
      [ownerId, ticketId],
    )
  ).rows;
}
const eligible = (row, recipientId = row.recipientMemberId) =>
  isEscalationEligibleForDelivery(
    database,
    { ownerId, ticketId: row.ticketId, recipientMemberId: recipientId, escalationId: row.id },
    now,
  );
async function resolve(row, resolvedAt = at(-60_000), resolver = agentA) {
  return transaction(async tx => {
    await tx.query('UPDATE tickets SET status=\'resolved\',"updatedAt"=$2 WHERE id=$1', [row.id, resolvedAt]);
    const resolutionKey = await recordSlaOutcome(tx, {
      ownerId,
      ticketId: row.id,
      actorMemberId: resolver,
      startedAt: row.createdAt,
      dueAt: row.dueAt,
      resolvedAt,
      customerCompanyId: row.customerCompanyId,
      policySnapshot: null,
    });
    await createSatisfactionForResolution(tx, database, {
      ownerId,
      ticketId: row.id,
      resolutionKey,
      resolvedAt,
      requesterMemberId: row.requesterMemberId,
      resolverMemberId: resolver,
      customerCompanyId: row.customerCompanyId,
    });
    return { ...row, status: 'resolved', resolutionKey };
  });
}

try {
  await pool.query('INSERT INTO organizations (id,"ownerId",name,"createdAt") VALUES ($1,$2,\'QA servicio plus\',$3)', [
    orgId,
    ownerId,
    at(-10 * hour),
  ]);
  for (const id of [companyA, companyB])
    await pool.query(
      'INSERT INTO "customerCompanies" (id,"organizationId","ownerId",name,"createdAt","updatedAt") VALUES ($1,$2,$3,\'Empresa ficticia\',$4,$4)',
      [id, orgId, ownerId, at(-10 * hour)],
    );
  for (const account of [admin.member, member(agentB, 'agent'), clientAccess.member, managerAccess.member])
    await pool.query(
      `INSERT INTO members (id,"organizationId","ownerId","userId",name,email,role,status,"customerCompanyId","companyAccess","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10,$10)`,
      [
        account.id,
        orgId,
        ownerId,
        `qa-user-${account.id}`,
        account.name,
        account.email,
        account.role,
        account.customerCompanyId,
        account.companyAccess,
        at(-10 * hour),
      ],
    );
  assert.equal((await transaction(tx => getEscalationPolicy(tx, ownerId))).enabled, false);
  const first = await ticket();
  assert.equal(
    await enqueueTicketEscalation(database, ownerId, first.id, now),
    0,
    'Default disabled means no historical escalation.',
  );
  let policy = await transaction(tx =>
    saveEscalationPolicy(
      tx,
      admin,
      { enabled: true, unansweredMinutes: 240, overdueMinutes: 60, recipientMemberIds: [agentA, agentB], version: 0 },
      new Date(at(-6 * hour)),
    ),
  );
  await assert.rejects(
    transaction(tx => saveEscalationPolicy(tx, admin, { ...policy, version: 0 })),
    error => error.status === 409,
  );
  await assert.rejects(
    transaction(tx => saveEscalationPolicy(tx, admin, { ...policy, recipientMemberIds: [customer] })),
    error => error.status === 400,
  );
  const concurrent = await Promise.all(
    Array.from({ length: 4 }, () => enqueueTicketEscalation(database, ownerId, first.id, now)),
  );
  assert.equal(
    concurrent.reduce((a, b) => a + b, 0),
    1,
    'One genuine escalation reaches the other agent.',
  );
  let rows = await occurrences(first.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].recipientMemberId, agentB);
  assert.equal(rows[0].reason, 'unanswered');
  assert.equal(await eligible(rows[0]), true);
  assert.equal(await eligible(rows[0], customer), false);
  await message(first.id, 'admin', 'note', at(-hour));
  await message(first.id, 'client', 'reply', at(-30 * 60_000));
  assert.equal(await eligible(rows[0]), true, 'Notes and additional client messages do not reset the pending clock.');
  await pool.query("UPDATE members SET status='revoked' WHERE id=$1", [agentB]);
  assert.equal(await eligible(rows[0]), false);
  await pool.query("UPDATE members SET status='active' WHERE id=$1", [agentB]);
  await pool.query('UPDATE tickets SET "assigneeMemberId"=$2 WHERE id=$1', [first.id, agentB]);
  assert.equal(await eligible(rows[0]), false, 'No escalation is delivered to the new assignee.');
  assert.equal(
    await enqueueTicketEscalation(database, ownerId, first.id, now),
    1,
    'The other current eligible recipient gets its own stage.',
  );
  await message(first.id, 'admin', 'reply', at(-1000));
  for (const row of await occurrences(first.id))
    assert.equal(await eligible(row), false, 'Public staff response cancels unanswered escalation.');
  const overdue = await ticket({ dueAt: at(-2 * hour), clientAt: at(-30 * 60_000) });
  assert.equal(await enqueueTicketEscalation(database, ownerId, overdue.id, now), 1);
  const expiredStage = (await occurrences(overdue.id))[0];
  assert.equal(expiredStage.reason, 'overdue');
  await pool.query('UPDATE tickets SET "dueAt"=$2 WHERE id=$1', [overdue.id, at(hour)]);
  assert.equal(await eligible(expiredStage), false);
  await pool.query('UPDATE tickets SET "dueAt"=$2 WHERE id=$1', [overdue.id, overdue.dueAt]);
  assert.equal(
    await enqueueTicketEscalation(database, ownerId, overdue.id, now),
    0,
    'Repeated deadline changes do not duplicate a stage.',
  );
  const historical = await ticket({ clientAt: at(-7 * hour), dueAt: at(-2 * hour) });
  assert.equal(await enqueueTicketEscalation(database, ownerId, historical.id, now), 0, 'No retroactive backlog.');
  const rollback = await ticket();
  const broken = new Database(pool);
  broken.execute = async () => {
    throw new Error('qa-outbox-failure');
  };
  await assert.rejects(enqueueTicketEscalation(broken, ownerId, rollback.id, now), /qa-outbox-failure/);
  assert.equal((await occurrences(rollback.id)).length, 0, 'Escalation and notification roll back together.');
  policy = await transaction(tx => saveEscalationPolicy(tx, admin, { ...policy, enabled: false }));
  assert.equal(await eligible(expiredStage), false);
  assert.equal(await enqueueTicketEscalation(database, ownerId, rollback.id, now), 0);

  const ratedTicket = await resolve(await ticket());
  let survey = await transaction(tx => getTicketSatisfaction(tx, clientAccess, ratedTicket));
  assert.ok(survey?.available);
  assert.equal(survey.score, null);
  assert.equal(
    await transaction(tx => getTicketSatisfaction(tx, managerAccess, ratedTicket)),
    null,
    'Company managers cannot rate another requester.',
  );
  const delivery = { ownerId, ticketId: ratedTicket.id, recipientMemberId: customer, satisfactionId: survey.id };
  assert.equal(await isSatisfactionEligibleForDelivery(database, delivery), true);
  assert.equal(await isSatisfactionEligibleForDelivery(database, { ...delivery, recipientMemberId: agentA }), false);
  const ratings = await Promise.allSettled(
    [5, 1].map(score =>
      transaction(async tx => {
        await tx.query('SELECT id FROM tickets WHERE id=$1 FOR UPDATE', [ratedTicket.id]);
        return submitTicketSatisfaction(
          tx,
          clientAccess,
          ratedTicket,
          { satisfactionId: survey.id, score, comment: 'Comentario ficticio <script>sin ejecutar</script>' },
          now,
        );
      }),
    ),
  );
  assert.equal(ratings.filter(row => row.status === 'fulfilled').length, 1, 'One rating wins concurrent submissions.');
  assert.equal(
    await isSatisfactionEligibleForDelivery(database, delivery),
    false,
    'Do not mail an already completed survey.',
  );
  survey = await transaction(tx => getTicketSatisfaction(tx, clientAccess, ratedTicket));
  assert.ok(survey.submittedAt);
  assert.equal(survey.available, false);
  const oldScore = survey.score;
  const changing = await resolve(await ticket(), at(-30_000));
  const prior = await transaction(tx => getTicketSatisfaction(tx, clientAccess, changing));
  await pool.query("UPDATE tickets SET status='open' WHERE id=$1", [changing.id]);
  assert.equal(
    await isSatisfactionEligibleForDelivery(database, { ...delivery, ticketId: changing.id, satisfactionId: prior.id }),
    false,
  );
  await assert.rejects(
    transaction(tx =>
      submitTicketSatisfaction(
        tx,
        clientAccess,
        { ...changing, status: 'open' },
        { satisfactionId: prior.id, score: 5, comment: '' },
      ),
    ),
    error => error.status === 409,
  );
  const reopened = await resolve(changing, at(-10_000), agentB);
  const nextSurvey = await transaction(tx => getTicketSatisfaction(tx, clientAccess, reopened));
  assert.notEqual(nextSurvey.id, prior.id);
  assert.equal(nextSurvey.available, true);
  await assert.rejects(
    transaction(tx =>
      submitTicketSatisfaction(tx, clientAccess, reopened, { satisfactionId: prior.id, score: 5, comment: '' }),
    ),
    error => error.status === 409,
  );
  await pool.query('UPDATE members SET "customerCompanyId"=$2 WHERE id=$1', [customer, companyB]);
  assert.equal(
    await isSatisfactionEligibleForDelivery(database, {
      ...delivery,
      ticketId: changing.id,
      satisfactionId: nextSurvey.id,
    }),
    false,
    'Company transfer revokes the old survey access.',
  );
  await pool.query('UPDATE members SET "customerCompanyId"=$2 WHERE id=$1', [customer, companyA]);
  const report = await transaction(tx =>
    getSatisfactionReport(tx, admin, parseMetricsQuery(new URLSearchParams(), now), null),
  );
  assert.equal(report.totals.responses, 1);
  assert.equal(report.totals.averageScore, oldScore);
  assert.equal(report.agents.find(row => row.id === agentA).responses, 1);
  assert.equal(report.companies.find(row => row.id === companyA).responses, 1);
  assert.equal(
    (
      await pool.query(
        'SELECT count(*)::int AS n FROM "mailOutbox" WHERE "ownerId"=$1 AND event=\'satisfaction_requested\'',
        [ownerId],
      )
    ).rows[0].n,
    3,
    'One survey mail per real resolution cycle.',
  );
  const previousSatisfactionFlag = process.env.DAYBOOK_SATISFACTION_ENABLED;
  try {
    process.env.DAYBOOK_SATISFACTION_ENABLED = 'false';
    assert.equal((await transaction(tx => getTicketSatisfaction(tx, clientAccess, reopened))).available, false);
    assert.equal(
      await isSatisfactionEligibleForDelivery(database, {
        ...delivery,
        ticketId: reopened.id,
        satisfactionId: nextSurvey.id,
      }),
      false,
    );
    await assert.rejects(
      transaction(tx =>
        submitTicketSatisfaction(tx, clientAccess, reopened, { satisfactionId: nextSurvey.id, score: 5, comment: '' }),
      ),
      error => error.status === 503,
    );
    const pausedClosure = await resolve(await ticket());
    assert.equal(
      await transaction(tx => getTicketSatisfaction(tx, clientAccess, pausedClosure)),
      null,
      'Paused closure records SLA but creates no survey.',
    );
    assert.equal(
      (
        await pool.query('SELECT count(*)::int AS n FROM "ticketSlaOutcomes" WHERE "ownerId"=$1 AND "ticketId"=$2', [
          ownerId,
          pausedClosure.id,
        ])
      ).rows[0].n,
      1,
    );
    const pausedReport = await transaction(tx =>
      getSatisfactionReport(tx, admin, parseMetricsQuery(new URLSearchParams(), now), null),
    );
    assert.deepEqual(pausedReport.totals, report.totals, 'The kill switch preserves all prior ratings and totals.');
  } finally {
    if (previousSatisfactionFlag === undefined) delete process.env.DAYBOOK_SATISFACTION_ENABLED;
    else process.env.DAYBOOK_SATISFACTION_ENABLED = previousSatisfactionFlag;
  }
  console.log(
    JSON.stringify({
      result: 'PASS',
      checks: [
        'escalation-default-off',
        'thresholds-and-other-recipient',
        'concurrent-stage-once',
        'public-clock-not-notes',
        'revocation-reassignment-deadline-revalidation',
        'no-retroactivity',
        'configuration-versioning',
        'outbox-rollback',
        'csat-current-requester-only',
        'concurrent-rating-once',
        'reopened-cycle',
        'company-transfer-revocation',
        'aggregate-frozen-attribution',
        'independent-csat-kill-switch-preserves-history',
      ],
      externalEmailRequests: 0,
    }),
  );
} finally {
  await pool.query('DELETE FROM "pushDeliveries" WHERE "ownerId"=$1', [ownerId]);
  await pool.query('DELETE FROM "mailDeliveryEvents" WHERE "ownerId"=$1', [ownerId]);
  await pool.query('DELETE FROM "mailOutbox" WHERE "ownerId"=$1', [ownerId]);
  for (const table of [
    'escalationOccurrences',
    'ticketSatisfaction',
    'ticketSlaOutcomes',
    'ticketEvents',
    'messages',
    'tickets',
    'escalationSettings',
    'members',
    'customerCompanies',
    'organizations',
  ])
    await pool.query(`DELETE FROM "${table}" WHERE "ownerId"=$1`, [ownerId]);
  const remaining = (await pool.query('SELECT count(*)::int AS n FROM organizations WHERE "ownerId"=$1', [ownerId]))
    .rows[0].n;
  assert.equal(remaining, 0);
  await pool.end();
  console.log('QA cleanup PASS: fictitious owner and all dependent rows removed.');
}
