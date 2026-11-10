/** Coordinator only. Public fixtures roll back; the quota race uses an isolated fictitious schema, then removes it. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { resolveWorkspaceAccess, ticketAccessSql, canAccessTicket } from '../lib/access.ts';
import { acceptInvitation, hashInvite, readInvitation } from '../lib/invitations.ts';
import {
  transferWorkspaceOwner,
  changePilot,
  listPlatformWorkspaces,
  createPilot,
  renewPilotOwnerInvitation,
  workspaceOperationalInTransaction,
  lockWorkspaceState,
  assertWorkspaceOperational,
} from '../lib/workspaces.ts';
import { DEFAULT_PILOT_LIMITS, operatorGranted } from '../lib/workspace-model.ts';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
assert.equal(
  new URL(process.env.DATABASE_URL).hostname,
  'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech',
);
for (const key of ['RESEND_API_KEY', 'RESEND_INBOUND_API_KEY', 'VAPID_PRIVATE_KEY']) assert.ok(!process.env[key]);
const target = new URL(process.env.DATABASE_URL);
assert.equal(target.pathname, '/daybook_ticket');
target.hostname = 'ep-falling-water-bbfa4ijl.c-15.us-east-1.aws.neon.tech';
target.searchParams.set('sslmode', 'verify-full');
// Session search_path belongs to a dedicated connection, never a transaction pool.
const pool = new pg.Pool({ connectionString: target.href, max: 3 }),
  client = await pool.connect();
const run = randomUUID(),
  now = new Date().toISOString(),
  before = new Date(Date.now() - 1000).toISOString(),
  month = now.slice(0, 7),
  shared = randomUUID(),
  other = randomUUID(),
  invitee = randomUUID(),
  outsider = randomUUID(),
  session = randomUUID();
const scopes = { a: { id: randomUUID(), ownerId: randomUUID() }, b: { id: randomUUID(), ownerId: randomUUID() } };
let savepoint = 0;
const database = {
  prepare(sql) {
    const statement = (values = []) => ({
      sql,
      values,
      async all() {
        const r = await client.query(sql, values);
        return { results: r.rows, meta: { changes: r.rowCount || 0 } };
      },
      async first() {
        return (await client.query(sql, values)).rows[0] || null;
      },
      async run() {
        const r = await client.query(sql, values);
        return { results: r.rows, meta: { changes: r.rowCount || 0 } };
      },
    });
    return {
      ...statement(),
      bind(...values) {
        return statement(values);
      },
    };
  },
  async execute(statement) {
    const r = await client.query(statement.sql, statement.values);
    return { results: r.rows, meta: { changes: r.rowCount || 0 } };
  },
  async transaction(work) {
    const name = `commercial_${++savepoint}`;
    await client.query(`SAVEPOINT ${name}`);
    try {
      const result = await work(client);
      await client.query(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (error) {
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      throw error;
    }
  },
};
const request = id => new Request(`https://qa.example.test/api/workspaces/${id}/tickets`),
  identity = { userId: shared, sessionId: session };
const snapshot = async () => {
  const result = {};
  for (const table of ['organizations', 'workspaceProfiles', 'authUser', 'members', 'tickets', 'messages'])
    result[table] = Number((await client.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n);
  return result;
};
const inventory = await snapshot();
async function member(scope, userId, role, name, email) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO members(id,"organizationId","ownerId","userId",name,email,role,status,"createdAt","updatedAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
    [id, scope.id, scope.ownerId, userId, name, email, role, userId ? 'active' : 'invited', now],
  );
  return id;
}
async function ticket(scope, memberId, subject) {
  return (
    await client.query(
      `INSERT INTO tickets("ownerId","creationKey",subject,"requesterName","requesterEmail","requesterMemberId",department,"createdAt","updatedAt","dueAt") VALUES($1,$2,$3,'Fictitious client','qa@example.test',$4,'QA',$5,$5,$5) RETURNING id`,
      [scope.ownerId, randomUUID(), subject, memberId, now],
    )
  ).rows[0].id;
}
try {
  await client.query('BEGIN');
  for (const [id, name] of [
    [shared, 'Shared identity'],
    [other, 'Other identity'],
    [invitee, 'Invited identity'],
    [outsider, 'Operator without membership'],
  ]) {
    await client.query(
      'INSERT INTO "authUser"(id,name,email,"emailVerified","twoFactorEnabled","createdAt","updatedAt") VALUES($1,$2,$3,true,true,$4,$4)',
      [id, name, `${id}@example.test`, now],
    );
    await client.query(
      'INSERT INTO "securityProfiles"("userId","recoveryAcknowledgedAt","updatedAt") VALUES($1,$2,$2)',
      [id, now],
    );
  }
  await client.query(
    'INSERT INTO "authSession"(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,NOW()+interval \'1 day\',$4,$4)',
    [session, `qa-${randomUUID()}`, shared, now],
  );
  await client.query(
    'INSERT INTO "securityAssurances"("sessionId","userId","passwordVerifiedAt","mfaVerifiedAt","updatedAt") VALUES($1,$2,$3,$3,$3)',
    [session, shared, now],
  );
  for (const scope of Object.values(scopes)) {
    await client.query('INSERT INTO organizations(id,"ownerId",name,"createdAt") VALUES($1,$2,$3,$4)', [
      scope.id,
      scope.ownerId,
      `Fictitious ${run}`,
      now,
    ]);
    await client.query(
      'INSERT INTO "workspaceProfiles"("workspaceId","ownerId",state,"brandName","limitsJson","createdAt","updatedAt") VALUES($1,$2,\'active\',\'QA\',$3,$4,$4)',
      [scope.id, scope.ownerId, JSON.stringify(DEFAULT_PILOT_LIMITS), now],
    );
    await client.query(
      'INSERT INTO "securityPolicies"("ownerId","requireStaffMfa","activatedAt",version,"updatedAt") VALUES($1,true,$2,1,$3)',
      [scope.ownerId, before, now],
    );
  }
  const ownerA = await member(scopes.a, shared, 'owner', 'Owner A', `${shared}@example.test`),
    agentA = await member(scopes.a, other, 'agent', 'Agent A', `${other}@example.test`),
    ownerB = await member(scopes.b, other, 'owner', 'Owner B', `${other}@example.test`),
    clientB = await member(scopes.b, shared, 'client', 'Client B', `${shared}@example.test`);
  const a = await resolveWorkspaceAccess(identity, request(scopes.a.id), {}, database),
    b = await resolveWorkspaceAccess(identity, request(scopes.b.id), {}, database);
  assert.equal(a.role, 'owner');
  assert.equal(b.role, 'client');
  assert.notEqual(a.member.id, b.member.id);
  assert.equal(a.sessionId, b.sessionId);
  const ta = await ticket(scopes.a, ownerA, 'Private company A'),
    tb = await ticket(scopes.b, clientB, 'Own company B'),
    otherTicket = await ticket(scopes.b, ownerB, 'Another contact B');
  assert.equal(
    canAccessTicket(b, { ownerId: scopes.a.ownerId, requesterMemberId: ownerA, customerCompanyId: null }),
    false,
  );
  const sql = ticketAccessSql(b, 't', 1),
    visible = (await client.query(`SELECT id FROM tickets t WHERE ${sql.sql}`, sql.values)).rows.map(row => row.id);
  assert.deepEqual(visible, [tb]);
  assert.ok(!visible.includes(ta) && !visible.includes(otherTicket));
  const contexts = await Promise.all([
    resolveWorkspaceAccess(identity, request(scopes.a.id), {}, database),
    resolveWorkspaceAccess(identity, request(scopes.b.id), {}, database),
  ]);
  assert.deepEqual(
    contexts.map(x => x.role),
    ['owner', 'client'],
  );
  assert.equal(
    operatorGranted(
      { userId: outsider, email: 'operator@example.test' },
      { DAYBOOK_PLATFORM_OPERATOR_USER_IDS: outsider },
    ),
    true,
  );
  await assert.rejects(
    () => resolveWorkspaceAccess({ userId: outsider, sessionId: session }, request(scopes.a.id), {}, database),
    error => error.status === 403,
  );
  const tokens = [randomUUID().replaceAll('-', '').repeat(2), randomUUID().replaceAll('-', '').repeat(2)],
    pending = [];
  for (const [index, scope] of Object.values(scopes).entries()) {
    const id = await member(scope, null, 'client', 'Invitee', `${invitee}@example.test`);
    pending.push(id);
    await client.query(
      'INSERT INTO invitations("memberId","ownerId","tokenHash","expiresAt","createdAt") VALUES($1,$2,$3,$4,$5)',
      [id, scope.ownerId, await hashInvite(tokens[index]), new Date(Date.now() + 60000).toISOString(), now],
    );
  }
  const pilot = await createPilot(
    {
      name: 'Fictitious manual pilot',
      ownerName: 'Fictitious pilot owner',
      ownerEmail: `pilot-${run}@example.test`,
      limits: DEFAULT_PILOT_LIMITS,
    },
    database,
    { userId: shared, email: `${shared}@example.test` },
  );
  const originalToken = new URL(pilot.invitationUrl).searchParams.get('invite');
  assert.ok(await readInvitation(database, originalToken));
  const renewed = await renewPilotOwnerInvitation(pilot.workspaceId, 0, database, {
    userId: shared,
    email: `${shared}@example.test`,
  });
  assert.notEqual(renewed.invitationUrl, pilot.invitationUrl);
  assert.equal(await readInvitation(database, originalToken), null);
  assert.equal(
    (await client.query('SELECT \"userId\" FROM members WHERE \"organizationId\"=$1', [pilot.workspaceId])).rows[0]
      .userId,
    null,
    'Creating a pilot never grants the operator content membership.',
  );
  const accepted = await acceptInvitation(database, tokens[0], { userId: invitee, email: `${invitee}@example.test` });
  assert.equal(accepted.workspaceId, scopes.a.id);
  assert.equal((await client.query('SELECT status FROM members WHERE id=$1', [pending[1]])).rows[0].status, 'invited');
  assert.deepEqual(
    await acceptInvitation(database, tokens[0], { userId: invitee, email: `${invitee}@example.test` }),
    accepted,
  );
  await assert.rejects(
    () => acceptInvitation(database, tokens[1], { userId: shared, email: `${shared}@example.test` }),
    error => error.status === 403,
  );
  await client.query('UPDATE "securityAssurances" SET "mfaVerifiedAt"=NULL WHERE "sessionId"=$1', [session]);
  await assert.rejects(
    () => resolveWorkspaceAccess(identity, request(scopes.a.id), {}, database),
    error => error.status === 428,
  );
  assert.equal((await resolveWorkspaceAccess(identity, request(scopes.b.id), {}, database)).role, 'client');
  await client.query('UPDATE "securityAssurances" SET "mfaVerifiedAt"=$1 WHERE "sessionId"=$2', [now, session]);
  await transferWorkspaceOwner(a, agentA, database);
  assert.equal(
    (await client.query('SELECT "ownerId" FROM organizations WHERE id=$1', [scopes.a.id])).rows[0].ownerId,
    scopes.a.ownerId,
  );
  assert.equal(
    (await client.query('SELECT "ownerId" FROM tickets WHERE id=$1', [ta])).rows[0].ownerId,
    scopes.a.ownerId,
  );
  await client.query('UPDATE "workspaceProfiles" SET state=\'suspended\' WHERE "workspaceId"=$1', [scopes.a.id]);
  await assert.rejects(
    () => resolveWorkspaceAccess(identity, request(scopes.a.id), {}, database),
    error => error.status === 423,
  );
  assert.equal((await resolveWorkspaceAccess(identity, request(scopes.b.id), {}, database)).role, 'client');
  assert.equal(await workspaceOperationalInTransaction(scopes.a.ownerId, client), false);
  assert.equal(await workspaceOperationalInTransaction(scopes.b.ownerId, client), true);
  await client.query('UPDATE \"workspaceProfiles\" SET state=\'draft\' WHERE \"workspaceId\"=$1', [scopes.a.id]);
  await assert.rejects(
    () =>
      resolveWorkspaceAccess(
        { userId: other },
        new Request(`https://qa.example.test/api/workspaces/${scopes.a.id}/security/export`),
        { allowSecuritySetup: true },
        database,
      ),
    error => error.status === 423,
  );
  assert.equal(
    (
      await resolveWorkspaceAccess(
        { userId: other },
        new Request(`https://qa.example.test/api/workspaces/${scopes.a.id}/security`),
        { allowSecuritySetup: true },
        database,
      )
    ).workspaceSetup,
    true,
  );
  const cap = {
    members: 100,
    ticketsMonthly: 1000,
    messagesMonthly: 10000,
    storageBytes: 1048576000,
    mailMonthly: 10000,
    maxActiveWorkspaces: 3,
  };
  await assert.rejects(
    () => changePilot(scopes.a.id, { state: 'active', expectedVersion: 0, capacityConfirmed: true }, database, cap),
    error => error.status === 409,
  );
  await client.query(
    'INSERT INTO "evolutionFeatures"("ownerId","featuresJson",version,"updatedAt") VALUES($1,$2,1,$3)',
    [scopes.a.ownerId, JSON.stringify({ security: true, workspaces: true }), now],
  );
  await changePilot(scopes.a.id, { state: 'active', expectedVersion: 0, capacityConfirmed: true }, database, cap);
  await client.query("UPDATE members SET status='revoked' WHERE id=$1", [clientB]);
  await assert.rejects(
    () => resolveWorkspaceAccess(identity, request(scopes.b.id), {}, database),
    error => error.status === 403,
  );
  const consoleData = await listPlatformWorkspaces(database),
    own = consoleData.find(row => row.workspaceId === scopes.a.id);
  assert.ok(own);
  assert.ok(!JSON.stringify(own).includes('Private company A'));
  assert.ok(!('ownerId' in own));
  await client.query('SAVEPOINT quota');
  await client.query('UPDATE "workspaceProfiles" SET "limitsJson"=$1 WHERE "workspaceId"=$2', [
    JSON.stringify({ ...DEFAULT_PILOT_LIMITS, ticketsMonthly: 1 }),
    scopes.a.id,
  ]);
  await assert.rejects(() => ticket(scopes.a, ownerA, 'Quota must reject'), /workspace_quota_exceeded/);
  await client.query('ROLLBACK TO SAVEPOINT quota');
  console.log(
    JSON.stringify({
      publicFixtures: true,
      rolesAcrossTabs: ['owner', 'client'],
      exactInvites: true,
      revocation: true,
      mfa: true,
      stableIsolationKey: true,
      quota: true,
      month,
      externalDeliveries: 0,
    }),
  );
} finally {
  await client.query('ROLLBACK');
  assert.deepEqual(await snapshot(), inventory);
  client.release();
}
// Actual concurrent transactions exercise the exact migration function against schema-only fixtures.
const schema = `qa_commercial_${randomUUID().replaceAll('-', '')}`,
  left = await pool.connect(),
  right = await pool.connect();
assert.ok(/^qa_commercial_[a-f0-9]{32}$/.test(schema));
try {
  await left.query(`CREATE SCHEMA "${schema}"`);
  for (const connection of [left, right]) {
    await connection.query(`SET search_path TO "${schema}",public`);
    assert.equal((await connection.query('SELECT current_schema() AS name')).rows[0].name, schema);
  }
  await left.query(
    'CREATE TABLE "workspaceProfiles"("workspaceId" text,"ownerId" text PRIMARY KEY,state text,"limitsJson" text,"quotaEpoch" bigint DEFAULT 0)',
  );
  await left.query('CREATE TABLE organizations(id text PRIMARY KEY,"ownerId" text UNIQUE)');
  await left.query('CREATE TABLE articles(id text PRIMARY KEY,body text)');
  await left.query('CREATE TABLE tickets(id integer PRIMARY KEY,"ownerId" text,"createdAt" text)');
  const source = await readFile(new URL('../drizzle-postgres/0013_workspaces.sql', import.meta.url), 'utf8'),
    functionSql = source.match(/CREATE FUNCTION "daybook_workspace_quota"\(\)[\s\S]+?END; \$\$;/)?.[0];
  assert.ok(functionSql);
  await left.query(functionSql);
  await left.query(
    'CREATE TRIGGER "quota_fixture" BEFORE INSERT ON tickets FOR EACH ROW EXECUTE FUNCTION "daybook_workspace_quota"()',
  );
  await left.query(
    'INSERT INTO "workspaceProfiles"("ownerId",state,"limitsJson") VALUES(\'fictitious\',\'active\',$1)',
    [JSON.stringify({ ...DEFAULT_PILOT_LIMITS, ticketsMonthly: 1 })],
  );
  const results = await Promise.allSettled([
    left.query("INSERT INTO tickets VALUES(1,'fictitious',$1)", [now]),
    right.query("INSERT INTO tickets VALUES(2,'fictitious',$1)", [now]),
  ]);
  const outcomes = results.map(result =>
    result.status === 'fulfilled'
      ? { status: result.status }
      : { status: result.status, code: result.reason.code, message: result.reason.message },
  );
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, JSON.stringify(outcomes));
  assert.equal(
    results.filter(result => result.status === 'rejected' && result.reason.message === 'workspace_quota_exceeded')
      .length,
    1,
    JSON.stringify(outcomes),
  );
  assert.equal((await left.query('SELECT count(*)::int AS n FROM tickets')).rows[0].n, 1);
  const pauseOwner = `qa-editorial-${run}`,
    pauseWorkspace = randomUUID();
  await left.query('INSERT INTO organizations VALUES($1,$2)', [pauseWorkspace, pauseOwner]);
  await left.query(
    'INSERT INTO "workspaceProfiles"("workspaceId","ownerId",state,"limitsJson") VALUES($1,$2,\'active\',$3)',
    [pauseWorkspace, pauseOwner, JSON.stringify(DEFAULT_PILOT_LIMITS)],
  );
  await left.query('BEGIN');
  await lockWorkspaceState(left, pauseOwner);
  await assertWorkspaceOperational(pauseOwner, left);
  await left.query("INSERT INTO articles VALUES('editorial-fixture','Content before pause')");
  await right.query('BEGIN');
  await right.query("SET LOCAL lock_timeout='100ms'");
  await assert.rejects(
    () => lockWorkspaceState(right, pauseOwner, true),
    error => error.code === '55P03',
  );
  await right.query('ROLLBACK');
  await left.query('COMMIT');
  await right.query('BEGIN');
  await lockWorkspaceState(right, pauseOwner, true);
  await right.query('UPDATE "workspaceProfiles" SET state=\'suspended\' WHERE "ownerId"=$1', [pauseOwner]);
  await right.query('COMMIT');
  await left.query('BEGIN');
  await lockWorkspaceState(left, pauseOwner);
  await assert.rejects(
    () => assertWorkspaceOperational(pauseOwner, left),
    error => error.status === 423,
  );
  await left.query('ROLLBACK');
  assert.equal(
    (await left.query("SELECT body FROM articles WHERE id='editorial-fixture'")).rows[0].body,
    'Content before pause',
  );
  console.log(
    JSON.stringify({
      concurrentQuotaWinners: 1,
      pauseWaitedForEditorialCommit: true,
      pausedAccessRejected: true,
      editorialContentPreserved: true,
      isolatedSchema: true,
    }),
  );
} finally {
  for (const connection of [left, right]) {
    await connection.query('ROLLBACK').catch(() => undefined);
    await connection.query('SET search_path TO public');
  }
  await left.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  left.release();
  right.release();
  await pool.end();
}
