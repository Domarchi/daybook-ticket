/** Coordinator-only SERIAL QA check after 0006. One disposable fixture inside
 * a transaction rolled back in finally. No providers, auth tokens or messages
 * are sent. This script must never target production.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { publicMember } from '../lib/access.ts';
import { heartbeatTicketPresence, readTicketPresence, releaseTicketPresence } from '../lib/ticket-presence.ts';
import { readPublicTicketProgress } from '../lib/ticket-presence-progress.ts';

assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
assert.equal(new URL(process.env.DATABASE_URL).hostname, 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
if (process.env.DAYBOOK_QA_DATABASE_HOST) assert.equal(process.env.DAYBOOK_QA_DATABASE_HOST, 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
assert.ok(!process.env.RESEND_API_KEY && !process.env.RESEND_INBOUND_API_KEY && !process.env.VAPID_PRIVATE_KEY);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect(), run = randomUUID(), ownerId = `qa-presence-${run}`, organizationId = `qa-presence-${run}`;
const staffId = randomUUID(), peerId = randomUUID(), clientId = randomUUID();
const now = new Date(), timestamp = now.toISOString(), createdAt = new Date(now.getTime() - 7200000).toISOString();
const firstResponseAt = new Date(now.getTime() - 3600000).toISOString();
const tab = randomUUID(), secondTab = randomUUID(), peerTab = randomUUID();
const originalFetch = globalThis.fetch;
let externalRequests = 0, savepoint = 0;
// Reuse the fixture connection without letting application transactions commit it.
const database = { transaction: async work => {
  const name = `presence_check_${++savepoint}`;
  await client.query(`SAVEPOINT ${name}`);
  try { const result = await work(client); await client.query(`RELEASE SAVEPOINT ${name}`); return result; }
  catch (error) { await client.query(`ROLLBACK TO SAVEPOINT ${name}`); await client.query(`RELEASE SAVEPOINT ${name}`); throw error; }
} };
async function context(id) {
  const row = (await client.query('SELECT * FROM members WHERE id=$1 AND "ownerId"=$2', [id, ownerId])).rows[0];
  return { ownerId, organizationId, userId: row.userId, role: row.role, member: publicMember({ ...row, hasAccount: true }) };
}
try {
  globalThis.fetch = async () => { externalRequests++; throw new Error('External calls forbidden in presence QA.'); };
  await client.query('BEGIN');
  await client.query('INSERT INTO organizations (id,"ownerId",name,"createdAt") VALUES ($1,$2,\'QA presence\',$3)', [organizationId, ownerId, timestamp]);
  for (const [id, role, name] of [[staffId, 'agent', 'QA visible staff'], [peerId, 'agent', 'QA colleague'], [clientId, 'client', 'QA requester']]) {
    await client.query(`INSERT INTO members (id,"organizationId","ownerId","userId",email,name,role,status,"createdAt","updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$8)`, [id, organizationId, ownerId, randomUUID(), `${id}@example.test`, name, role, timestamp]);
  }
  const ticket = (await client.query(`INSERT INTO tickets ("ownerId","creationKey",subject,"requesterName","requesterEmail","requesterMemberId",department,assignee,"assigneeMemberId",status,"createdAt","updatedAt","dueAt")
    VALUES ($1,$2,'QA public case','QA requester','client@example.test',$3,'Soporte','Old name',$4,'open',$5,$6,$7) RETURNING id`,
  [ownerId, randomUUID(), clientId, staffId, createdAt, timestamp, new Date(now.getTime() + 3600000).toISOString()])).rows[0];
  for (const [author, role, kind, body, at] of [
    [clientId, 'client', 'request', 'QA request', createdAt],
    [staffId, 'agent', 'note', 'PRIVATE_NOTE_SENTINEL', new Date(now.getTime() - 5400000).toISOString()],
    [staffId, 'agent', 'reply', 'QA public response', firstResponseAt],
    [clientId, 'client', 'reply', 'QA new information', new Date(now.getTime() - 600000).toISOString()],
    [staffId, 'agent', 'note', 'PRIVATE_LATEST_NOTE_SENTINEL', timestamp],
  ]) await client.query('INSERT INTO messages ("ownerId","ticketId",author,"authorMemberId","authorRole",body,kind,"createdAt") VALUES ($1,$2,\'QA author\',$3,$4,$5,$6,$7)', [ownerId, ticket.id, author, role, body, kind, at]);
  const staff = await context(staffId), peer = await context(peerId), customer = await context(clientId);
  await heartbeatTicketPresence(database, staff, ticket.id, { tabId: tab, activity: 'viewing' }, now);
  await heartbeatTicketPresence(database, staff, ticket.id, { tabId: secondTab, activity: 'reply' }, now);
  await heartbeatTicketPresence(database, peer, ticket.id, { tabId: peerTab, activity: 'note' }, now);
  const page = await readTicketPresence(database, staff, ticket.id, now);
  assert.equal(page.people.length, 1); assert.equal(page.people[0].memberId, peerId); assert.equal(page.people[0].activity, 'note');
  assert.equal((await readTicketPresence(database, peer, ticket.id, now)).people.length, 1, 'Multiple tabs remain one colleague.');
  await assert.rejects(readTicketPresence(database, customer, ticket.id, now), error => error.status === 403);
  await assert.rejects(heartbeatTicketPresence(database, customer, ticket.id, { tabId: randomUUID(), activity: 'reply' }, now), error => error.status === 403);
  await assert.rejects(readTicketPresence(database, staff, ticket.id + 1000000, now), error => error.status === 404);
  const progress = await readPublicTicketProgress(database, customer, ticket.id);
  assert.equal(progress.responsibleName, 'QA visible staff'); assert.equal(progress.firstResponseAt, firstResponseAt);
  assert.match(progress.nextStep, /revisará tu último mensaje/);
  assert.doesNotMatch(JSON.stringify(progress), /PRIVATE_|@example|tabId|note|authorRole/);
  await client.query('UPDATE members SET status=\'revoked\' WHERE id=$1', [peerId]);
  assert.equal((await readTicketPresence(database, staff, ticket.id, now)).people.length, 0);
  await assert.rejects(heartbeatTicketPresence(database, peer, ticket.id, { tabId: peerTab, activity: 'note' }, now), error => error.status === 403);
  assert.equal((await readTicketPresence(database, staff, ticket.id, new Date(now.getTime() + 45000))).people.length, 0);
  await releaseTicketPresence(database, staff, ticket.id, tab);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM "ticketPresence" WHERE "ownerId"=$1 AND "memberId"=$2', [ownerId, staffId])).rows[0].n, 1);
  await client.query('UPDATE members SET name=\'QA renamed staff\' WHERE id=$1', [staffId]);
  assert.equal((await readPublicTicketProgress(database, customer, ticket.id)).responsibleName, 'QA renamed staff');
  await client.query('UPDATE members SET status=\'revoked\' WHERE id=$1', [staffId]);
  assert.equal((await readPublicTicketProgress(database, customer, ticket.id)).responsibleName, null);
  assert.equal(externalRequests, 0);
  await client.query('ROLLBACK');
  assert.equal((await client.query('SELECT count(*)::int AS n FROM organizations WHERE "ownerId"=$1', [ownerId])).rows[0].n, 0);
  console.log(JSON.stringify({ result: 'PASS', checks: ['staff-only', 'tab-deduplication', '45s-expiry', 'revocation', 'scoped-release', 'public-progress', 'actual-assignee-name', 'notes-private', 'rollback-cleanup'], externalRequests: 0, fixturesRemaining: 0 }));
} finally {
  globalThis.fetch = originalFetch;
  await client.query('ROLLBACK').catch(() => undefined);
  client.release(); await pool.end();
}
