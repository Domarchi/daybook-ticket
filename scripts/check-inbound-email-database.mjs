/** Run serially after the service-plus migration, with isolated QA only.
 * The provider transport is injected: no API calls, email or push deliveries.
 * node --env-file=.env.test.local --import tsx scripts/check-inbound-email-database.mjs
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Database } from '../db/database.ts';
import { ingestInboundEmail } from '../lib/inbound-email.ts';
import { inboundConfiguration, makeInboundAddress, parseInboundRoute, InvalidInboundEmail } from '../lib/inbound-email-validation.ts';

assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
assert.equal(new URL(process.env.DATABASE_URL).hostname, 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
assert.equal(process.env.DAYBOOK_QA_DATABASE_HOST, 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
assert.ok(!process.env.RESEND_API_KEY && !process.env.RESEND_INBOUND_API_KEY && !process.env.DAYBOOK_EMAIL_FROM && !process.env.VAPID_PRIVATE_KEY);
const ownerId = randomUUID(), orgId = `qa-inbound-${randomUUID()}`, clientId = randomUUID(), a = randomUUID(), b = randomUUID();
const companyA = randomUUID(), companyB = randomUUID(), now = new Date();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 }), database = new Database(pool);
const config = inboundConfiguration({ DAYBOOK_INBOUND_ENABLED: 'true', DAYBOOK_INBOUND_DOMAIN: 'fictional.resend.app', DAYBOOK_INBOUND_TOKEN_SECRET: 'fictional-inbound-token-only-qa-at-least32', RESEND_INBOUND_API_KEY: 'fictional-not-valid-key', RESEND_INBOUND_WEBHOOK_SECRET: `whsec_${Buffer.from('fictional-only-no-external-webhook').toString('base64')}`, DAYBOOK_NOTIFICATION_ENVIRONMENT: 'qa' });
let source, checks = 0;
function input(kind = 'new', id = randomUUID(), body = 'Mensaje nuevo del cliente QA') {
  const scope = { kind, id: kind === 'new' ? clientId : id, ownerId, memberId: clientId, email: source.email };
  const address = makeInboundAddress(scope, config), route = parseInboundRoute(address, config);
  const envelope = { providerId: randomUUID(), webhookId: `msg_${randomUUID()}`, from: source.email, to: [address], subject: 'QA ingreso por correo', createdAt: now.toISOString() };
  const email = { id: envelope.providerId, from: source.email, to: [address], subject: envelope.subject, text: body, headers: {}, attachments: [], authenticated: true };
  return { envelope, email, route };
}
const run = (value, extra = {}, at = now) => ingestInboundEmail(database, value.envelope, value.email, value.route, { ...source, ...extra }, config, at);
const count = async table => Number((await pool.query(`SELECT count(*)::int AS n FROM "${table}" WHERE "ownerId"=$1`, [ownerId])).rows[0].n);

try {
  await pool.query('INSERT INTO organizations (id,"ownerId",name,"createdAt") VALUES ($1,$2,\'QA ingreso ficticio\',$3)', [orgId, ownerId, now.toISOString()]);
  for (const id of [companyA, companyB]) await pool.query('INSERT INTO "customerCompanies" (id,"organizationId","ownerId",name,"createdAt","updatedAt") VALUES ($1,$2,$3,\'QA empresa ingreso\',$4,$4)', [id, orgId, ownerId, now.toISOString()]);
  for (const [id, role, companyId] of [[clientId, 'client', companyA], [a, 'owner', null], [b, 'agent', null]]) {
    await pool.query(`INSERT INTO members (id,"organizationId","ownerId","userId",name,email,role,status,"customerCompanyId","createdAt","updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$9)`, [id, orgId, ownerId, randomUUID(), `QA ${role}`, `${id}@example.test`, role, companyId, now.toISOString()]);
  }
  source = (await pool.query('SELECT * FROM members WHERE id=$1', [clientId])).rows[0];
  await pool.query('INSERT INTO settings ("ownerId",data) VALUES ($1,$2)', [ownerId, JSON.stringify({ departments: ['Soporte técnico'], notificationMemberIds: [a, b] })]);
  await pool.query('INSERT INTO "assignmentRules" (id,"ownerId",name,enabled,position,"agentMemberIdsJson","createdAt","updatedAt") VALUES ($1,$2,\'QA ingreso reparto\',true,0,$3,$4,$4)', [randomUUID(), ownerId, JSON.stringify([a, b]), now.toISOString()]);

  const request = input();
  const duplicate = await Promise.all([run(request), run(request)]);
  assert.equal(duplicate[0].ticketId, duplicate[1].ticketId);
  assert.equal(duplicate[0].messageId, duplicate[1].messageId);
  assert.equal(duplicate.filter(result => result.duplicate).length, 1);
  assert.equal(await count('tickets'), 1); assert.equal(await count('messages'), 1); assert.equal(await count('inboundMailReceipts'), 1); assert.equal(await count('mailOutbox'), 2);
  let ticket = (await pool.query('SELECT * FROM tickets WHERE id=$1', [duplicate[0].ticketId])).rows[0];
  assert.ok([a, b].includes(ticket.assigneeMemberId)); assert.equal(ticket.customerCompanyId, companyA); assert.ok(ticket.slaPolicySnapshot);
  checks++;

  await assert.rejects(run({ ...request, email: { ...request.email, text: 'Contenido cambiado' } }), InvalidInboundEmail);
  assert.equal(await count('tickets'), 1); assert.equal(await count('messages'), 1); assert.equal(await count('mailOutbox'), 2); checks++;

  const reply = input('reply'), replySource = { sourceTicketId: ticket.id };
  const replies = await Promise.all([run(reply, replySource), run(reply, replySource)]);
  assert.equal(replies[0].messageId, replies[1].messageId); assert.equal(await count('messages'), 2); assert.equal(await count('mailOutbox'), 4);
  assert.equal((await pool.query('SELECT "authorRole",kind FROM messages WHERE id=$1', [replies[0].messageId])).rows[0].authorRole, 'client'); checks++;

  await pool.query('UPDATE tickets SET status=\'resolved\' WHERE id=$1 AND "ownerId"=$2', [ticket.id, ownerId]);
  const later = new Date(now.getTime() + 3600000);
  const reopened = await run(input('reply'), replySource, later);
  ticket = (await pool.query('SELECT * FROM tickets WHERE id=$1', [ticket.id])).rows[0];
  assert.equal(ticket.status, 'open'); assert.equal(ticket.slaStartedAt, later.toISOString()); assert.ok(reopened.messageId); checks++;

  const before = await count('messages');
  await pool.query('UPDATE members SET "customerCompanyId"=$1 WHERE id=$2', [companyB, clientId]);
  assert.equal((await run(input('reply'), replySource)).reasonCode, 'ticket_access_revoked');
  assert.equal(await count('messages'), before);
  await pool.query('UPDATE members SET "customerCompanyId"=$1 WHERE id=$2', [companyA, clientId]); checks++;

  await pool.query('UPDATE members SET status=\'revoked\' WHERE id=$1', [clientId]);
  assert.equal((await run(input('reply'), replySource)).reasonCode, 'inactive_client');
  assert.equal(await count('messages'), before);
  await pool.query('UPDATE members SET status=\'active\' WHERE id=$1', [clientId]); checks++;

  for (const [change, reason] of [[{ authenticated: false }, 'authentication_required'], [{ headers: { 'auto-submitted': 'auto-replied' } }, 'automatic_message'], [{ attachments: [{ id: randomUUID(), name: 'qa.txt', contentType: 'text/plain', size: 10 }] }, 'attachments_use_portal']]) {
    const rejected = input('reply'); rejected.email = { ...rejected.email, ...change };
    assert.equal((await run(rejected, replySource)).reasonCode, reason);
  }
  assert.equal(await count('messages'), before); checks++;
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM "mailOutbox" WHERE "ownerId"=$1 AND status<>'awaiting_configuration'`, [ownerId])).rows[0].n, 0);
  console.log(JSON.stringify({ result: 'PASS', checks, concurrentRetries: 4, externalRequests: 0, externalDeliveries: 0 }));
} finally {
  for (const table of ['pushDeliveries', 'mailDeliveryEvents', 'mailOutbox', 'inboundMailReceipts', 'ticketEvents', 'messages', 'tickets', 'assignmentRules', 'agentAvailability', 'settings', 'members', 'customerCompanies', 'organizations']) {
    await pool.query(`DELETE FROM "${table}" WHERE "ownerId"=$1`, [ownerId]);
  }
  assert.equal(await count('inboundMailReceipts'), 0); assert.equal(await count('tickets'), 0); assert.equal(await count('members'), 0);
  await pool.end();
}
