/** Persistent notification ACL, pagination and real MVCC race. Isolated QA only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
assert.equal(
  new URL(process.env.DATABASE_URL).hostname,
  'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech',
);
assert.ok(!process.env.RESEND_API_KEY && !process.env.DAYBOOK_EMAIL_FROM);
const { getPool } = await import('../db/index.ts');
const { getAlertsPage, markAlertsRead } = await import('../lib/alerts.ts');
const { publicMember } = await import('../lib/access.ts');
const pool = getPool();
const ownerId = randomUUID(),
  orgId = `qa-alerts-${ownerId}`,
  staffId = randomUUID(),
  clientId = randomUUID(),
  otherId = randomUUID();
const companyA = randomUUID(),
  companyB = randomUUID();
const cutoff = new Date(Date.now() - 60_000).toISOString(),
  now = new Date().toISOString();
let ticketId, otherTicketId, locker, inserter;
async function access(memberId) {
  const {
    rows: [member],
  } = await pool.query('SELECT * FROM members WHERE id=$1', [memberId]);
  return {
    ownerId,
    organizationId: orgId,
    userId: member.userId,
    role: member.role,
    member: publicMember({ ...member, hasAccount: true }),
  };
}
async function event(recipient = staffId, ticket = ticketId, createdAt = now, client = pool) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO "mailOutbox" (id,"ownerId","eventKey",event,"recipientMemberId","ticketId",status,"createdAt","updatedAt")
    VALUES ($1,$2,$1,'agent_replied',$3,$4,'awaiting_configuration',$5,$5)`,
    [id, ownerId, recipient, ticket, createdAt],
  );
  return id;
}
try {
  await pool.query(
    'INSERT INTO organizations(id,"ownerId",name,"createdAt") VALUES($1,$2,\'QA persistent alerts\',$3)',
    [orgId, ownerId, now],
  );
  await pool.query('INSERT INTO "notificationSettings"("ownerId","alertsActivatedAt") VALUES($1,$2)', [
    ownerId,
    cutoff,
  ]);
  for (const id of [companyA, companyB])
    await pool.query(
      'INSERT INTO "customerCompanies"(id,"organizationId","ownerId",name,"createdAt","updatedAt") VALUES($1,$2,$3,\'QA company\',$4,$4)',
      [id, orgId, ownerId, now],
    );
  for (const [id, role, company] of [
    [staffId, 'agent', null],
    [clientId, 'client', companyA],
    [otherId, 'client', companyB],
  ]) {
    await pool.query(
      `INSERT INTO members(id,"organizationId","ownerId","userId",email,name,role,status,"customerCompanyId","createdAt","updatedAt")
      VALUES($1,$2,$3,$4,$5,'QA viewer',$6,'active',$7,$8,$8)`,
      [id, orgId, ownerId, randomUUID(), `${id}@example.test`, role, company, now],
    );
  }
  const makeTicket = async (member, company) =>
    (
      await pool.query(
        `INSERT INTO tickets("ownerId","creationKey",subject,"requesterName","requesterEmail","requesterMemberId","customerCompanyId",department,"createdAt","updatedAt","dueAt")
    VALUES($1,$2,'QA alerts','QA client','client@example.test',$3,$4,'Soporte técnico',$5,$5,$5) RETURNING id`,
        [ownerId, randomUUID(), member, company, now],
      )
    ).rows[0].id;
  ticketId = await makeTicket(clientId, companyA);
  otherTicketId = await makeTicket(otherId, companyB);
  const historical = await event(staffId, ticketId, new Date(Date.parse(cutoff) - 1000).toISOString());
  const ids = [];
  for (let i = 0; i < 65; i++) ids.push(await event());
  const clientEvent = await event(clientId),
    otherEvent = await event(otherId, otherTicketId);
  const staff = await access(staffId);
  const first = await getAlertsPage(staff, { filter: 'unread', limit: 20 });
  assert.equal(first.unreadCount, 65);
  assert.equal(first.items.length, 20);
  assert.ok(first.nextCursor);
  const { parseAlertsQuery } = await import('../lib/alerts-query.ts');
  const seen = new Set();
  let page = first;
  for (;;) {
    for (const item of page.items) {
      assert.ok(!seen.has(item.id));
      seen.add(item.id);
    }
    if (!page.nextCursor) break;
    page = await getAlertsPage(
      staff,
      parseAlertsQuery(new URLSearchParams({ filter: 'unread', limit: '20', cursor: page.nextCursor })),
    );
  }
  assert.equal(seen.size, 65);
  await markAlertsRead(staff, { ids: [ids[0], otherEvent] });
  assert.equal(
    (await getAlertsPage(await access(staffId))).unreadCount,
    64,
    'Reads persist for a fresh device/context.',
  );
  assert.equal(
    (await pool.query('SELECT "readAt" FROM "mailOutbox" WHERE id=$1', [otherEvent])).rows[0].readAt,
    null,
    'Other recipients stay unread.',
  );
  assert.equal((await getAlertsPage(await access(clientId))).unreadCount, 1);
  await pool.query('UPDATE members SET "customerCompanyId"=$1 WHERE id=$2', [companyB, clientId]);
  assert.equal(
    (await getAlertsPage(await access(clientId))).items.length,
    0,
    'Company changes revoke historical ticket access.',
  );
  await markAlertsRead(await access(clientId), { ids: [clientEvent] });
  assert.equal((await pool.query('SELECT "readAt" FROM "mailOutbox" WHERE id=$1', [clientEvent])).rows[0].readAt, null);
  // An old row blocks the UPDATE after it has acquired its statement snapshot.
  locker = await pool.connect();
  inserter = await pool.connect();
  await locker.query('BEGIN');
  await locker.query('UPDATE "mailOutbox" SET "readAt"=NULL WHERE id=$1', [ids[1]]);
  await inserter.query('BEGIN');
  const during = await event(staffId, ticketId, now, inserter);
  const marking = markAlertsRead(staff, { all: true });
  let blocked = false;
  for (let i = 0; i < 50; i++) {
    const { rows } = await pool.query(
      `SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'UPDATE "mailOutbox" o SET "readAt"%'`,
    );
    if (rows.length) {
      blocked = true;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(blocked, 'Exercise the actual concurrent UPDATE snapshot.');
  await inserter.query('COMMIT');
  await locker.query('COMMIT');
  await marking;
  assert.equal((await getAlertsPage(staff)).unreadCount, 1);
  assert.equal(
    (await pool.query('SELECT "readAt" FROM "mailOutbox" WHERE id=$1', [during])).rows[0].readAt,
    null,
    'An arrival committed during mark-all stays unread.',
  );
  assert.equal(
    (await pool.query('SELECT "readAt" FROM "mailOutbox" WHERE id=$1', [historical])).rows[0].readAt,
    null,
    'No invented historical read timestamps.',
  );
  await pool.query("UPDATE members SET status='revoked' WHERE id=$1", [staffId]);
  assert.equal((await getAlertsPage(await access(staffId))).items.length, 0);
  console.log(
    'PASS: persistent reads, complete badge, pagination, recipient/company isolation, revocation and concurrent mark-all; no deliveries.',
  );
} finally {
  for (const client of [locker, inserter])
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  await pool.query('DELETE FROM "mailDeliveryEvents" WHERE "ownerId"=$1', [ownerId]);
  await pool.query('DELETE FROM "mailOutbox" WHERE "ownerId"=$1', [ownerId]);
  await pool.query('DELETE FROM tickets WHERE "ownerId"=$1', [ownerId]);
  await pool.query('DELETE FROM members WHERE "ownerId"=$1', [ownerId]);
  await pool.query('DELETE FROM "customerCompanies" WHERE "ownerId"=$1', [ownerId]);
  await pool.query('DELETE FROM organizations WHERE "ownerId"=$1', [ownerId]);
  assert.equal(
    (await pool.query('SELECT count(*)::int AS n FROM "notificationSettings" WHERE "ownerId"=$1', [ownerId])).rows[0].n,
    0,
  );
  await pool.end();
}
