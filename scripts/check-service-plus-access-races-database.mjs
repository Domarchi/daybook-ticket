/** Serial isolated QA: stale authorization snapshots and a real lock-order race.
 * No HTTP/provider calls. Fixture owner and every dependent row are removed.
 * node --env-file=.env.test.local --import tsx scripts/check-service-plus-access-races-database.mjs
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Database } from '../db/database.ts';
import { getPool } from '../db/index.ts';
import { publicMember } from '../lib/access.ts';
import { getTicket } from '../lib/server.ts';
import { getConversationPage } from '../lib/ticket-search.ts';
import { getAlertsPage, markAlertsRead } from '../lib/alerts.ts';
import { lockTicket, runOperation } from '../lib/ticket-mutations.ts';
import { recordSlaOutcome } from '../lib/agent-metrics.ts';
import { createSatisfactionForResolution, isSatisfactionEligibleForDelivery } from '../lib/satisfaction.ts';
import { databaseCheckCi } from './database-check-target.mjs';
import { seedQaWorkspaceProfiles } from './qa-workspace-profile.mjs';
const databaseCi = databaseCheckCi();

if (!databaseCi) {
  assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
  assert.equal(
    new URL(process.env.DATABASE_URL).hostname,
    'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech',
  );
  assert.equal(process.env.DAYBOOK_QA_DATABASE_HOST, 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
}
assert.ok(
  !process.env.RESEND_API_KEY &&
    !process.env.RESEND_INBOUND_API_KEY &&
    !process.env.DAYBOOK_EMAIL_FROM &&
    !process.env.VAPID_PRIVATE_KEY,
);
const run = randomUUID(),
  ownerId = `qa-access-races-${run}`,
  orgId = `qa-access-races-${run}`;
const staffId = randomUUID(),
  clientId = randomUUID(),
  managerId = randomUUID(),
  otherClientId = randomUUID(),
  companyA = randomUUID(),
  companyB = randomUUID();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 }),
  database = new Database(pool),
  appPool = getPool();
const now = new Date().toISOString(),
  cutoff = new Date(Date.now() - 60000).toISOString();
const originalFetch = globalThis.fetch,
  originalCsat = process.env.DAYBOOK_SATISFACTION_ENABLED;
let externalCalls = 0,
  messageOperation,
  deliveryOperation,
  releaseWriter;
const checks = [];
function deferred() {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return { promise, resolve };
}
async function context(id) {
  const member = (await pool.query('SELECT * FROM members WHERE id=$1 AND "ownerId"=$2', [id, ownerId])).rows[0];
  return {
    ownerId,
    organizationId: orgId,
    userId: member.userId,
    role: member.role,
    member: publicMember({ ...member, hasAccount: true }),
  };
}
async function event(recipient, ticketId, kind = 'agent_replied', satisfactionId = null) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO "mailOutbox" (id,"ownerId","eventKey",event,"recipientMemberId","ticketId","satisfactionId",status,"createdAt","updatedAt")
    VALUES ($1,$2,$1,$3,$4,$5,$6,'awaiting_configuration',$7,$7)`,
    [id, ownerId, kind, recipient, ticketId, satisfactionId, now],
  );
  return id;
}
async function unread(id) {
  return (await pool.query('SELECT "readAt" FROM "mailOutbox" WHERE id=$1 AND "ownerId"=$2', [id, ownerId])).rows[0]
    .readAt;
}
async function forbidden(stale, ids, ticketId) {
  const all = await getAlertsPage(stale),
    unreadPage = await getAlertsPage(stale, { filter: 'unread', limit: 20 });
  assert.equal(all.items.length, 0);
  assert.equal(all.unreadCount, 0);
  assert.equal(unreadPage.items.length, 0);
  assert.equal(unreadPage.unreadCount, 0);
  await markAlertsRead(stale, { ids });
  await markAlertsRead(stale, { all: true });
  for (const id of ids) assert.equal(await unread(id), null, 'A stale scope must not mark an inaccessible event read.');
  await assert.rejects(getTicket(stale, ticketId), error => error.status === 404);
  await assert.rejects(
    getConversationPage(stale, ticketId),
    error => error.status === 404,
    'No metadata survives a stale conversation context.',
  );
}

try {
  globalThis.fetch = async () => {
    externalCalls++;
    throw new Error('External requests forbidden in this QA fixture.');
  };
  process.env.DAYBOOK_SATISFACTION_ENABLED = 'true';
  await pool.query(
    'INSERT INTO organizations (id,"ownerId",name,"createdAt") VALUES ($1,$2,\'QA authorization races\',$3)',
    [orgId, ownerId, now],
  );
  await seedQaWorkspaceProfiles(pool, [ownerId]);
  await pool.query('INSERT INTO "notificationSettings" ("ownerId","alertsActivatedAt") VALUES ($1,$2)', [
    ownerId,
    cutoff,
  ]);
  for (const id of [companyA, companyB])
    await pool.query(
      'INSERT INTO "customerCompanies" (id,"organizationId","ownerId",name,"createdAt","updatedAt") VALUES ($1,$2,$3,\'QA company\',$4,$4)',
      [id, orgId, ownerId, now],
    );
  for (const [id, role, companyId, access] of [
    [staffId, 'agent', null, 'own'],
    [clientId, 'client', companyA, 'own'],
    [managerId, 'client', companyA, 'manager'],
    [otherClientId, 'client', companyB, 'own'],
  ]) {
    await pool.query(
      `INSERT INTO members (id,"organizationId","ownerId","userId",email,name,role,status,"customerCompanyId","companyAccess","createdAt","updatedAt")
      VALUES ($1,$2,$3,$4,$5,'QA viewer',$6,'active',$7,$8,$9,$9)`,
      [id, orgId, ownerId, randomUUID(), `${id}@example.test`, role, companyId, access, now],
    );
  }
  const makeTicket = async (requester, company, status) =>
    (
      await pool.query(
        `INSERT INTO tickets ("ownerId","creationKey",subject,"requesterName","requesterEmail","requesterMemberId","customerCompanyId",department,status,"createdAt","updatedAt","dueAt")
    VALUES ($1,$2,'QA private subject','QA client','client@example.test',$3,$4,'Soporte',$5,$6,$6,$7) RETURNING *`,
        [ownerId, randomUUID(), requester, company, status, now, new Date(Date.now() + 3600000).toISOString()],
      )
    ).rows[0];
  const ownTicket = await makeTicket(clientId, companyA, 'resolved'),
    foreignTicket = await makeTicket(otherClientId, companyB, 'open');
  for (const ticket of [ownTicket, foreignTicket])
    await pool.query(
      `INSERT INTO messages ("ownerId","ticketId",author,"authorMemberId","authorRole",body,kind,"createdAt") VALUES ($1,$2,'QA client',$3,'client','QA public message','request',$4)`,
      [ownerId, ticket.id, ticket.requesterMemberId, now],
    );
  const staffEvents = [await event(staffId, foreignTicket.id), await event(staffId, foreignTicket.id, 'escalation')];
  const clientEvent = await event(clientId, ownTicket.id),
    managerEvent = await event(managerId, ownTicket.id);
  const staff = await context(staffId),
    client = await context(clientId),
    manager = await context(managerId);
  assert.equal((await getAlertsPage(staff)).unreadCount, 2);
  assert.equal((await getAlertsPage(client)).unreadCount, 1);
  assert.equal((await getAlertsPage(manager)).unreadCount, 1);

  await pool.query('UPDATE members SET role=\'client\',"customerCompanyId"=$2 WHERE id=$1', [staffId, companyA]);
  await forbidden(staff, staffEvents, foreignTicket.id);
  assert.equal((await getAlertsPage(await context(staffId))).unreadCount, 0);
  await pool.query('UPDATE members SET role=\'agent\',"customerCompanyId"=NULL WHERE id=$1', [staffId]);
  checks.push('stale-staff-to-client');

  await pool.query("UPDATE members SET status='revoked' WHERE id=$1", [staffId]);
  await forbidden(staff, staffEvents, foreignTicket.id);
  await pool.query("UPDATE members SET status='active' WHERE id=$1", [staffId]);
  checks.push('stale-revoked-member');

  await pool.query('UPDATE members SET "customerCompanyId"=$2 WHERE id=$1', [clientId, companyB]);
  await forbidden(client, [clientEvent], ownTicket.id);
  await pool.query('UPDATE members SET "customerCompanyId"=$2 WHERE id=$1', [clientId, companyA]);
  checks.push('stale-company-transfer');

  await pool.query('UPDATE members SET "companyAccess"=\'own\' WHERE id=$1', [managerId]);
  await forbidden(manager, [managerEvent], ownTicket.id);
  await pool.query('UPDATE members SET "companyAccess"=\'manager\' WHERE id=$1', [managerId]);
  checks.push('stale-company-manager-permission');

  await pool.query('UPDATE members SET "userId"=$2 WHERE id=$1', [staffId, randomUUID()]);
  await forbidden(staff, staffEvents, foreignTicket.id);
  await pool.query('UPDATE members SET "userId"=$2 WHERE id=$1', [staffId, staff.userId]);
  checks.push('stale-account-binding');
  assert.equal(
    (await getAlertsPage(staff)).unreadCount,
    2,
    'Restored valid contexts keep their authorized unread alerts.',
  );

  const resolutionAt = new Date(Date.now() + 100).toISOString();
  const surveyId = await database.transaction(async tx => {
    const key = await recordSlaOutcome(tx, {
      ownerId,
      ticketId: ownTicket.id,
      actorMemberId: staffId,
      startedAt: now,
      dueAt: ownTicket.dueAt,
      resolvedAt: resolutionAt,
      customerCompanyId: companyA,
      policySnapshot: null,
    });
    return createSatisfactionForResolution(tx, database, {
      ownerId,
      ticketId: ownTicket.id,
      resolutionKey: key,
      resolvedAt: resolutionAt,
      requesterMemberId: clientId,
      resolverMemberId: staffId,
      customerCompanyId: companyA,
    });
  });
  assert.ok(surveyId);
  const surveyToManager = await event(managerId, ownTicket.id, 'satisfaction_requested', surveyId);
  const surveyToStaff = await event(staffId, ownTicket.id, 'satisfaction_requested', surveyId);
  assert.equal(
    (await getAlertsPage(manager)).items.some(item => item.id === surveyToManager),
    false,
  );
  assert.equal(
    (await getAlertsPage(staff)).items.some(item => item.id === surveyToStaff),
    false,
  );
  await markAlertsRead(manager, { ids: [surveyToManager] });
  await markAlertsRead(staff, { ids: [surveyToStaff] });
  assert.equal(await unread(surveyToManager), null);
  assert.equal(await unread(surveyToStaff), null);
  checks.push('survey-alert-requester-only');

  const held = deferred(),
    release = deferred(),
    observed = deferred();
  releaseWriter = release.resolve;
  messageOperation = runOperation(
    client,
    randomUUID(),
    'message',
    { ticketId: ownTicket.id, body: 'QA concurrent client reply', kind: 'reply' },
    async (tx, fresh) => {
      held.resolve();
      await release.promise;
      const ticket = await lockTicket(tx, fresh, ownTicket.id);
      const message = (
        await tx.query(
          `INSERT INTO messages ("ownerId","ticketId",author,"authorMemberId","authorRole",body,kind,"createdAt") VALUES ($1,$2,'QA client',$3,'client','QA concurrent client reply','reply',$4) RETURNING id,"ticketId"`,
          [ownerId, ticket.id, clientId, new Date().toISOString()],
        )
      ).rows[0];
      await tx.query('UPDATE tickets SET status=\'open\',version=version+1 WHERE id=$1 AND "ownerId"=$2', [
        ticket.id,
        ownerId,
      ]);
      return { message };
    },
  );
  await Promise.race([
    held.promise,
    messageOperation.then(() => {
      throw new Error('Writer completed before the concurrency checkpoint.');
    }),
  ]);
  class ObservedDatabase extends Database {
    transaction(work) {
      return super.transaction(async tx => {
        const pid = (await tx.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        observed.resolve(pid);
        return work(tx);
      });
    }
  }
  deliveryOperation = isSatisfactionEligibleForDelivery(new ObservedDatabase(pool), {
    ownerId,
    ticketId: ownTicket.id,
    recipientMemberId: clientId,
    satisfactionId: surveyId,
  });
  const pid = await Promise.race([
    observed.promise,
    deliveryOperation.then(() => {
      throw new Error('Delivery completed before its concurrency checkpoint.');
    }),
  ]);
  let blocked = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const waiting = (await pool.query("SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'", [pid]))
      .rows.length;
    if (waiting) {
      blocked = true;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(blocked, 'The delivery genuinely overlaps the writer holding the membership lock.');
  release.resolve();
  const concurrent = await Promise.allSettled([messageOperation, deliveryOperation]);
  assert.equal(concurrent[0].status, 'fulfilled', 'The public comment must not lose a deadlock race.');
  assert.equal(concurrent[1].status, 'fulfilled', 'Delivery eligibility must not deadlock against the public comment.');
  assert.equal(
    concurrent[1].value,
    false,
    'The completed client reply reopened the ticket before delivery was checked.',
  );
  assert.equal((await pool.query('SELECT status FROM tickets WHERE id=$1', [ownTicket.id])).rows[0].status, 'open');
  checks.push('csat-delivery-public-comment-lock-order');
  assert.equal(externalCalls, 0);
  console.log(
    JSON.stringify({ result: 'PASS', checks, realConcurrentConnections: 2, externalRequests: externalCalls }),
  );
} finally {
  releaseWriter?.();
  await Promise.allSettled([messageOperation, deliveryOperation].filter(Boolean));
  globalThis.fetch = originalFetch;
  if (originalCsat === undefined) delete process.env.DAYBOOK_SATISFACTION_ENABLED;
  else process.env.DAYBOOK_SATISFACTION_ENABLED = originalCsat;
  for (const table of [
    'pushDeliveries',
    'mailDeliveryEvents',
    'mailOutbox',
    'ticketSatisfaction',
    'ticketSlaOutcomes',
    'ticketEvents',
    'messages',
    'tickets',
    'operations',
    'notificationSettings',
    'members',
    'customerCompanies',
    'workspaceProfiles',
    'organizations',
  ])
    await pool.query(`DELETE FROM "${table}" WHERE "ownerId"=$1`, [ownerId]);
  for (const table of [
    'mailOutbox',
    'ticketSatisfaction',
    'messages',
    'tickets',
    'operations',
    'members',
    'organizations',
  ])
    assert.equal(
      (await pool.query(`SELECT count(*)::int AS n FROM "${table}" WHERE "ownerId"=$1`, [ownerId])).rows[0].n,
      0,
    );
  await pool.end();
  await appPool.end();
  console.log('QA cleanup PASS: only this fictitious owner was removed; zero fixture rows remain.');
}
