/** Isolated PostgreSQL integration; storage is injected and never calls Blob.
 * Run: node --env-file=.env.test.local --import tsx scripts/check-attachments-db.mjs
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const expectedHost = 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
assert.equal(new URL(process.env.DATABASE_URL).hostname, expectedHost);
assert.equal(process.env.DAYBOOK_QA_DATABASE_HOST, expectedHost);
assert.equal(new URL(process.env.DAYBOOK_SITE_URL).origin, 'http://127.0.0.1:5173');
assert.ok(!process.env.RESEND_API_KEY && !process.env.DAYBOOK_EMAIL_FROM);
assert.notEqual(process.env.VERCEL_ENV, 'production');

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('No HTTP provider calls are permitted in attachment integration tests.'); };
const ownerId = randomUUID(), organizationId = `qa-attachments-${randomUUID()}`, companyA = randomUUID(), companyB = randomUUID();
const now = new Date().toISOString(), old = new Date(Date.now() - 3600_000).toISOString();
const objects = new Map(), removed = [];
let failDelete = false, pool;
const storage = {
  read: async pathname => objects.has(pathname) ? { size: objects.get(pathname).length, stream: new Response(objects.get(pathname)).body } : null,
  remove: async pathname => { if (failDelete) throw new Error('simulated unavailable store'); removed.push(pathname); objects.delete(pathname); },
};
const { getPool, getDatabase } = await import('../db/index.ts');
const { reserveAttachment, attachmentUploadTokenOptions, completeAttachment, linkReadyAttachments, downloadAttachment, removePendingAttachment, cleanupAttachments } = await import('../lib/attachments.ts');
const database = getDatabase(); pool = getPool();
const actors = {};
const expectStatus = (promise, status) => assert.rejects(promise, error => error?.status === status);
async function actor(label, role, companyId = null, companyAccess = 'own') {
  const memberId = randomUUID(), userId = randomUUID();
  const { rows } = await pool.query(`INSERT INTO members (id,"organizationId","ownerId","userId",name,email,role,status,"customerCompanyId","companyAccess","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10,$10) RETURNING *`, [memberId, organizationId, ownerId, userId, label, `${memberId}@example.test`, role, companyId, companyAccess, now]);
  return { ownerId, organizationId, userId, member: rows[0], role };
}
async function ticket(client) {
  const { rows } = await pool.query(`INSERT INTO tickets ("ownerId","creationKey",subject,"requesterName","requesterEmail","requesterMemberId","customerCompanyId",department,"createdAt","updatedAt","dueAt") VALUES ($1,$2,'QA attachment ticket',$3,$4,$5,$6,'QA',$7,$7,$7) RETURNING id`, [ownerId, randomUUID(), client.member.name, client.member.email, client.member.id, client.member.customerCompanyId, now]);
  return rows[0].id;
}
function input(kind = 'request', ticketId, draftId = randomUUID()) { return { draftId, kind, ...(ticketId ? { ticketId } : {}), name: 'support.txt', size: 12, contentType: 'text/plain' }; }
async function reserve(actor, data = input()) { return reserveAttachment(actor, data, database, storage); }
async function ready(actor, data = input()) {
  const result = await reserve(actor, data);
  objects.set(result.pathname, Buffer.from('Daybook test'));
  const completed = await completeAttachment(actor, result.attachment.id, database, storage);
  assert.equal(completed.attachment.status, 'ready');
  return { ...result, data };
}
async function send(actor, file, ticketId, kind = file.data.kind, rollback = false) {
  return database.transaction(async tx => {
    const message = (await tx.query(`INSERT INTO messages ("ownerId","ticketId",author,body,kind,"createdAt") VALUES ($1,$2,$3,'QA attachment',$4,$5) RETURNING id`, [ownerId, ticketId, actor.member.name, kind, now])).rows[0].id;
    await linkReadyAttachments(tx, actor, { ids: [file.attachment.id], draftId: file.data.draftId, kind, ticketId, messageId: message });
    if (rollback) throw new Error('intentional rollback');
    return message;
  });
}
async function state(id) { return (await pool.query('SELECT status FROM attachments WHERE id=$1', [id])).rows[0]?.status; }
async function expirePending() {
  await pool.query(`UPDATE attachments SET "expiresAt"=$1,"updatedAt"=$1 WHERE "ownerId"=$2 AND status <> 'attached'`, [old, ownerId]);
  await cleanupAttachments(ownerId, null, 20, database, storage);
}

try {
  await pool.query('INSERT INTO organizations (id,"ownerId",name,"createdAt") VALUES ($1,$2,$3,$4)', [organizationId, ownerId, 'QA attachments', now]);
  for (const [id, name] of [[companyA, 'A'], [companyB, 'B']]) await pool.query('INSERT INTO "customerCompanies" (id,"organizationId","ownerId",name,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$5)', [id, organizationId, ownerId, name, now]);
  actors.owner = await actor('Owner', 'owner'); actors.a = await actor('A', 'client', companyA);
  actors.b = await actor('B', 'client', companyA); actors.manager = await actor('Manager A', 'client', companyA, 'manager');
  actors.other = await actor('Manager B', 'client', companyB, 'manager');
  const ticketId = await ticket(actors.a);

  const draftId = randomUUID();
  const concurrent = await Promise.allSettled(Array.from({ length: 7 }, () => reserve(actors.a, input('request', undefined, draftId))));
  assert.equal(concurrent.filter(r => r.status === 'fulfilled').length, 5, 'Atomic composer limit allows only five concurrent reservations.');
  assert.ok(concurrent.filter(r => r.status === 'rejected').every(r => r.reason.status === 409));
  const more = await Promise.allSettled(Array.from({ length: 8 }, () => reserve(actors.a)));
  assert.equal(more.filter(r => r.status === 'fulfilled').length, 5, 'Atomic member limit allows only ten pending reservations.');
  await expirePending();
  console.log('PASS concurrent five-per-message and ten-per-member quotas');

  const initial = await reserve(actors.a);
  const constraints = await attachmentUploadTokenOptions(actors.a, initial.attachment.id, initial.pathname, false, database);
  assert.equal(constraints.maximumSizeInBytes, 12); assert.equal(constraints.allowOverwrite, false); assert.equal(constraints.addRandomSuffix, false);
  assert.deepEqual(constraints.allowedContentTypes, ['text/plain']); assert.ok(constraints.validUntil <= Date.now() + 5 * 60_000);
  await expectStatus(attachmentUploadTokenOptions(actors.b, initial.attachment.id, initial.pathname, false, database), 404);
  await expectStatus(attachmentUploadTokenOptions(actors.a, initial.attachment.id, 'other/path', false, database), 404);
  await expectStatus(attachmentUploadTokenOptions(actors.a, initial.attachment.id, initial.pathname, true, database), 409);
  await expectStatus(reserve(actors.a, input('note', ticketId)), 403);
  objects.set(initial.pathname, Buffer.from('Daybook test'));
  await completeAttachment(actors.a, initial.attachment.id, database, storage);
  await expectStatus(completeAttachment(actors.b, initial.attachment.id, database, storage), 404);
  await expectStatus(attachmentUploadTokenOptions(actors.a, initial.attachment.id, initial.pathname, false, database), 409);
  assert.equal((await completeAttachment(actors.a, initial.attachment.id, database, storage)).attachment.status, 'ready');
  const wrongSize = await reserve(actors.a);
  objects.set(wrongSize.pathname, Buffer.from('short'));
  await expectStatus(completeAttachment(actors.a, wrongSize.attachment.id, database, storage), 422);
  assert.equal(await state(wrongSize.attachment.id), 'deleting');
  await expirePending();
  console.log('PASS exact-path tokens, ownership, private-note authorization and completion retries');

  const publicFile = await ready(actors.a);
  const beforeMessages = (await pool.query('SELECT count(*)::int AS n FROM messages WHERE "ownerId"=$1', [ownerId])).rows[0].n;
  await assert.rejects(send(actors.a, publicFile, ticketId, 'request', true), /intentional rollback/);
  assert.equal(await state(publicFile.attachment.id), 'ready');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM messages WHERE "ownerId"=$1', [ownerId])).rows[0].n, beforeMessages);
  await send(actors.a, publicFile, ticketId);
  assert.equal(await state(publicFile.attachment.id), 'attached');
  await expectStatus(send(actors.a, publicFile, ticketId), 409);
  const ownDownload = await downloadAttachment(actors.a, publicFile.attachment.id, database, storage);
  assert.equal(await ownDownload.text(), 'Daybook test');
  assert.match(ownDownload.headers.get('cache-control'), /no-store/);
  assert.match(ownDownload.headers.get('content-disposition'), /^attachment;/);
  assert.equal(ownDownload.headers.get('x-content-type-options'), 'nosniff');
  await expectStatus(downloadAttachment(actors.b, publicFile.attachment.id, database, storage), 404);
  await expectStatus(downloadAttachment(actors.other, publicFile.attachment.id, database, storage), 404);
  assert.equal(await (await downloadAttachment(actors.manager, publicFile.attachment.id, database, storage)).text(), 'Daybook test');
  await expectStatus(removePendingAttachment(actors.a, publicFile.attachment.id, database), 409);
  console.log('PASS message/link rollback, one-time binding and authenticated company download isolation');

  const internal = await ready(actors.owner, input('note', ticketId));
  await expectStatus(send(actors.owner, internal, ticketId, 'reply'), 409);
  assert.equal(await state(internal.attachment.id), 'ready');
  await send(actors.owner, internal, ticketId);
  await expectStatus(downloadAttachment(actors.a, internal.attachment.id, database, storage), 404);
  await expectStatus(downloadAttachment(actors.manager, internal.attachment.id, database, storage), 404);
  assert.equal(await (await downloadAttachment(actors.owner, internal.attachment.id, database, storage)).text(), 'Daybook test');
  const expired = await ready(actors.a, input('reply', ticketId));
  await pool.query('UPDATE attachments SET "expiresAt"=$1 WHERE id=$2', [old, expired.attachment.id]);
  await expectStatus(send(actors.a, expired, ticketId), 409);
  const revoked = await ready(actors.b);
  await pool.query("UPDATE members SET status='revoked' WHERE id=$1", [actors.b.member.id]);
  await expectStatus(send(actors.b, revoked, ticketId), 403);
  await pool.query("UPDATE members SET status='active' WHERE id=$1", [actors.b.member.id]);
  const moved = await ready(actors.manager, input('reply', ticketId));
  await pool.query('UPDATE members SET "customerCompanyId"=$1 WHERE id=$2', [companyB, actors.manager.member.id]);
  await expectStatus(send(actors.manager, moved, ticketId), 404);
  await pool.query('UPDATE members SET "customerCompanyId"=$1 WHERE id=$2', [companyA, actors.manager.member.id]);
  console.log('PASS internal attachment privacy, expiry, revoked access and company changes at link time');

  const pending = await ready(actors.owner);
  await removePendingAttachment(actors.owner, pending.attachment.id, database);
  await removePendingAttachment(actors.owner, pending.attachment.id, database);
  assert.equal(await state(pending.attachment.id), 'deleting');
  await expectStatus(completeAttachment(actors.owner, pending.attachment.id, database, storage), 409);
  const priorDelete = removed.length;
  await cleanupAttachments(ownerId, actors.owner.member.id, 20, database, storage);
  assert.equal(removed.length, priorDelete, 'A removal waits for existing five-minute upload tokens to expire.');
  await pool.query('UPDATE attachments SET "updatedAt"=$1 WHERE id=$2', [old, pending.attachment.id]);
  failDelete = true;
  await cleanupAttachments(ownerId, actors.owner.member.id, 20, database, storage);
  assert.equal(await state(pending.attachment.id), 'deleting');
  failDelete = false;
  await pool.query('UPDATE attachments SET "updatedAt"=$1 WHERE id=$2', [old, pending.attachment.id]);
  await cleanupAttachments(ownerId, actors.owner.member.id, 20, database, storage);
  assert.equal(await state(pending.attachment.id), 'deleted');
  assert.equal(await state(internal.attachment.id), 'attached');
  assert.equal(await state(publicFile.attachment.id), 'attached');
  console.log('PASS safe pending deletion, deferred retryable cleanup and preservation of sent files');
} finally {
  try {
    await pool.query('DELETE FROM attachments WHERE "ownerId"=$1', [ownerId]);
    await pool.query('DELETE FROM messages WHERE "ownerId"=$1', [ownerId]);
    await pool.query('DELETE FROM tickets WHERE "ownerId"=$1', [ownerId]);
    await pool.query('DELETE FROM members WHERE "ownerId"=$1 AND "organizationId"=$2', [ownerId, organizationId]);
    await pool.query('DELETE FROM "customerCompanies" WHERE "ownerId"=$1', [ownerId]);
    await pool.query('DELETE FROM organizations WHERE id=$1 AND "ownerId"=$2', [organizationId, ownerId]);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM attachments WHERE "ownerId"=$1', [ownerId])).rows[0].n, 0);
    console.log('PASS attachment QA fixtures removed');
  } finally { await pool.end(); globalThis.fetch = originalFetch; }
}
