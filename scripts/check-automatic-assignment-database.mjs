/** Serial QA integration. Fictitious owner/org, no app server, auth credentials,
 * provider API calls or notifications. Coordinator applies migration first.
 * node --env-file=.env.test.local --import tsx scripts/check-automatic-assignment-database.mjs
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Database } from '../db/database.ts';
import { getPool } from '../db/index.ts';
import { chooseAutomaticAssignee } from '../lib/automatic-assignment.ts';
import {
  createAssignmentRule, updateAssignmentRule, deleteAssignmentRule,
  updateAgentAvailability, listAgentAvailability,
} from '../lib/assignment-rules.ts';

assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
assert.equal(new URL(process.env.DATABASE_URL).hostname, 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
assert.equal(process.env.DAYBOOK_QA_DATABASE_HOST, 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
assert.ok(!process.env.RESEND_API_KEY && !process.env.DAYBOOK_EMAIL_FROM && !process.env.VAPID_PRIVATE_KEY);
const ownerId = randomUUID(), otherOwnerId = randomUUID();
const orgId = `qa-assignment-${randomUUID()}`, otherOrgId = `qa-assignment-${randomUUID()}`;
const owner = randomUUID(), userId = randomUUID(), a = randomUUID(), b = randomUUID(), c = randomUUID(), client = randomUUID(), foreign = randomUUID();
const company = randomUUID(), otherCompany = randomUUID(), now = new Date().toISOString();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
const database = new Database(pool);
const access = { organizationId: orgId, ownerId, userId, role: 'owner', member: {
  id: owner, name: 'QA admin', email: `${owner}@example.test`, role: 'owner', status: 'active', hasAccount: true,
  customerCompanyId: null, companyAccess: 'own', createdAt: now, updatedAt: now,
} };
const scope = { customerCompanyId: company, department: 'Soporte técnico' };
const expectedStatus = status => error => error.status === status;
let checks = 0;
async function chooseAndInsert() {
  return database.transaction(async tx => {
    const selected = await chooseAutomaticAssignee(tx, ownerId, scope, new Date().toISOString());
    if (!selected) return null;
    const row = (await tx.query(`INSERT INTO tickets
      ("ownerId","creationKey",subject,"requesterName","requesterEmail","customerCompanyId",department,assignee,"assigneeMemberId",status,priority,"createdAt","updatedAt","dueAt")
      VALUES ($1,$2,'QA reparto','QA cliente','client@example.test',$3,$4,$5,$6,'open','normal',$7,$7,$8) RETURNING id`,
    [ownerId, randomUUID(), company, scope.department, selected.name, selected.id, now, new Date(Date.parse(now) + 86400_000).toISOString()])).rows[0];
    return { ...selected, ticketId: row.id };
  });
}

try {
  for (const [id, own] of [[orgId, ownerId], [otherOrgId, otherOwnerId]]) {
    await pool.query('INSERT INTO organizations (id,"ownerId",name,"createdAt") VALUES ($1,$2,\'QA ficticio reparto\',$3)', [id, own, now]);
  }
  const users = new Map([[owner, userId]]);
  for (const [id, role, organizationId, own] of [[owner, 'owner', orgId, ownerId], [a, 'agent', orgId, ownerId], [b, 'agent', orgId, ownerId], [c, 'admin', orgId, ownerId], [client, 'client', orgId, ownerId], [foreign, 'agent', otherOrgId, otherOwnerId]]) {
    const account = users.get(id) || randomUUID(); users.set(id, account);
    await pool.query(`INSERT INTO members (id,"organizationId","ownerId","userId",email,name,role,status,"createdAt","updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$8)`, [id, organizationId, own, account, `${id}@example.test`, `QA ${role}`, role, now]);
  }
  for (const [id, organizationId, own] of [[company, orgId, ownerId], [otherCompany, otherOrgId, otherOwnerId]]) {
    await pool.query('INSERT INTO "customerCompanies" (id,"organizationId","ownerId",name,"createdAt","updatedAt") VALUES ($1,$2,$3,\'QA empresa\',$4,$4)', [id, organizationId, own, now]);
  }
  await pool.query('INSERT INTO settings ("ownerId",data) VALUES ($1,$2)', [ownerId, JSON.stringify({ departments: ['Soporte técnico', 'Ventas'] })]);
  const input = { name: 'QA reparto por carga', customerCompanyId: company, department: 'Soporte técnico', enabled: false, position: 10, agentMemberIds: [a, b] };
  await assert.rejects(createAssignmentRule(access, { ...input, agentMemberIds: [client] }), expectedStatus(400));
  await assert.rejects(createAssignmentRule(access, { ...input, agentMemberIds: [foreign] }), expectedStatus(400));
  await assert.rejects(createAssignmentRule(access, { ...input, customerCompanyId: otherCompany }), expectedStatus(400));
  await assert.rejects(createAssignmentRule(access, { ...input, department: 'Departamento inexistente' }), expectedStatus(400));
  checks++;

  const created = await createAssignmentRule(access, input);
  assert.equal(await chooseAndInsert(), null, 'Disabled rules preserve unassigned workflow.');
  const updates = await Promise.allSettled([true, false].map(enabled => updateAssignmentRule(access, created.id, { expectedVersion: 0, enabled })));
  assert.equal(updates.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(updates.filter(result => result.status === 'rejected' && result.reason.status === 409).length, 1);
  let current = (await pool.query('SELECT version,enabled FROM "assignmentRules" WHERE id=$1', [created.id])).rows[0];
  if (!current.enabled) current = await updateAssignmentRule(access, created.id, { expectedVersion: current.version, enabled: true });
  checks++;

  await updateAgentAvailability(access, { memberId: a, expectedVersion: 0, available: true, capacity: 4 });
  await updateAgentAvailability(access, { memberId: b, expectedVersion: 0, available: true, capacity: 4 });
  await createAssignmentRule(access, { ...input, name: 'QA fallback no debe usarse', enabled: true, position: 20, agentMemberIds: [c] });
  const concurrent = await Promise.all(Array.from({ length: 10 }, chooseAndInsert));
  assert.equal(concurrent.filter(Boolean).length, 8, 'Exactly two four-ticket capacities, with no concurrent overbooking.');
  assert.equal(concurrent.filter(result => result?.id === a).length, 4);
  assert.equal(concurrent.filter(result => result?.id === b).length, 4);
  assert.equal(concurrent.filter(result => result?.id === c).length, 0, 'A full first matching rule cannot fall through.');
  assert.equal(await chooseAndInsert(), null);
  checks++;

  await pool.query('UPDATE tickets SET status=\'resolved\' WHERE "ownerId"=$1 AND "assigneeMemberId"=$2', [ownerId, b]);
  let availability = (await listAgentAvailability(access)).find(item => item.memberId === b);
  await updateAgentAvailability(access, { memberId: b, expectedVersion: availability.version, available: false });
  assert.equal(await chooseAndInsert(), null, 'Unavailable agent receives no automatic ticket despite having capacity.');
  availability = (await listAgentAvailability(access)).find(item => item.memberId === b);
  await updateAgentAvailability(access, { memberId: b, expectedVersion: availability.version, available: true });
  for (const [column, invalid, valid] of [['status', 'revoked', 'active'], ['role', 'client', 'agent'], ['userId', null, users.get(b)]]) {
    await pool.query(`UPDATE members SET "${column}"=$1 WHERE id=$2 AND "ownerId"=$3`, [invalid, b, ownerId]);
    assert.equal(await chooseAndInsert(), null, `Ineligible ${column} cannot receive an assignment.`);
    await pool.query(`UPDATE members SET "${column}"=$1 WHERE id=$2 AND "ownerId"=$3`, [valid, b, ownerId]);
  }
  checks++;

  await pool.query('UPDATE tickets SET status=\'resolved\' WHERE "ownerId"=$1', [ownerId]);
  await pool.query('UPDATE "agentAvailability" SET "lastAssignedAt"=$1 WHERE "memberId"=$2', [new Date(Date.parse(now) - 3600_000).toISOString(), a]);
  await pool.query('UPDATE "agentAvailability" SET "lastAssignedAt"=$1 WHERE "memberId"=$2', [new Date(Date.parse(now) - 1800_000).toISOString(), b]);
  assert.equal((await chooseAndInsert()).id, a, 'Equal loads prefer the least recently assigned.');
  assert.equal((await chooseAndInsert()).id, b, 'The lower load wins next.');
  const before = (await pool.query('SELECT * FROM "agentAvailability" WHERE "ownerId"=$1 ORDER BY "memberId"', [ownerId])).rows;
  await assert.rejects(database.transaction(async tx => { await chooseAutomaticAssignee(tx, ownerId, scope, now); throw new Error('qa-rollback'); }), /qa-rollback/);
  assert.deepEqual((await pool.query('SELECT * FROM "agentAvailability" WHERE "ownerId"=$1 ORDER BY "memberId"', [ownerId])).rows, before);
  checks++;

  const agentAccess = { ...access, userId: users.get(a), role: 'agent', member: { ...access.member, id: a, role: 'agent' } };
  assert.equal((await listAgentAvailability(agentAccess)).length, 1);
  await assert.rejects(updateAgentAvailability(agentAccess, { memberId: b, expectedVersion: 0, available: false }), expectedStatus(403));
  await assert.rejects(updateAgentAvailability(agentAccess, { memberId: a, expectedVersion: 0, capacity: 50 }), expectedStatus(403));
  await assert.rejects(updateAgentAvailability(access, { memberId: foreign, expectedVersion: 0, available: false }), expectedStatus(404));
  const own = (await listAgentAvailability(agentAccess))[0];
  await updateAgentAvailability(agentAccess, { memberId: a, expectedVersion: own.version, available: false });
  await assert.rejects(updateAgentAvailability(access, { memberId: a, expectedVersion: own.version, available: true }), expectedStatus(409));
  const staleClientAccess = { ...access, userId: users.get(client), member: { ...access.member, id: client } };
  await assert.rejects(createAssignmentRule(staleClientAccess, input), expectedStatus(403));
  checks++;

  const version = (await pool.query('SELECT version FROM "assignmentRules" WHERE id=$1', [created.id])).rows[0].version;
  await assert.rejects(deleteAssignmentRule(access, created.id, version + 1), expectedStatus(409));
  await deleteAssignmentRule(access, created.id, version);
  assert.equal((await pool.query('SELECT count(*)::integer AS n FROM "assignmentRules" WHERE id=$1', [created.id])).rows[0].n, 0);
  checks++;
  console.log(JSON.stringify({ result: 'PASS', checks, concurrentCreations: 10, assigned: 8, capacityPerAgent: 4, externalNotifications: 0 }));
} finally {
  // Scope every cleanup to the generated fixture owners; no shared QA rows.
  for (const own of [ownerId, otherOwnerId]) {
    await pool.query('DELETE FROM "assignmentRules" WHERE "ownerId"=$1', [own]);
    await pool.query('DELETE FROM "agentAvailability" WHERE "ownerId"=$1', [own]);
    await pool.query('DELETE FROM tickets WHERE "ownerId"=$1', [own]);
    await pool.query('DELETE FROM "customerCompanies" WHERE "ownerId"=$1', [own]);
    await pool.query('DELETE FROM settings WHERE "ownerId"=$1', [own]);
    await pool.query('DELETE FROM members WHERE "ownerId"=$1', [own]);
    await pool.query('DELETE FROM organizations WHERE "ownerId"=$1', [own]);
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM tickets WHERE "ownerId"=$1', [own])).rows[0].n, 0);
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM members WHERE "ownerId"=$1', [own])).rows[0].n, 0);
  }
  await pool.end();
  await getPool().end();
}
