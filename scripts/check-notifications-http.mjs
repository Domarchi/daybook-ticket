/** Real Daybook sessions -> notification routes -> isolated QA DB; no provider sends. */
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import pg from 'pg';
import { provisionOwner } from './provision-owner.mjs';
import { buildMailPayload } from '../lib/mail-templates.ts';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
assert.equal(new URL(process.env.DATABASE_URL).hostname, 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
assert.equal(process.env.DAYBOOK_SITE_URL, 'http://127.0.0.1:5173');
assert.ok(!process.env.RESEND_API_KEY && !process.env.DAYBOOK_EMAIL_FROM);
assert.ok(process.env.RESEND_WEBHOOK_SECRET?.startsWith('whsec_'));
const origin = process.env.DAYBOOK_SITE_URL, runId = randomUUID(), pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const memberIds = [], userIds = [], ticketIds = [], operationIds = [];
const owner = { cookies: new Map(), ip: '192.0.2.151' }, anonymous = { cookies: new Map(), ip: '192.0.2.152' };
const password = process.env.DAYBOOK_QA_OWNER_PASSWORD || 'Local-QA-only!Daybook-2026';
let oldSettings, oldNotificationConfig, spaceOwnerId;
async function api(actor, path, method = 'GET', body, headers = {}) {
  const cookie = [...actor.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  const response = await fetch(`${origin}${path}`, { method, redirect: 'manual', headers: {
    ...(cookie ? { cookie } : {}), 'x-vercel-forwarded-for': actor.ip,
    ...(method === 'GET' ? {} : { origin, 'content-type': 'application/json' }), ...headers,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  for (const line of response.headers.getSetCookie()) {
    const [part] = line.split(';'), i = part.indexOf('=');
    if (part.slice(i + 1)) actor.cookies.set(part.slice(0, i), part.slice(i + 1)); else actor.cookies.delete(part.slice(0, i));
  }
  return { status: response.status, data: await response.json().catch(() => null) };
}
function ok(result, status = 200) { assert.equal(result.status, status, JSON.stringify(result.data)); return result.data; }
async function invite(role) {
  const actor = { cookies: new Map(), ip: `192.0.2.${153 + memberIds.length}` };
  const email = `qa-notify-${role}-${runId}@example.test`;
  const invited = ok(await api(owner, '/api/members', 'POST', { name: `QA ${role}`, email, role }), 201);
  memberIds.push(invited.member.id);
  const registered = ok(await api(actor, '/api/auth/sign-up/email', 'POST', { email, password, name: `QA ${role}` }, { 'x-daybook-invite': new URL(invited.invitationUrl).searchParams.get('invite') }));
  if (registered.user?.id) userIds.push(registered.user.id);
  actor.id = invited.member.id; return actor;
}
async function postMessage(actor, ticketId, body, kind = 'reply') {
  const operationId = randomUUID(); operationIds.push(operationId);
  return ok(await api(actor, `/api/tickets/${ticketId}/messages`, 'POST', { operationId, body, kind }), 201);
}
try {
  ok(await api(anonymous, '/api/alerts'), 401);
  ok(await api(anonymous, '/api/notifications/settings'), 401);
  ok(await api(anonymous, '/api/internal/notification-tick', 'POST', { invocationId: 'forged', scheduledAt: new Date().toISOString() }), 401);
  ok(await api(anonymous, '/api/webhooks/resend', 'POST', { type: 'email.delivered' }), 400);
  const email = process.env.DAYBOOK_QA_OWNER_EMAIL || process.env.DAYBOOK_OWNER_EMAIL;
  assert.ok(email.endsWith('@example.test'));
  if ((await api(owner, '/api/auth/sign-in/email', 'POST', { email, password })).status !== 200) {
    const invitation = await provisionOwner(pool, { email, name: 'QA propietario', siteUrl: origin });
    ok(await api(owner, '/api/auth/sign-up/email', 'POST', { email, password, name: 'QA propietario' }, { 'x-daybook-invite': new URL(invitation.invitationUrl).searchParams.get('invite') }));
  }
  const workspace = ok(await api(owner, '/api/workspace')); owner.id = workspace.viewer.id;
  spaceOwnerId = (await pool.query('SELECT "ownerId" FROM organizations WHERE id=\'daybook\'')).rows[0].ownerId;
  oldSettings = (await pool.query('SELECT data FROM settings WHERE "ownerId"=$1', [spaceOwnerId])).rows[0]?.data;
  oldNotificationConfig = (await pool.query('SELECT * FROM "notificationSettings" WHERE "ownerId"=$1', [spaceOwnerId])).rows[0];
  const agent = await invite('agent'), client = await invite('client');
  ok(await api(agent, '/api/notifications/settings'), 403);
  ok(await api(client, '/api/notifications/settings', 'PATCH', { enabled: true }), 403);
  ok(await api(owner, '/api/notifications/settings', 'PATCH', { enabled: false }));
  const activated = ok(await api(owner, '/api/notifications/settings', 'PATCH', { enabled: true }));
  assert.equal(activated.config.remindersEnabled, true); assert.ok(activated.config.remindersActivatedAt);
  const settings = ok(await api(owner, '/api/settings', 'PATCH', { notificationMemberIds: [owner.id, agent.id] }));
  assert.ok(settings);
  const operationId = randomUUID(); operationIds.push(operationId);
  const ticket = ok(await api(client, '/api/tickets', 'POST', { operationId, subject: `QA notificaciones ${runId}`, body: 'Solicitud ficticia de prueba', department: workspace.settings.departments[0], priority: 'high' }), 201).ticket;
  ticketIds.push(ticket.id);
  const alerts = ok(await api(owner, '/api/alerts', 'GET', undefined, { 'X-Daybook-Member-Id': owner.id }));
  const alert = alerts.items.find(item => item.ticketId === ticket.id); assert.ok(alert);
  ok(await api(owner, '/api/alerts', 'PATCH', { ids: [alert.id] }), 409);
  ok(await api(owner, '/api/alerts', 'PATCH', { all: true }, { 'X-Daybook-Member-Id': client.id }), 409);
  ok(await api(owner, '/api/alerts', 'PATCH', { ids: [alert.id] }, { 'X-Daybook-Member-Id': owner.id }));
  assert.ok(ok(await api(owner, '/api/alerts')).items.find(item => item.id === alert.id).readAt);
  ok(await api(client, `/api/tickets/${ticket.id}/mail-delivery`), 403);
  const tracking = ok(await api(agent, `/api/tickets/${ticket.id}/mail-delivery`));
  assert.equal(tracking.messages.length, 2);
  assert.ok(tracking.messages.every(item => !('frozenPayload' in item) && !('payloadJson' in item) && !('providerId' in item)));
  const providerId = randomUUID(), from = 'Daybook QA <notifications@example.test>';
  const frozen = buildMailPayload({ id: alert.id, environment: 'qa', event: 'ticket_created', ticketId: ticket.id, from, to: email, url: `${origin}/?ticket=${ticket.id}`, metadata: ticket });
  await pool.query('UPDATE "mailOutbox" SET "payloadJson"=$1,status=\'accepted\',"providerId"=$2 WHERE id=$3 AND "ownerId"=$4', [JSON.stringify(frozen), providerId, alert.id, spaceOwnerId]);
  const raw = JSON.stringify({ type: 'email.delivered', created_at: new Date().toISOString(), data: {
    email_id: providerId, from, to: [email], tags: { app: 'daybook_ticket', environment: 'qa', outbox_id: alert.id },
  } });
  const svixId = `qa_http_${runId}`, stamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', Buffer.from(process.env.RESEND_WEBHOOK_SECRET.slice(6), 'base64')).update(`${svixId}.${stamp}.${raw}`).digest('base64');
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${origin}/api/webhooks/resend`, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'svix-id': svixId, 'svix-timestamp': stamp, 'svix-signature': `v1,${signature}` } });
    assert.equal(response.status, 200);
  }
  const delivered = ok(await api(agent, `/api/tickets/${ticket.id}/mail-delivery`)).messages.find(item => item.id === alert.id);
  assert.equal(delivered.deliveryStatus, 'delivered'); assert.equal(delivered.history.length, 1);
  await postMessage(agent, ticket.id, 'NOTA PRIVADA QA', 'note');
  await postMessage(agent, ticket.id, 'Respuesta pública de prueba');
  const clientFeed = ok(await api(client, '/api/tickets/updates'));
  assert.ok(clientFeed.messages.some(message => message.body === 'Respuesta pública de prueba'));
  assert.ok(clientFeed.messages.every(message => message.kind !== 'note' && message.body !== 'NOTA PRIVADA QA'));
  const tick = ok(await api(anonymous, '/api/internal/notification-tick', 'POST', { invocationId: `qa_http_${runId}`, scheduledAt: new Date().toISOString() }, { authorization: `Bearer ${process.env.DAYBOOK_NOTIFICATION_JOB_SECRET}` }));
  assert.equal(tick.ok, true);
  assert.ok(ok(await api(owner, '/api/notifications/settings')).health.lastSucceededAt);
  ok(await api(owner, `/api/members/${agent.id}`, 'PATCH', { status: 'revoked' }));
  ok(await api(agent, `/api/tickets/${ticket.id}/mail-delivery`), 403);
  ok(await api(agent, '/api/alerts'), 403);
  console.log('PASS HTTP: real invite-only sessions, client ticket/team reply, private notes, persistent reads/member-intent guard, staff-only delivery tracking, signed replay-safe webhook and authenticated worker health. No real deliveries.');
} finally {
  // Remove only this run's events/users; restore shared QA configuration exactly.
  await pool.query(`DELETE FROM "mailDeliveryEvents" WHERE "outboxId" IN (SELECT id FROM "mailOutbox" WHERE "ticketId"=ANY($1::int[]) OR "recipientMemberId"=ANY($2::text[]))`, [ticketIds, memberIds]);
  await pool.query(`DELETE FROM "pushDeliveries" WHERE "eventId" IN (SELECT id FROM "mailOutbox" WHERE "ticketId"=ANY($1::int[]) OR "recipientMemberId"=ANY($2::text[]))`, [ticketIds, memberIds]);
  await pool.query('DELETE FROM "mailOutbox" WHERE "ticketId"=ANY($1::int[]) OR "recipientMemberId"=ANY($2::text[])', [ticketIds, memberIds]);
  for (const table of ['reminderOccurrences', 'ticketEvents', 'attachments', 'messages']) await pool.query(`DELETE FROM "${table}" WHERE "ticketId"=ANY($1::int[])`, [ticketIds]);
  await pool.query('DELETE FROM tickets WHERE id=ANY($1::int[])', [ticketIds]);
  await pool.query('DELETE FROM operations WHERE "operationId"=ANY($1::text[])', [operationIds]);
  await pool.query('DELETE FROM invitations WHERE "memberId"=ANY($1::text[])', [memberIds]);
  await pool.query('DELETE FROM members WHERE id=ANY($1::text[])', [memberIds]);
  await pool.query('DELETE FROM "authUser" WHERE id=ANY($1::text[]) OR email LIKE $2', [userIds, `qa-notify-%-${runId}@example.test`]);
  if (oldSettings !== undefined) await pool.query('UPDATE settings SET data=$1 WHERE "ownerId"=$2', [oldSettings, spaceOwnerId]);
  if (oldNotificationConfig) await pool.query('UPDATE "notificationSettings" SET "remindersEnabled"=$1,"remindersActivatedAt"=$2 WHERE "ownerId"=$3', [oldNotificationConfig.remindersEnabled, oldNotificationConfig.remindersActivatedAt, spaceOwnerId]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM members WHERE id=ANY($1::text[])', [memberIds])).rows[0].n, 0);
  await pool.end();
}
