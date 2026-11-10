/** SERIAL integration: fictitious, uniquely scoped QA fixtures only.
 * Coordinator applies 0004 and runs this after the other mutating QA suites.
 * node --env-file=.env.test.local --import tsx scripts/check-service-policies-database.mjs
 * No server, production credentials, providers, notifications or historical data.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Database } from '../db/database.ts';
import {
  deleteServicePolicy,
  getEffectiveServicePolicy,
  getServicePolicy,
  listServicePolicies,
  saveServicePolicy,
} from '../lib/service-policies.ts';
import { calculateTicketDueAt } from '../lib/sla-policy.ts';

const qaHost = 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
assert.equal(new URL(process.env.DATABASE_URL).hostname, qaHost);
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/daybook_ticket');
assert.equal(process.env.DAYBOOK_QA_DATABASE_HOST, qaHost);
assert.ok(!process.env.RESEND_API_KEY && !process.env.DAYBOOK_EMAIL_FROM && !process.env.VAPID_PRIVATE_KEY);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const database = new Database(pool);
const ownerId = randomUUID(),
  otherOwnerId = randomUUID();
const orgId = `qa-sla-${randomUUID()}`,
  otherOrgId = `qa-sla-${randomUUID()}`;
const admin = randomUUID(),
  adminUserId = randomUUID(),
  client = randomUUID(),
  clientUserId = randomUUID();
const foreignAdmin = randomUUID(),
  foreignUserId = randomUUID();
const companyA = randomUUID(),
  companyB = randomUUID(),
  foreignCompany = randomUUID();
const now = new Date().toISOString();
const legacyHours = { urgent: 4, high: 8, normal: 24, low: 72 };
const initialSettings = {
  brandName: 'QA ficticio que se conserva',
  tagline: 'QA',
  agents: ['QA admin'],
  notificationMemberIds: [admin],
  departments: ['Soporte'],
  slaHours: legacyHours,
  customSentinel: { untouched: true },
};
const office = {
  mode: 'business',
  timeZone: 'America/Santiago',
  week: [1, 2, 3, 4, 5].map(day => ({ day, start: '09:00', end: '18:00' })),
  holidays: ['2026-11-09'],
};
const always = { mode: 'always', timeZone: 'America/Santiago', week: [], holidays: [] };
const companyHours = { urgent: 1, high: 2, normal: 4, low: 8 };
const generalHours = { urgent: 4, high: 12, normal: 16, low: 48 };
const access = {
  organizationId: orgId,
  ownerId,
  userId: adminUserId,
  role: 'owner',
  member: {
    id: admin,
    name: 'QA admin',
    email: `${admin}@example.test`,
    role: 'owner',
    status: 'active',
    hasAccount: true,
    customerCompanyId: null,
    companyAccess: 'own',
    createdAt: now,
    updatedAt: now,
  },
};
const otherAccess = {
  ...access,
  organizationId: otherOrgId,
  ownerId: otherOwnerId,
  userId: foreignUserId,
  member: { ...access.member, id: foreignAdmin, email: `${foreignAdmin}@example.test` },
};
const staleClientAccess = {
  ...access,
  userId: clientUserId,
  member: { ...access.member, id: client, email: `${client}@example.test` },
};
const expectedStatus = status => error => error.status === status;
const call = work => database.transaction(work);
let checks = 0,
  fixturesCreated = false;

async function snapshotTickets() {
  return (await pool.query('SELECT * FROM tickets WHERE "ownerId"=$1 ORDER BY id', [ownerId])).rows;
}

try {
  assert.equal(
    (await pool.query(`SELECT to_regclass('public."servicePolicies"') IS NOT NULL AS ready`)).rows[0].ready,
    true,
    'Apply additive migration 0004 before this test.',
  );
  for (const [id, own] of [
    [orgId, ownerId],
    [otherOrgId, otherOwnerId],
  ]) {
    await pool.query(
      'INSERT INTO organizations (id,"ownerId",name,"createdAt") VALUES ($1,$2,\'QA ficticio SLA\',$3)',
      [id, own, now],
    );
    fixturesCreated = true;
  }
  for (const [id, user, role, organization, own] of [
    [admin, adminUserId, 'owner', orgId, ownerId],
    [client, clientUserId, 'client', orgId, ownerId],
    [foreignAdmin, foreignUserId, 'owner', otherOrgId, otherOwnerId],
  ]) {
    await pool.query(
      `INSERT INTO members (id,"organizationId","ownerId","userId",email,name,role,status,"createdAt","updatedAt")
      VALUES ($1,$2,$3,$4,$5,'QA ficticio',$6,'active',$7,$7)`,
      [id, organization, own, user, `${id}@example.test`, role, now],
    );
  }
  for (const [id, organization, own] of [
    [companyA, orgId, ownerId],
    [companyB, orgId, ownerId],
    [foreignCompany, otherOrgId, otherOwnerId],
  ]) {
    await pool.query(
      'INSERT INTO "customerCompanies" (id,"organizationId","ownerId",name,"createdAt","updatedAt") VALUES ($1,$2,$3,\'QA empresa SLA\',$4,$4)',
      [id, organization, own, now],
    );
  }
  await pool.query('UPDATE members SET "customerCompanyId"=$1 WHERE id=$2 AND "ownerId"=$3', [
    companyA,
    client,
    ownerId,
  ]);
  await pool.query('INSERT INTO settings ("ownerId",data) VALUES ($1,$2)', [ownerId, JSON.stringify(initialSettings)]);
  const initial = await call(tx => listServicePolicies(tx, access));
  assert.equal(initial.policies.length, 0);
  assert.equal(initial.defaultPolicy.id, null);
  assert.equal(initial.defaultPolicy.version, 0);
  assert.equal(initial.defaultPolicy.override, false);
  assert.deepEqual(initial.defaultPolicy.slaHours, legacyHours);
  assert.equal(initial.defaultPolicy.calendar.mode, 'always');
  assert.deepEqual(
    (await call(tx => getEffectiveServicePolicy(tx, ownerId, companyA, legacyHours))).slaHours,
    legacyHours,
  );
  checks++;

  const general = await call(tx =>
    saveServicePolicy(tx, access, 'default', {
      expectedId: null,
      expectedVersion: 0,
      calendar: office,
      slaHours: generalHours,
    }),
  );
  assert.equal(general.version, 1);
  assert.equal(general.override, true);
  let savedSettings = JSON.parse(
    (await pool.query('SELECT data FROM settings WHERE "ownerId"=$1', [ownerId])).rows[0].data,
  );
  assert.deepEqual(
    savedSettings,
    { ...initialSettings, slaHours: generalHours },
    'Only legacy SLA hours change during a default save.',
  );
  const inheritedB = await call(tx => getServicePolicy(tx, access, companyB));
  assert.equal(inheritedB.override, false);
  assert.equal(inheritedB.sourceScopeKey, 'default');
  assert.deepEqual(inheritedB.calendar, office);
  assert.deepEqual(inheritedB.slaHours, generalHours);
  checks++;

  const own = await call(tx =>
    saveServicePolicy(tx, access, companyA, {
      expectedId: null,
      expectedVersion: 0,
      calendar: always,
      slaHours: companyHours,
    }),
  );
  assert.equal(own.version, 1);
  assert.equal(own.customerCompanyId, companyA);
  const frozen = await call(tx => getEffectiveServicePolicy(tx, ownerId, companyA, legacyHours));
  assert.equal(frozen.calendar.mode, 'always');
  assert.deepEqual(frozen.slaHours, companyHours);
  assert.deepEqual(
    (await call(tx => getEffectiveServicePolicy(tx, ownerId, companyB, legacyHours))).slaHours,
    generalHours,
  );
  checks++;

  const opened = '2026-11-06T19:00:00.000Z',
    dueAt = calculateTicketDueAt(opened, 'normal', frozen);
  for (const policy of [null, JSON.stringify(frozen)])
    await pool.query(
      `INSERT INTO tickets
    ("ownerId","creationKey",subject,"requesterName","requesterEmail","requesterMemberId","customerCompanyId",department,status,priority,"createdAt","updatedAt","dueAt","slaPolicySnapshot","slaStartedAt")
    VALUES ($1,$2,'QA ticket que conserva plazo','QA cliente','client@example.test',$3,$4,'Soporte','open','normal',$5,$5,$6,$7,$8)`,
      [ownerId, randomUUID(), client, companyA, opened, dueAt, policy, policy ? opened : null],
    );
  const ticketsBefore = await snapshotTickets();

  const conflicting = await Promise.allSettled(
    [5, 6].map(normal =>
      call(tx =>
        saveServicePolicy(tx, access, companyA, {
          expectedId: own.id,
          expectedVersion: 1,
          calendar: always,
          slaHours: { ...companyHours, normal },
        }),
      ),
    ),
  );
  assert.equal(conflicting.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(conflicting.filter(result => result.status === 'rejected' && result.reason.status === 409).length, 1);
  const currentA = await call(tx => getServicePolicy(tx, access, companyA));
  assert.equal(currentA.version, 2);
  await assert.rejects(
    call(tx =>
      saveServicePolicy(tx, access, companyA, {
        expectedId: own.id,
        expectedVersion: 1,
        calendar: office,
        slaHours: companyHours,
      }),
    ),
    expectedStatus(409),
  );
  assert.deepEqual(
    await snapshotTickets(),
    ticketsBefore,
    'Policy edits never recalculate legacy or snapshotted ticket deadlines.',
  );
  assert.equal(
    calculateTicketDueAt(opened, 'normal', frozen),
    dueAt,
    'A previously captured contract remains immutable.',
  );
  checks++;

  // ABA regression on the real helper/transaction path. Recreating an override
  // resets its version to 1, but must never revive an editor's old row UUID.
  const beforeAba = await call(tx =>
    saveServicePolicy(tx, access, companyB, {
      expectedId: null,
      expectedVersion: 0,
      calendar: always,
      slaHours: companyHours,
    }),
  );
  assert.equal(beforeAba.version, 1);
  await call(tx =>
    deleteServicePolicy(tx, access, companyB, { expectedId: beforeAba.id, expectedVersion: beforeAba.version }),
  );
  const staleAbaSave = {
    expectedId: beforeAba.id,
    expectedVersion: beforeAba.version,
    calendar: office,
    slaHours: generalHours,
  };
  const staleAbaDelete = { expectedId: beforeAba.id, expectedVersion: beforeAba.version };
  await assert.rejects(
    call(tx => saveServicePolicy(tx, access, companyB, staleAbaSave)),
    expectedStatus(409),
    'A deleted row cannot be silently recreated by its stale editor.',
  );
  await assert.rejects(
    call(tx => deleteServicePolicy(tx, access, companyB, staleAbaDelete)),
    expectedStatus(409),
    'A stale delete reports conflict after removal.',
  );
  const afterAba = await call(tx =>
    saveServicePolicy(tx, access, companyB, {
      expectedId: null,
      expectedVersion: 0,
      calendar: always,
      slaHours: { ...companyHours, normal: 7 },
    }),
  );
  assert.equal(afterAba.version, beforeAba.version);
  assert.notEqual(afterAba.id, beforeAba.id);
  await assert.rejects(
    call(tx => saveServicePolicy(tx, access, companyB, staleAbaSave)),
    expectedStatus(409),
    'Same version, different row: stale PUT must conflict.',
  );
  await assert.rejects(
    call(tx => deleteServicePolicy(tx, access, companyB, staleAbaDelete)),
    expectedStatus(409),
    'Same version, different row: stale DELETE must conflict.',
  );
  assert.deepEqual(await call(tx => getServicePolicy(tx, access, companyB)), afterAba);
  assert.deepEqual(
    await snapshotTickets(),
    ticketsBefore,
    'ABA attempts cannot touch existing ticket deadlines or snapshots.',
  );
  await call(tx =>
    deleteServicePolicy(tx, access, companyB, { expectedId: afterAba.id, expectedVersion: afterAba.version }),
  );
  checks++;

  await assert.rejects(
    call(tx => getServicePolicy(tx, access, foreignCompany)),
    expectedStatus(404),
  );
  await assert.rejects(
    call(tx =>
      saveServicePolicy(tx, access, foreignCompany, {
        expectedId: null,
        expectedVersion: 0,
        calendar: always,
        slaHours: companyHours,
      }),
    ),
    expectedStatus(404),
  );
  await assert.rejects(
    call(tx => getServicePolicy(tx, otherAccess, companyA)),
    expectedStatus(404),
  );
  assert.equal((await call(tx => listServicePolicies(tx, otherAccess))).policies.length, 0);
  await assert.rejects(
    call(tx => listServicePolicies(tx, staleClientAccess)),
    expectedStatus(403),
    'The fresh member role wins over stale owner claims.',
  );
  await assert.rejects(
    call(tx =>
      saveServicePolicy(tx, staleClientAccess, 'default', {
        expectedId: general.id,
        expectedVersion: 1,
        calendar: always,
        slaHours: companyHours,
      }),
    ),
    expectedStatus(403),
  );
  await pool.query('UPDATE members SET status=\'revoked\' WHERE id=$1 AND "ownerId"=$2', [admin, ownerId]);
  await assert.rejects(
    call(tx => getServicePolicy(tx, access, 'default')),
    expectedStatus(403),
  );
  await assert.rejects(
    call(tx =>
      saveServicePolicy(tx, access, 'default', {
        expectedId: general.id,
        expectedVersion: 1,
        calendar: always,
        slaHours: companyHours,
      }),
    ),
    expectedStatus(403),
  );
  await pool.query('UPDATE members SET status=\'active\' WHERE id=$1 AND "ownerId"=$2', [admin, ownerId]);
  checks++;

  const beforeRollback = (
    await pool.query('SELECT * FROM "servicePolicies" WHERE "ownerId"=$1 ORDER BY "scopeKey"', [ownerId])
  ).rows;
  const settingsBeforeRollback = (await pool.query('SELECT data FROM settings WHERE "ownerId"=$1', [ownerId])).rows[0]
    .data;
  await assert.rejects(
    call(async tx => {
      await saveServicePolicy(tx, access, 'default', {
        expectedId: general.id,
        expectedVersion: 1,
        calendar: always,
        slaHours: { ...generalHours, normal: 22 },
      });
      throw new Error('qa-sla-rollback');
    }),
    /qa-sla-rollback/,
  );
  assert.deepEqual(
    (await pool.query('SELECT * FROM "servicePolicies" WHERE "ownerId"=$1 ORDER BY "scopeKey"', [ownerId])).rows,
    beforeRollback,
  );
  assert.equal(
    (await pool.query('SELECT data FROM settings WHERE "ownerId"=$1', [ownerId])).rows[0].data,
    settingsBeforeRollback,
  );
  checks++;

  const updatedGeneral = await call(tx =>
    saveServicePolicy(tx, access, 'default', {
      expectedId: general.id,
      expectedVersion: 1,
      calendar: office,
      slaHours: { ...generalHours, normal: 22 },
    }),
  );
  assert.equal(updatedGeneral.version, 2);
  assert.deepEqual(
    (await call(tx => getServicePolicy(tx, access, companyA))).slaHours,
    currentA.slaHours,
    'Company overrides survive default changes.',
  );
  await assert.rejects(
    call(tx => deleteServicePolicy(tx, access, companyA, { expectedId: currentA.id, expectedVersion: 1 })),
    expectedStatus(409),
  );
  const deletedA = await call(tx =>
    deleteServicePolicy(tx, access, companyA, { expectedId: currentA.id, expectedVersion: currentA.version }),
  );
  assert.equal(deletedA.override, false);
  assert.equal(deletedA.version, 0);
  assert.equal(deletedA.sourceScopeKey, 'default');
  assert.equal(deletedA.slaHours.normal, 22);
  assert.deepEqual(await snapshotTickets(), ticketsBefore);
  checks++;

  const deletedDefault = await call(tx =>
    deleteServicePolicy(tx, access, 'default', {
      expectedId: updatedGeneral.id,
      expectedVersion: updatedGeneral.version,
    }),
  );
  assert.equal(deletedDefault.override, false);
  assert.equal(deletedDefault.sourceScopeKey, 'legacy');
  assert.equal(deletedDefault.calendar.mode, 'always');
  assert.equal(deletedDefault.slaHours.normal, 22);
  savedSettings = JSON.parse(
    (await pool.query('SELECT data FROM settings WHERE "ownerId"=$1', [ownerId])).rows[0].data,
  );
  assert.deepEqual(savedSettings, { ...initialSettings, slaHours: { ...generalHours, normal: 22 } });
  assert.deepEqual(await snapshotTickets(), ticketsBefore);
  checks++;

  // Deleting an otherwise unused company removes only its override; ticket
  // snapshots have no mutable foreign-key dependency on a policy row.
  await call(tx =>
    saveServicePolicy(tx, access, companyB, {
      expectedId: null,
      expectedVersion: 0,
      calendar: always,
      slaHours: companyHours,
    }),
  );
  await pool.query('DELETE FROM "customerCompanies" WHERE id=$1 AND "ownerId"=$2', [companyB, ownerId]);
  assert.equal(
    (
      await pool.query('SELECT count(*)::int AS n FROM "servicePolicies" WHERE "ownerId"=$1 AND "scopeKey"=$2', [
        ownerId,
        companyB,
      ])
    ).rows[0].n,
    0,
  );
  assert.deepEqual(await snapshotTickets(), ticketsBefore);
  checks++;
  console.log(
    JSON.stringify({ result: 'PASS', checks, preservedFixtureTickets: ticketsBefore.length, externalNotifications: 0 }),
  );
} finally {
  if (fixturesCreated)
    for (const own of [ownerId, otherOwnerId]) {
      await pool.query('DELETE FROM "servicePolicies" WHERE "ownerId"=$1', [own]);
      await pool.query('DELETE FROM tickets WHERE "ownerId"=$1', [own]);
      await pool.query('UPDATE members SET "customerCompanyId"=NULL WHERE "ownerId"=$1', [own]);
      await pool.query('DELETE FROM "customerCompanies" WHERE "ownerId"=$1', [own]);
      await pool.query('DELETE FROM settings WHERE "ownerId"=$1', [own]);
      await pool.query('DELETE FROM members WHERE "ownerId"=$1', [own]);
      await pool.query('DELETE FROM organizations WHERE "ownerId"=$1', [own]);
      assert.equal(
        (await pool.query('SELECT count(*)::int AS n FROM "servicePolicies" WHERE "ownerId"=$1', [own])).rows[0].n,
        0,
      );
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM tickets WHERE "ownerId"=$1', [own])).rows[0].n, 0);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM members WHERE "ownerId"=$1', [own])).rows[0].n, 0);
    }
  await pool.end();
}
