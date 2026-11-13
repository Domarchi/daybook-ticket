/** SERIAL QA-only integration. Creates and cleans this run's fictitious rows.
 * Coordinator applies migration 0005 before running:
 * node --env-file=.env.test.local --import tsx scripts/check-ticket-search-database.mjs
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { getPool } from '../db/index.ts';
import {
  getTicketCounts,
  getTicketDepartments,
  getTicketPage,
  getConversationPage,
  getContactPage,
} from '../lib/ticket-search.ts';
import { parseTicketSearch } from '../lib/ticket-search-query.ts';
import { getTicketFeed } from '../lib/ticket-feed.ts';
import { databaseCheckCi } from './database-check-target.mjs';
import { seedQaWorkspaceProfiles } from './qa-workspace-profile.mjs';
const databaseCi = databaseCheckCi();

const host = 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech';
if (!databaseCi) {
  assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
  assert.equal(new URL(process.env.DATABASE_URL).hostname, host);
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/daybook_ticket');
  assert.equal(process.env.DAYBOOK_QA_DATABASE_HOST, host);
}
for (const name of ['RESEND_API_KEY', 'DAYBOOK_EMAIL_FROM', 'VAPID_PRIVATE_KEY']) assert.ok(!process.env[name]);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const ownerId = randomUUID(),
  orgId = `qa-search-${randomUUID()}`,
  companyA = randomUUID(),
  companyB = randomUUID();
const owner = randomUUID(),
  clientA = randomUUID(),
  managerA = randomUUID(),
  clientB = randomUUID(),
  stamp = new Date().toISOString();
const memberIds = [owner, clientA, managerA, clientB],
  ticketIds = [];
const access = (id, role, company = null, permission = 'own') => ({
  organizationId: orgId,
  ownerId,
  userId: `qa-${id}`,
  role,
  member: {
    id,
    role,
    name: 'QA búsqueda',
    email: `${id}@example.test`,
    status: 'active',
    hasAccount: true,
    customerCompanyId: company,
    companyAccess: permission,
    createdAt: stamp,
    updatedAt: stamp,
  },
});
const staff = access(owner, 'owner'),
  a = access(clientA, 'client', companyA),
  manager = access(managerA, 'client', companyA, 'manager'),
  b = access(clientB, 'client', companyB);
const query = fields => parseTicketSearch(new URLSearchParams(fields));
let checks = 0;
try {
  await pool.query('INSERT INTO organizations(id,"ownerId",name,"createdAt") VALUES($1,$2,\'QA search\',$3)', [
    orgId,
    ownerId,
    stamp,
  ]);
  await seedQaWorkspaceProfiles(pool, [ownerId]);
  for (const company of [companyA, companyB])
    await pool.query(
      'INSERT INTO "customerCompanies"(id,"organizationId","ownerId",name,"createdAt","updatedAt") VALUES($1,$2,$3,\'QA search company\',$4,$4)',
      [company, orgId, ownerId, stamp],
    );
  for (const actor of [staff, a, manager, b])
    await pool.query(
      'INSERT INTO members(id,"organizationId","ownerId","userId",email,name,role,status,"customerCompanyId","companyAccess","createdAt","updatedAt") VALUES($1,$2,$3,$4,$5,$6,$7,\'active\',$8,$9,$10,$10)',
      [
        actor.member.id,
        orgId,
        ownerId,
        actor.userId,
        actor.member.email,
        actor.member.name,
        actor.role,
        actor.member.customerCompanyId,
        actor.member.companyAccess,
        stamp,
      ],
    );
  for (let index = 0; index < 63; index++) {
    const actor = index === 62 ? b : a;
    const result = await pool.query(
      'INSERT INTO tickets("ownerId","creationKey",subject,"requesterName","requesterEmail","requesterMemberId","customerCompanyId",department,status,priority,"createdAt","updatedAt","dueAt") VALUES($1,$2,$3,\'QA search\',$4,$5,$6,\'Soporte\',$7,\'normal\',$8,$8,$9) RETURNING id',
      [
        ownerId,
        randomUUID(),
        `QA búsqueda ${index}`,
        actor.member.email,
        actor.member.id,
        actor.member.customerCompanyId,
        index % 3 === 0 ? 'resolved' : 'open',
        stamp,
        '2020-01-01T00:00:00.000Z',
      ],
    );
    ticketIds.push(result.rows[0].id);
  }
  const target = ticketIds[0],
    foreign = ticketIds.at(-1),
    secret = `QA_PRIVATE_SEARCH_${randomUUID()}`,
    publicText = `QA_PUBLIC_SEARCH_${randomUUID()}`;
  for (let index = 0; index < 57; index++)
    await pool.query(
      'INSERT INTO messages("ownerId","ticketId",author,"authorMemberId","authorRole",body,kind,"createdAt") VALUES($1,$2,\'QA owner\',$3,\'owner\',$4,$5,$6)',
      [
        ownerId,
        target,
        owner,
        index === 56 ? secret : index === 55 ? publicText : `QA message ${index}`,
        index === 56 ? 'note' : 'reply',
        stamp,
      ],
    );
  await pool.query(
    'INSERT INTO messages("ownerId","ticketId",author,"authorMemberId","authorRole",body,kind,"createdAt") VALUES($1,$2,\'QA foreign\',$3,\'client\',$4,\'request\',$5)',
    [ownerId, foreign, clientB, publicText, stamp],
  );
  const first = await getTicketPage(staff, query({}));
  assert.equal(first.items.length, 50);
  assert.equal(first.total, 63);
  assert.ok(first.nextCursor);
  const second = await getTicketPage(staff, query({ cursor: first.nextCursor }));
  assert.equal(second.items.length, 13);
  assert.equal(second.total, 63);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 63);
  checks++;
  const allCounts = await getTicketCounts(staff),
    departments = await getTicketDepartments(staff);
  assert.equal(allCounts.all, 63);
  assert.equal(allCounts.active + allCounts.resolved + allCounts.closed, 63);
  assert.equal(allCounts.unassigned + allCounts.inProgress, allCounts.active);
  assert.equal(departments[0].total, 63);
  const feed = await getTicketFeed(staff);
  assert.equal(feed.tickets.length, 50);
  assert.deepEqual(feed.messages, []);
  assert.equal(feed.ticketCounts.all, 63);
  checks++;
  assert.equal((await getTicketPage(a, query({ q: secret }))).total, 0);
  assert.equal((await getTicketPage(manager, query({ q: secret }))).total, 0);
  assert.equal((await getTicketPage(staff, query({ q: secret }))).total, 1);
  assert.deepEqual(
    (await getTicketPage(a, query({ q: publicText }))).items.map(item => item.id),
    [target],
  );
  assert.equal((await getTicketPage(manager, query({}))).total, 62);
  assert.equal((await getTicketPage(b, query({}))).total, 1);
  checks++;
  const page = await getConversationPage(a, target),
    older = await getConversationPage(a, target, 50, page.nextCursor);
  assert.equal(page.messages.length, 50);
  assert.ok(page.nextCursor);
  assert.equal(older.messages.length, 6);
  assert.equal(older.nextCursor, null);
  assert.equal(new Set([...older.messages, ...page.messages].map(message => message.id)).size, 56);
  assert.ok([...older.messages, ...page.messages].every(message => message.kind !== 'note' && message.body !== secret));
  await assert.rejects(getConversationPage(b, target), error => error.status === 404);
  checks++;
  const contacts = await getContactPage(staff, 1);
  assert.equal(contacts.total, 2);
  assert.ok(contacts.nextCursor);
  assert.equal(contacts.items[0].total + (await getContactPage(staff, 1, contacts.nextCursor)).items[0].total, 63);
  await assert.rejects(getContactPage(a), error => error.status === 403);
  checks++;
  await pool.query('UPDATE members SET "customerCompanyId"=$1 WHERE id=$2 AND "ownerId"=$3', [
    companyB,
    managerA,
    ownerId,
  ]);
  assert.equal(
    (await getTicketPage(manager, query({}))).total,
    0,
    'Stale manager scope must not survive a current membership change.',
  );
  await assert.rejects(getConversationPage(manager, target), error => error.status === 404);
  await pool.query('UPDATE members SET status=\'revoked\' WHERE id=$1 AND "ownerId"=$2', [clientA, ownerId]);
  assert.equal((await getTicketPage(a, query({}))).total, 0);
  await assert.rejects(getConversationPage(a, target), error => error.status === 404);
  checks++;
  assert.equal((await getTicketPage(staff, query({ q: "' OR 1=1 --" }))).total, 0);
  assert.equal((await getTicketPage(staff, query({ q: '%' }))).total, 0);
  checks++;
  console.log(
    `PASS búsqueda/paginación QA: ${checks} grupos; 63 tickets, dos empresas, notas privadas, páginas de conversación, revocación y comodines literales.`,
  );
} finally {
  await pool.query('DELETE FROM messages WHERE "ownerId"=$1', [ownerId]);
  await pool.query('DELETE FROM tickets WHERE "ownerId"=$1', [ownerId]);
  await pool.query('DELETE FROM members WHERE "ownerId"=$1 AND id=ANY($2::text[])', [ownerId, memberIds]);
  await pool.query('DELETE FROM "customerCompanies" WHERE "ownerId"=$1', [ownerId]);
  await pool.query('DELETE FROM "workspaceProfiles" WHERE "ownerId"=$1', [ownerId]);
  await pool.query('DELETE FROM organizations WHERE id=$1 AND "ownerId"=$2', [orgId, ownerId]);
  assert.equal(
    (await pool.query('SELECT count(*)::int AS count FROM tickets WHERE "ownerId"=$1', [ownerId])).rows[0].count,
    0,
  );
  await pool.end();
  await getPool().end();
}
