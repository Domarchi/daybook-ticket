/** SERIAL HTTP QA for formatted messages, private preview ACL and encrypted export.
 * Requires the compiled QA server on 127.0.0.1:5175, migration 0005 and no delivery keys.
 * The export stays in memory; no passwords, bundles or account content are logged.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { provisionOwner } from './provision-owner.mjs';
import { readAllConversationPages } from './qa-paged-read.mjs';
import { BACKUP_MAGIC, BACKUP_TABLES, decryptBackup } from '../lib/backup-format.ts';

assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
assert.equal(new URL(process.env.DATABASE_URL).hostname, 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
assert.equal(process.env.DAYBOOK_SITE_URL, 'http://127.0.0.1:5175');
for (const name of ['RESEND_API_KEY', 'RESEND_INBOUND_API_KEY', 'DAYBOOK_EMAIL_FROM', 'VAPID_PRIVATE_KEY']) assert.ok(!process.env[name], `${name} must be absent.`);
const origin = process.env.DAYBOOK_SITE_URL, runId = randomUUID(), prefix = `QA editor-backup ${runId}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 15000 });
const owner = { cookies: new Map(), ip: '198.51.100.221' }, anonymous = { cookies: new Map(), ip: '198.51.100.222' };
const memberIds = [], userIds = [], companyIds = [], ticketIds = [], operationIds = [], attachmentIds = [], passed = [];
const password = process.env.DAYBOOK_QA_OWNER_PASSWORD || 'Local-QA-only!Daybook-2026';
let spaceOwnerId, failure, exportedRows = 0, exportedFiles = 0;

async function http(actor, path, method = 'GET', body, headers = {}) {
  const cookie = [...actor.cookies].map(([key, value]) => `${key}=${value}`).join('; ');
  const response = await fetch(`${origin}${path}`, { method, redirect: 'manual', signal: AbortSignal.timeout(180000), headers: {
    ...(cookie ? { cookie } : {}), 'x-vercel-forwarded-for': actor.ip,
    ...(actor.id ? { 'X-Daybook-Member-Id': actor.id } : {}),
    ...(method === 'GET' ? {} : { origin, 'content-type': 'application/json' }), ...headers,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  for (const line of response.headers.getSetCookie()) { const [part] = line.split(';'), at = part.indexOf('='); if (part.slice(at + 1)) actor.cookies.set(part.slice(0, at), part.slice(at + 1)); else actor.cookies.delete(part.slice(0, at)); }
  return response;
}
async function api(actor, path, method = 'GET', body, headers = {}) { const response = await http(actor, path, method, body, headers); return { status: response.status, data: await response.json().catch(() => null) }; }
function ok(result, status = 200) { assert.equal(result.status, status, `Expected HTTP ${status}; received ${result.status}: ${result.data?.error || ''}`); return result.data; }
function success(name) { passed.push(name); console.log(`PASS HTTP editor-backup: ${name}`); }
async function invite(label, role, customerCompanyId) {
  const actor = { cookies: new Map(), ip: `198.51.100.${223 + memberIds.length}` };
  const email = `qa-editor-backup-${label}-${runId}@example.test`;
  const invited = ok(await api(owner, '/api/members', 'POST', { name: `QA ${label}`, email, role, ...(customerCompanyId ? { customerCompanyId } : {}) }), 201);
  memberIds.push(invited.member.id);
  const registered = ok(await api(actor, '/api/auth/sign-up/email', 'POST', { email, password, name: `QA ${label}` }, { 'x-daybook-invite': new URL(invited.invitationUrl).searchParams.get('invite') }));
  if (registered.user?.id) userIds.push(registered.user.id);
  actor.id = invited.member.id; return actor;
}
async function send(actor, ticketId, body, kind = 'reply', bodyFormat) {
  const payload = { operationId: randomUUID(), body, kind, ...(bodyFormat ? { bodyFormat } : {}) }; operationIds.push(payload.operationId);
  const path = `/api/tickets/${ticketId}/messages`, sent = ok(await api(actor, path, 'POST', payload), 201).message;
  assert.deepEqual(ok(await api(actor, path, 'POST', payload), 201).message, sent, 'Retry returns the original public or private message.');
  ok(await api(actor, path, 'POST', { ...payload, body: `${body} changed` }), 409);
  return sent;
}
try {
  ok(await api(anonymous, '/api/backups'), 401);
  ok(await api(anonymous, '/api/backups', 'POST', {}), 401);
  ok(await api(anonymous, `/api/attachments/${randomUUID()}/preview`), 401);
  const email = process.env.DAYBOOK_QA_OWNER_EMAIL || process.env.DAYBOOK_OWNER_EMAIL;
  assert.ok(email?.toLowerCase().endsWith('@example.test'));
  if ((await api(owner, '/api/auth/sign-in/email', 'POST', { email, password })).status !== 200) {
    const invitation = await provisionOwner(pool, { email, name: 'QA propietario', siteUrl: origin });
    ok(await api(owner, '/api/auth/sign-up/email', 'POST', { email, password, name: 'QA propietario' }, { 'x-daybook-invite': new URL(invitation.invitationUrl).searchParams.get('invite') }));
  }
  const workspace = ok(await api(owner, '/api/workspace')); owner.id = workspace.viewer.id;
  spaceOwnerId = (await pool.query('SELECT "ownerId" FROM organizations WHERE id=\'daybook\'')).rows[0].ownerId;
  for (const label of ['A', 'B']) companyIds.push(ok(await api(owner, '/api/companies', 'POST', { name: `${prefix} ${label}` }), 201).company.id);
  const agent = await invite('agent', 'agent'), client = await invite('client', 'client', companyIds[0]), foreignClient = await invite('other', 'client', companyIds[1]);
  for (const actor of [agent, client]) { ok(await api(actor, '/api/backups'), 403); ok(await api(actor, '/api/backups', 'POST', { password: 'Fictitious-backup-password', confirmation: 'RESPALDAR' }), 403); }
  ok(await api(owner, `/api/members/${agent.id}`, 'PATCH', { role: 'admin' }));
  ok(await api(agent, '/api/backups'), 403); ok(await api(agent, '/api/backups', 'POST', { password: 'Fictitious-backup-password', confirmation: 'RESPALDAR' }), 403);
  ok(await api(owner, `/api/members/${agent.id}`, 'PATCH', { role: 'agent' }));
  ok(await api(owner, '/api/backups', 'POST', { password: 'short', confirmation: 'RESPALDAR' }), 400);
  ok(await api(owner, '/api/backups', 'POST', { password: 'Fictitious-backup-password', confirmation: 'NO' }), 400);
  assert.equal(ok(await api(owner, '/api/backups')).format, 'daybook.workspace.v1');
  success('owner-only encrypted export, fresh role checks, explicit confirmation and passphrase limits');

  const markdownBody = '**Solicitud de prueba**\n- Primer paso\n- Segundo paso\n[Portal](https://example.test/)\n<script>texto que no se ejecuta</script>';
  const create = { operationId: randomUUID(), subject: `${prefix} markdown`, body: markdownBody, bodyFormat: 'markdown', department: workspace.settings.departments[0], priority: 'normal' }; operationIds.push(create.operationId);
  const formatted = ok(await api(client, '/api/tickets', 'POST', create), 201).ticket; ticketIds.push(formatted.id);
  assert.deepEqual(ok(await api(client, '/api/tickets', 'POST', create), 201).ticket, formatted);
  ok(await api(client, '/api/tickets', 'POST', { ...create, bodyFormat: 'plain' }), 409);
  const legacyBody = '**Este texto anterior conserva sus asteriscos**';
  const legacyCreate = { operationId: randomUUID(), subject: `${prefix} legacy plain`, body: legacyBody, department: workspace.settings.departments[0], priority: 'normal' }; operationIds.push(legacyCreate.operationId);
  const plain = ok(await api(client, '/api/tickets', 'POST', legacyCreate), 201).ticket; ticketIds.push(plain.id);
  assert.deepEqual(ok(await api(client, '/api/tickets', 'POST', legacyCreate), 201).ticket, plain);
  const reply = await send(agent, formatted.id, '**Respuesta** con [enlace](https://example.test/help)', 'reply', 'markdown');
  const legacyReply = await send(client, formatted.id, '**Respuesta sin formato explícito**');
  const note = await send(agent, formatted.id, '**Nota interna de prueba**', 'note', 'markdown');
  assert.equal(reply.bodyFormat, 'markdown'); assert.equal(legacyReply.bodyFormat, 'plain'); assert.equal(note.bodyFormat, 'markdown');
  const deniedOperation = randomUUID(); operationIds.push(deniedOperation);
  ok(await api(client, `/api/tickets/${formatted.id}/messages`, 'POST', { operationId: deniedOperation, body: 'No se permite nota de cliente', kind: 'note', bodyFormat: 'markdown' }), 403);
  const invalidOperation = randomUUID(); operationIds.push(invalidOperation);
  ok(await api(agent, `/api/tickets/${formatted.id}/messages`, 'POST', { operationId: invalidOperation, body: '<script>no HTML</script>', kind: 'reply', bodyFormat: 'html' }), 400);
  const clientConversation = await readAllConversationPages(path => api(client, path).then(result => ok(result)), formatted.id);
  const staffConversation = await readAllConversationPages(path => api(owner, path).then(result => ok(result)), formatted.id);
  assert.equal(clientConversation.find(message => message.kind === 'request').bodyFormat, 'markdown');
  assert.equal(clientConversation.find(message => message.id === reply.id).bodyFormat, 'markdown');
  assert.equal(clientConversation.find(message => message.id === legacyReply.id).bodyFormat, 'plain');
  assert.ok(clientConversation.every(message => message.id !== note.id && message.kind !== 'note'));
  assert.equal(staffConversation.find(message => message.id === note.id).bodyFormat, 'markdown');
  const plainConversation = await readAllConversationPages(path => api(client, path).then(result => ok(result)), plain.id);
  assert.equal(plainConversation[0].bodyFormat, 'plain'); assert.equal(plainConversation[0].body, legacyBody);
  success('markdown and legacy plain creation/reply, replay without duplicates, private notes and safe format contract');

  // Metadata-only ACL probes never read a Blob and are removed before the complete export.
  const createdAt = new Date().toISOString();
  for (const [message, kind] of [[reply, 'reply'], [note, 'note']]) {
    const attachmentId = randomUUID(); attachmentIds.push(attachmentId);
    await pool.query(`INSERT INTO attachments (id,"ownerId","memberId","draftId","ticketId","messageId",kind,pathname,name,"contentType",size,status,"expiresAt","uploadedAt","validatedAt","createdAt","updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'qa-preview.png','image/png',1,'attached',$9,$9,$9,$9,$9)`, [attachmentId, spaceOwnerId, agent.id, randomUUID(), formatted.id, message.id, kind, `daybook/qa/metadata-only/${runId}/${attachmentId}.png`, createdAt]);
    ok(await api(anonymous, `/api/attachments/${attachmentId}/preview`), 401);
    ok(await api(foreignClient, `/api/attachments/${attachmentId}/preview`), 404);
    if (kind === 'note') ok(await api(client, `/api/attachments/${attachmentId}/preview`), 404);
  }
  assert.equal((await pool.query('DELETE FROM attachments WHERE "ownerId"=$1 AND id=ANY($2::text[]) RETURNING id', [spaceOwnerId, attachmentIds])).rowCount, 2);
  success('private preview rejects anonymous, other-company and client access to internal files before storage');

  const encryptionPassword = randomBytes(32).toString('hex');
  const response = await http(owner, '/api/backups', 'POST', { password: encryptionPassword, confirmation: 'RESPALDAR' });
  if (response.status !== 200) {
    const error = await response.json().catch(() => null);
    assert.fail(`Encrypted export failed with HTTP ${response.status}: ${error?.error || 'unknown error'}`);
  }
  assert.match(response.headers.get('content-type'), /application\/octet-stream/);
  assert.match(response.headers.get('cache-control'), /private.*no-store/);
  assert.match(response.headers.get('content-disposition'), /\.daybook/);
  const encrypted = Buffer.from(await response.arrayBuffer());
  assert.ok(encrypted.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC));
  assert.equal(encrypted.includes(Buffer.from(markdownBody)), false, 'No conversation plaintext in the downloaded encrypted file.');
  assert.throws(() => decryptBackup(encrypted, 'Wrong-fictitious-passphrase-2026'));
  const backup = decryptBackup(encrypted, encryptionPassword);
  assert.equal(backup.ownerId, spaceOwnerId); assert.equal(backup.format, 'daybook.workspace.v1');
  assert.equal(backup.tables.length, BACKUP_TABLES.length);
  const messages = backup.tables.find(table => table.name === 'messages').rows;
  assert.equal(messages.find(message => message.ticketId === formatted.id && message.kind === 'request').bodyFormat, 'markdown');
  assert.equal(messages.find(message => message.id === reply.id).bodyFormat, 'markdown');
  assert.equal(messages.find(message => message.id === note.id).bodyFormat, 'markdown');
  assert.equal(messages.find(message => message.ticketId === plain.id && message.kind === 'request').body, legacyBody);
  assert.equal(messages.find(message => message.ticketId === plain.id && message.kind === 'request').bodyFormat, 'plain');
  const sentFiles = backup.tables.find(table => table.name === 'attachments').rows;
  assert.equal(backup.files.length, sentFiles.length, 'A complete backup has bytes for every sent private attachment.');
  exportedRows = backup.tables.reduce((count, table) => count + table.rows.length, 0); exportedFiles = backup.files.length;
  assert.equal(Number(response.headers.get('x-daybook-backup-rows')), exportedRows);
  assert.equal(Number(response.headers.get('x-daybook-backup-files')), exportedFiles);
  encrypted.fill(0);
  success('real encrypted HTTP download decrypts and verifies all table/file checksums including formatted and legacy messages');
} catch (error) { failure = error; }
finally {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    if (spaceOwnerId) {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`daybook-ticket-work:${spaceOwnerId}`]);
      const recovered = (await tx.query('SELECT id,"userId" FROM members WHERE "ownerId"=$1 AND email LIKE $2', [spaceOwnerId, `qa-editor-backup-%-${runId}@example.test`])).rows;
      for (const row of recovered) { if (!memberIds.includes(row.id)) memberIds.push(row.id); if (row.userId && !userIds.includes(row.userId)) userIds.push(row.userId); }
      for (const row of (await tx.query('SELECT id FROM tickets WHERE "ownerId"=$1 AND subject LIKE $2', [spaceOwnerId, `${prefix}%`])).rows) if (!ticketIds.includes(row.id)) ticketIds.push(row.id);
      for (const row of (await tx.query('SELECT id FROM "customerCompanies" WHERE "ownerId"=$1 AND name LIKE $2', [spaceOwnerId, `${prefix}%`])).rows) if (!companyIds.includes(row.id)) companyIds.push(row.id);
      const values = [spaceOwnerId, ticketIds, memberIds], mailScope = 'SELECT id FROM "mailOutbox" WHERE "ownerId"=$1 AND ("ticketId"=ANY($2::int[]) OR "recipientMemberId"=ANY($3::text[]))';
      await tx.query(`DELETE FROM "mailDeliveryEvents" WHERE "outboxId" IN (${mailScope})`, values);
      await tx.query(`DELETE FROM "pushDeliveries" WHERE "eventId" IN (${mailScope})`, values);
      await tx.query(`DELETE FROM "mailOutbox" WHERE id IN (${mailScope})`, values);
      for (const table of ['escalationOccurrences', 'ticketSatisfaction', 'reminderOccurrences', 'ticketSlaOutcomes', 'attachments', 'ticketEvents', 'messages']) await tx.query(`DELETE FROM "${table}" WHERE "ownerId"=$1 AND "ticketId"=ANY($2::int[])`, [spaceOwnerId, ticketIds]);
      await tx.query('DELETE FROM operations WHERE "ownerId"=$1 AND ("operationId"=ANY($2::text[]) OR "memberId"=ANY($3::text[]))', [spaceOwnerId, operationIds, memberIds]);
      await tx.query('DELETE FROM tickets WHERE "ownerId"=$1 AND id=ANY($2::int[])', [spaceOwnerId, ticketIds]);
      await tx.query('DELETE FROM "agentAvailability" WHERE "ownerId"=$1 AND "memberId"=ANY($2::text[])', [spaceOwnerId, memberIds]);
      await tx.query('DELETE FROM invitations WHERE "ownerId"=$1 AND "memberId"=ANY($2::text[])', [spaceOwnerId, memberIds]);
      await tx.query('DELETE FROM members WHERE "ownerId"=$1 AND id=ANY($2::text[])', [spaceOwnerId, memberIds]);
      await tx.query('DELETE FROM "customerCompanies" WHERE "ownerId"=$1 AND id=ANY($2::text[])', [spaceOwnerId, companyIds]);
      await tx.query('DELETE FROM "authUser" WHERE id=ANY($1::text[]) OR email LIKE $2', [userIds, `qa-editor-backup-%-${runId}@example.test`]);
      const remaining = (await tx.query(`SELECT
        (SELECT count(*)::int FROM members WHERE "ownerId"=$1 AND email LIKE $2) AS members,
        (SELECT count(*)::int FROM "authUser" WHERE email LIKE $2) AS users,
        (SELECT count(*)::int FROM tickets WHERE "ownerId"=$1 AND subject LIKE $3) AS tickets,
        (SELECT count(*)::int FROM "customerCompanies" WHERE "ownerId"=$1 AND id=ANY($4::text[])) AS companies,
        (SELECT count(*)::int FROM operations WHERE "ownerId"=$1 AND ("memberId"=ANY($5::text[]) OR "operationId"=ANY($6::text[]))) AS operations`,
      [spaceOwnerId, `qa-editor-backup-%-${runId}@example.test`, `${prefix}%`, companyIds, memberIds, operationIds])).rows[0];
      assert.ok(Object.values(remaining).every(value => value === 0), 'All editor/backup HTTP fixtures must be removed.');
    }
    await tx.query('COMMIT');
  } catch (error) { await tx.query('ROLLBACK').catch(() => undefined); failure ||= error; }
  finally { tx.release(); }
  if (owner.cookies.size) { try { ok(await api(owner, '/api/auth/sign-out', 'POST', {})); } catch (error) { failure ||= error; } }
  await pool.end();
  await mkdir(new URL('../work/', import.meta.url), { recursive: true });
  await writeFile(new URL('../work/SERVICE_PLUS_EDITOR_BACKUP_HTTP_RESULT.json', import.meta.url), JSON.stringify({ ok: !failure, passed, exportedRows, exportedFiles, createdFakeAccounts: memberIds.length, createdTickets: ticketIds.length, externalEmailRequests: 0, completedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
}
if (failure) throw failure;
console.log('PASS HTTP editor-backup: formatted messages, private preview ACL, encrypted export and complete fixture cleanup.');
