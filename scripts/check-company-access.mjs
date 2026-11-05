/** Company ACL integration checks. Fixed isolated QA only; all email/push sends mocked.
 * Run: node --env-file=.env.test.local --import tsx scripts/check-company-access.mjs
 */
import assert from 'node:assert/strict';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';

const expectedHost = 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
assert.equal(new URL(process.env.DATABASE_URL).hostname, expectedHost);
assert.equal(process.env.DAYBOOK_QA_DATABASE_HOST, expectedHost);
assert.ok(['http://127.0.0.1:5173', 'http://127.0.0.1:5175'].includes(new URL(process.env.DAYBOOK_SITE_URL).origin));
assert.ok(!Object.hasOwn(process.env, 'RESEND_API_KEY') && !Object.hasOwn(process.env, 'DAYBOOK_EMAIL_FROM'));
const runId = randomUUID(), ownerId = randomUUID(), organizationId = `qa-companies-${runId}`;
const companyA = randomUUID(), companyB = randomUUID();
const members = new Map(), ticketIds = [], eventIds = [], subscriptionIds = [];
const originalFetch = globalThis.fetch;
const envKeys = ['DAYBOOK_SITE_URL', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
let pool, database, acl, server, getTicketFeed, getConversationPage, notificationStatements, processOutbox, push, mailCalls = 0, pushCalls = 0;
async function conversation(context, id) {
  const result = []; let cursor = null;
  do { const page = await getConversationPage(context, id, 100, cursor); result.unshift(...page.messages); cursor = page.nextCursor; } while (cursor);
  return result;
}

async function member(name, role = 'client', company = null, companyAccess = 'own', status = 'active') {
  const id = randomUUID(), now = new Date().toISOString();
  await pool.query(`INSERT INTO members (id, "organizationId", "ownerId", "userId", email, name, role, status, "customerCompanyId", "companyAccess", "createdAt", "updatedAt")
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
  [id, organizationId, ownerId, randomUUID(), `${name}-${runId}@example.test`, name, role, status, company, companyAccess, now]);
  members.set(name, id); return id;
}
async function access(id) {
  const row = (await pool.query('SELECT * FROM members WHERE id=$1 AND "ownerId"=$2', [id, ownerId])).rows[0];
  return { organizationId, ownerId, userId: row.userId, role: row.role, member: acl.publicMember({ ...row, hasAccount: true }) };
}
async function ticket(requesterId, company) {
  const now = new Date().toISOString();
  const result = await pool.query(`INSERT INTO tickets ("ownerId", "creationKey", subject, "requesterName", "requesterEmail", "requesterMemberId", "customerCompanyId", department, status, priority, "createdAt", "updatedAt", "dueAt")
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open','normal',$9,$9,$9) RETURNING *`,
  [ownerId, randomUUID(), `QA company ticket ${runId}`, 'Fictitious requester', `requester-${runId}@example.test`, requesterId, company, 'Soporte técnico', now]);
  const row = result.rows[0]; ticketIds.push(row.id); return row;
}
async function message(ticketId, kind) {
  return (await pool.query(`INSERT INTO messages ("ownerId","ticketId",author,"authorMemberId","authorRole",body,kind,"createdAt")
    VALUES ($1,$2,'QA staff',$3,'agent','Fictitious text',$4,$5) RETURNING id`, [ownerId, ticketId, members.get('staff'), kind, new Date().toISOString()])).rows[0].id;
}
async function attachment(ticketId, messageId, kind, status = 'attached') {
  const id = randomUUID(), now = new Date().toISOString();
  await pool.query(`INSERT INTO attachments (id,"ownerId","memberId","draftId","ticketId","messageId",kind,pathname,name,"contentType",size,status,"expiresAt","createdAt","updatedAt")
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'example.pdf','application/pdf',10,$9,$10,$10,$10)`,
  [id, ownerId, members.get('staff'), randomUUID(), ticketId, messageId, kind, `qa-private/${runId}/${id}`, status, now]);
  return id;
}
async function event(recipient, ticketId) {
  const key = randomUUID();
  await database.batch(notificationStatements(database, { ownerId, event: 'agent_replied', eventKey: key, recipientMemberId: recipient, ticketId }));
  const row = (await pool.query('SELECT id FROM "mailOutbox" WHERE "ownerId"=$1 AND "eventKey"=$2', [ownerId, `agent_replied:${key}:${recipient}`])).rows[0];
  eventIds.push(row.id); return row.id;
}

try {
  process.env.RESEND_API_KEY = 'qa-placeholder-never-sent';
  process.env.DAYBOOK_EMAIL_FROM = 'QA <notifications@example.test>';
  process.env.DAYBOOK_SITE_URL = 'https://daybook-company-qa.example.test';
  const vapid = createECDH('prime256v1'); vapid.generateKeys();
  process.env.VAPID_PUBLIC_KEY = vapid.getPublicKey().toString('base64url');
  process.env.VAPID_PRIVATE_KEY = vapid.getPrivateKey().toString('base64url');
  process.env.VAPID_SUBJECT = 'mailto:qa@example.test';
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://api.resend.com/emails');
    const payload = JSON.parse(options.body);
    assert.ok(payload.to[0].endsWith(`-${runId}@example.test`));
    mailCalls++;
    return Response.json({ id: `qa-${randomUUID()}` });
  };
  const dbModule = await import('../db/index.ts');
  pool = dbModule.getPool(); database = dbModule.getDatabase();
  acl = await import('../lib/access.ts'); server = await import('../lib/server.ts');
  ({ getTicketFeed } = await import('../lib/ticket-feed.ts'));
  ({ getConversationPage } = await import('../lib/ticket-search.ts'));
  ({ notificationStatements, processOutbox } = await import('../lib/mail.ts'));
  push = await import('../lib/push.ts');
  const now = new Date().toISOString();
  await pool.query('INSERT INTO organizations (id,"ownerId",name,"createdAt") VALUES ($1,$2,$3,$4)', [organizationId, ownerId, 'QA companies', now]);
  for (const [id, name] of [[companyA, 'A'], [companyB, 'B']]) await pool.query('INSERT INTO "customerCompanies" (id,"organizationId","ownerId",name,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$5)', [id, organizationId, ownerId, name, now]);
  const a1 = await member('a1', 'client', companyA), a2 = await member('a2', 'client', companyA);
  const b1 = await member('b1', 'client', companyB), manager = await member('manager', 'client', companyA, 'manager');
  const staff = await member('staff', 'agent');
  const invited = await member('invited', 'client', companyA, 'manager', 'invited');
  const ta1 = await ticket(a1, companyA), ta2 = await ticket(a2, companyA), tb1 = await ticket(b1, companyB);
  const legacy = await ticket(a1, null), managerOwn = await ticket(manager, companyA), unlinked = await ticket(null, companyA);
  const tickets = [ta1, ta2, tb1, legacy, managerOwn, unlinked];
  const publicMessage = await message(ta2.id, 'reply'), privateMessage = await message(ta2.id, 'note');
  const publicAttachment = await attachment(ta2.id, publicMessage, 'reply');
  await attachment(ta2.id, privateMessage, 'note');
  await attachment(ta2.id, publicMessage, 'reply', 'ready');
  const expected = new Map([[a1, [ta1.id, legacy.id]], [a2, [ta2.id]], [b1, [tb1.id]], [manager, [ta1.id, ta2.id, managerOwn.id, unlinked.id]], [staff, ticketIds], [invited, []]]);
  for (const [id, allowed] of expected) {
    const context = await access(id), scope = acl.ticketAccessSql(context, 't', 2);
    const selected = (await pool.query(`SELECT t.id FROM tickets t WHERE $1::boolean AND ${scope.sql} ORDER BY t.id`, [true, ...scope.values])).rows.map(row => row.id);
    assert.deepEqual(selected, [...allowed].sort((a, b) => a - b), 'SQL ACL must match the complete role/company matrix.');
    for (const candidate of tickets) {
      assert.equal(acl.canAccessTicket(context, candidate), allowed.includes(candidate.id), 'Pure ACL and SQL must agree.');
      if (allowed.includes(candidate.id)) assert.equal((await server.getTicket(context, candidate.id)).id, candidate.id);
      else await assert.rejects(server.getTicket(context, candidate.id), error => error.status === 404);
    }
    const feed = await getTicketFeed(context);
    assert.deepEqual(feed.tickets.map(row => row.id).sort((a, b) => a - b), [...allowed].sort((a, b) => a - b));
    assert.deepEqual(feed.messages, []); assert.equal(feed.ticketCounts.all, allowed.length);
    for (const ticketId of allowed) {
      const messages = await conversation(context, ticketId);
      if (context.role === 'client') assert.ok(messages.every(row => row.kind !== 'note'));
      assert.ok(!JSON.stringify(messages).includes('qa-private/'));
    }
    assert.ok(!JSON.stringify(feed).includes('qa-private/'), 'Private object paths never reach the workspace.');
  }
  const managerAccess = await access(manager), staffAccess = await access(staff);
  const managerMessages = await conversation(managerAccess, ta2.id);
  assert.deepEqual(managerMessages.find(row => row.id === publicMessage).attachments.map(row => row.id), [publicAttachment]);
  assert.equal(managerMessages.some(row => row.id === privateMessage), false);
  assert.equal((await conversation(staffAccess, ta2.id)).find(row => row.id === privateMessage).attachments.length, 1);
  assert.deepEqual((await acl.getCustomerCompanies(managerAccess)).map(row => row.id), [companyA]);
  assert.equal((await acl.getCustomerCompanies(staffAccess)).length, 2);
  assert.throws(() => acl.requireStaff(managerAccess), error => error.status === 403);
  assert.throws(() => acl.requireAdmin(managerAccess), error => error.status === 403);
  await assert.rejects(acl.validateMemberCompany(staffAccess, { role: 'agent', customerCompanyId: companyA, companyAccess: 'own' }), error => error.status === 400);
  await assert.rejects(acl.validateMemberCompany(staffAccess, { role: 'client', customerCompanyId: null, companyAccess: 'manager' }), error => error.status === 400);
  await assert.rejects(acl.validateMemberCompany(staffAccess, { role: 'client', customerCompanyId: randomUUID(), companyAccess: 'own' }), error => error.status === 400);
  assert.equal(acl.canAccessTicket(managerAccess, { ...ta2, ownerId: randomUUID() }), false);

  const subscriptionId = randomUUID(), curve = createECDH('prime256v1'); curve.generateKeys();
  await pool.query(`INSERT INTO "pushSubscriptions" (id,"ownerId","memberId",endpoint,p256dh,auth,active,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,true,$7,$7)`,
  [subscriptionId, ownerId, manager, `https://fcm.googleapis.com/fcm/send/qa-${runId}`, curve.getPublicKey().toString('base64url'), randomBytes(16).toString('base64url'), new Date(Date.now() - 1000).toISOString()]);
  subscriptionIds.push(subscriptionId);
  const validEvent = await event(manager, ta2.id);
  assert.equal((await getTicketFeed(managerAccess)).alerts.some(row => row.id === validEvent), true);
  assert.equal((await processOutbox(ownerId, 1, validEvent)).accepted, 1, 'The authorized participating manager can receive mail.');
  const send = async () => { pushCalls++; };
  assert.equal((await push.processPushOutbox(ownerId, { send, sleep: async () => {} })).accepted, 1);
  assert.equal((await push.pushReceipt(managerAccess, { subscriptionId, eventId: validEvent })).url, `/?ticket=${ta2.id}`);
  assert.equal(mailCalls, 1); assert.equal(pushCalls, 1);
  await pool.query('UPDATE members SET "customerCompanyId"=$1 WHERE id=$2 AND "ownerId"=$3', [companyB, manager, ownerId]);
  const transferred = await access(manager);
  assert.deepEqual((await getTicketFeed(transferred)).tickets.map(row => row.id), [tb1.id]);
  assert.equal((await getTicketFeed(transferred)).alerts.length, 0);
  await assert.rejects(push.pushReceipt(managerAccess, { subscriptionId, eventId: validEvent }), error => error.status === 404, 'Delivery revalidates even an old caller snapshot.');
  const invalidEvent = await event(manager, ta2.id);
  assert.equal((await processOutbox(ownerId, 1, invalidEvent)).accepted, 0);
  await push.processPushOutbox(ownerId, { send, sleep: async () => {} });
  assert.equal((await pool.query('SELECT status FROM "mailOutbox" WHERE id=$1', [invalidEvent])).rows[0].status, 'cancelled');
  assert.equal((await pool.query('SELECT status FROM "pushDeliveries" WHERE "eventId"=$1', [invalidEvent])).rows[0].status, 'cancelled');
  assert.equal(mailCalls, 1); assert.equal(pushCalls, 1);
  await pool.query('UPDATE members SET "customerCompanyId"=$1,"companyAccess"=$2 WHERE id=$3 AND "ownerId"=$4', [companyA, 'own', manager, ownerId]);
  assert.deepEqual((await getTicketFeed(await access(manager))).tickets.map(row => row.id), [managerOwn.id], 'Downgrading a manager preserves only own permitted tickets.');
  await pool.query('UPDATE members SET "customerCompanyId"=$1 WHERE id=$2 AND "ownerId"=$3', [companyB, a1, ownerId]);
  assert.deepEqual((await getTicketFeed(await access(a1))).tickets.map(row => row.id), [legacy.id], 'A transferred contact loses historical company tickets but keeps own null-company legacy tickets.');
  await pool.query('UPDATE members SET status=$1 WHERE id=$2 AND "ownerId"=$3', ['revoked', manager, ownerId]);
  assert.equal((await getTicketFeed(await access(manager))).tickets.length, 0);
  console.log(JSON.stringify({ result: 'passed', checks: ['QA-only', 'pure-SQL-ACL-parity', 'contact-isolation', 'manager-company-scope', 'staff-scope', 'invited-and-revoked-denial', 'legacy-null-company', 'detail-feed-parity', 'private-notes', 'private-attachment-metadata', 'company-directory-scope', 'company-input-validation', 'no-manager-admin-privilege', 'mail-and-push-ACL', 'transfer-removes-alerts-and-delivery', 'manager-downgrade'], mockedEmailRequests: mailCalls, mockedPushRequests: pushCalls, externalRequests: 0 }));
} finally {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) { if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key]; }
  delete process.env.RESEND_API_KEY; delete process.env.DAYBOOK_EMAIL_FROM;
  if (pool) {
    try {
      for (const table of ['mailDeliveryEvents', 'pushDeliveries', 'pushSubscriptions', 'mailOutbox', 'inboundMailReceipts', 'ticketSatisfaction', 'escalationOccurrences', 'reminderOccurrences', 'attachments', 'ticketEvents', 'operations', 'messages', 'ticketSlaOutcomes', 'tickets', 'escalationSettings', 'notificationJobHealth', 'notificationSettings', 'settings', 'members', 'customerCompanies']) {
        await pool.query(`DELETE FROM "${table}" WHERE "ownerId"=$1`, [ownerId]);
      }
      await pool.query('DELETE FROM organizations WHERE id=$1 AND "ownerId"=$2', [organizationId, ownerId]);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM members WHERE "ownerId"=$1', [ownerId])).rows[0].n, 0);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM tickets WHERE "ownerId"=$1', [ownerId])).rows[0].n, 0);
    } finally { await pool.end(); }
  }
}
