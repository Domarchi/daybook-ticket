/** SERIAL QA: preview bytes/headers and fresh permissions, with private storage injected. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import pg from 'pg';
import { Database } from '../db/database.ts';
import { previewAttachment } from '../lib/attachments.ts';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
assert.equal(new URL(process.env.DATABASE_URL).hostname, 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
assert.ok(!process.env.RESEND_API_KEY && !process.env.RESEND_INBOUND_API_KEY && !process.env.VAPID_PRIVATE_KEY);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 }), database = new Database(pool);
const ownerId = `qa-preview-${randomUUID()}`, owner = randomUUID(), client = randomUUID(), other = randomUUID(), company = randomUUID(), companyB = randomUUID(), now = new Date().toISOString();
const access = (id, role, companyId = null) => ({ ownerId, organizationId: ownerId, userId: `qa-user-${id}`, role, member: { id, name: 'Cuenta ficticia', email: `${id}@example.test`, role, status: 'active', hasAccount: true, customerCompanyId: companyId, companyAccess: 'own', createdAt: now, updatedAt: now } });
const staff = access(owner, 'owner'), customer = access(client, 'client', company), stranger = access(other, 'client', companyB);
const files = new Map(); let reads = 0;
const storage = { async read(path) { reads++; const bytes = files.get(path); return bytes ? { size: bytes.length, stream: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) } : null; }, async remove() {} };
try {
  await pool.query('INSERT INTO organizations (id,"ownerId",name,"createdAt") VALUES ($1,$1,\'QA vista previa\',$2)', [ownerId, now]);
  for (const id of [company, companyB]) await pool.query('INSERT INTO "customerCompanies" (id,"organizationId","ownerId",name,"createdAt","updatedAt") VALUES ($1,$2,$2,\'Empresa ficticia\',$3,$3)', [id, ownerId, now]);
  for (const item of [staff, customer, stranger]) await pool.query('INSERT INTO members (id,"organizationId","ownerId","userId",email,name,role,status,"customerCompanyId","companyAccess","createdAt","updatedAt") VALUES ($1,$2,$2,$3,$4,\'Cuenta ficticia\',$5,\'active\',$6,\'own\',$7,$7)', [item.member.id, ownerId, item.userId, item.member.email, item.role, item.member.customerCompanyId, now]);
  const ticket = (await pool.query('INSERT INTO tickets ("ownerId","creationKey",subject,"requesterName","requesterEmail","requesterMemberId","customerCompanyId",department,status,priority,"createdAt","updatedAt","dueAt") VALUES ($1,$2,\'QA archivos\',\'Cliente ficticio\',$3,$4,$5,\'Soporte\',\'open\',\'normal\',$6,$6,$6) RETURNING id', [ownerId, randomUUID(), customer.member.email, client, company, now])).rows[0].id;
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#efc56e' } }).png().toBuffer(), pdf = Buffer.from(await (await PDFDocument.create()).save());
  const ids = {};
  for (const [label, kind, bytes, type, name] of [['publicImage', 'request', png, 'image/png', 'qa.png'], ['internalImage', 'note', png, 'image/png', 'internal.png'], ['publicPdf', 'reply', pdf, 'application/pdf', 'qa.pdf'], ['text', 'reply', Buffer.from('Texto ficticio'), 'text/plain', 'qa.txt']]) {
    const message = (await pool.query('INSERT INTO messages ("ownerId","ticketId",author,"authorMemberId","authorRole",body,kind,"createdAt") VALUES ($1,$2,\'QA\',$3,$4,\'Contenido ficticio\',$5,$6) RETURNING id', [ownerId, ticket, kind === 'request' ? client : owner, kind === 'request' ? 'client' : 'owner', kind, now])).rows[0].id;
    const id = randomUUID(), path = `qa-preview/${id}`; files.set(path, bytes); ids[label] = id;
    await pool.query('INSERT INTO attachments (id,"ownerId","memberId","draftId","ticketId","messageId",kind,pathname,name,"contentType",size,status,"expiresAt","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,\'attached\',$12,$12,$12)', [id, ownerId, kind === 'request' ? client : owner, randomUUID(), ticket, message, kind, path, name, type, bytes.length, now]);
  }
  for (const [id, expected] of [[ids.publicImage, png], [ids.publicPdf, pdf]]) {
    const response = await previewAttachment(customer, id, database, storage);
    assert.match(response.headers.get('Content-Disposition'), /^inline;/); assert.match(response.headers.get('Cache-Control'), /private, no-store/);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff'); assert.match(response.headers.get('Content-Security-Policy'), /sandbox/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
  }
  await assert.rejects(previewAttachment(customer, ids.text, database, storage), error => error.status === 415);
  const beforeDenied = reads;
  await assert.rejects(previewAttachment(customer, ids.internalImage, database, storage), error => error.status === 404);
  await assert.rejects(previewAttachment(stranger, ids.publicImage, database, storage), error => error.status === 404);
  assert.equal(reads, beforeDenied, 'Unauthorized previews never read the private object.');
  const internal = await previewAttachment(staff, ids.internalImage, database, storage); assert.deepEqual(Buffer.from(await internal.arrayBuffer()), png);
  await pool.query('UPDATE members SET "customerCompanyId"=$2 WHERE id=$1', [client, companyB]);
  await assert.rejects(previewAttachment(customer, ids.publicImage, database, storage), error => error.status === 404, 'Old company context is rejected.');
  await pool.query('UPDATE members SET status=\'revoked\' WHERE id=$1', [owner]);
  await assert.rejects(previewAttachment(staff, ids.internalImage, database, storage), error => error.status === 404, 'A stale owner context cannot read a private file.');
  console.log(JSON.stringify({ result: 'PASS', checks: ['image-preview-bytes', 'pdf-preview-bytes', 'inline-private-no-cache-sandbox', 'unsupported-format', 'internal-file-denial', 'other-company-denial', 'current-company-and-membership', 'no-unauthorized-storage-read'], externalRequests: 0 }));
} finally {
  for (const table of ['attachments', 'messages', 'tickets', 'members', 'customerCompanies', 'organizations']) await pool.query(`DELETE FROM "${table}" WHERE "ownerId"=$1`, [ownerId]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM organizations WHERE "ownerId"=$1', [ownerId])).rows[0].n, 0);
  await pool.end(); console.log('QA preview cleanup PASS.');
}
