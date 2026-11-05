/** SERIAL: fictitious QA owner -> encrypted archive -> empty FK-checked schema -> exact recovery. */
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import pg from 'pg';
import { Database } from '../db/database.ts';
import { BACKUP_TABLES, canonicalBackupRows, decryptBackup, encryptBackup, sha256 } from '../lib/backup-format.ts';
import { createWorkspaceBackup, restoreWorkspaceBackup, backupRestoreStorage } from '../lib/workspace-backup.ts';
import { hashInvite, readInvitation } from '../lib/invitations.ts';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const url = new URL(process.env.DATABASE_URL), ci = process.env.CI === 'true' && process.env.DAYBOOK_RECOVERY_CI === '1';
const realStorage = process.argv.slice(2).includes('--real-qa-storage');
assert.ok(process.argv.slice(2).every(value => value === '--real-qa-storage'));
assert.ok(!ci || !realStorage, 'The CI drill never uses an external file store.');
if (ci) {
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname)); assert.equal(url.port, '5432');
  assert.equal(url.pathname, '/daybook_backup_ci'); assert.equal(url.username, 'daybook_backup_ci');
} else {
  assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
  assert.equal(url.hostname, 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech'); assert.equal(url.pathname, '/daybook_ticket');
}
assert.ok(!process.env.RESEND_API_KEY && !process.env.RESEND_INBOUND_API_KEY && !process.env.DAYBOOK_EMAIL_FROM && !process.env.VAPID_PRIVATE_KEY);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 }), database = new Database(pool);
if (ci) await migrate(drizzle({ client: pool }), { migrationsFolder: './drizzle-postgres' });
const ownerId = `qa-backup-${randomUUID()}`, organizationId = ownerId, now = new Date().toISOString();
const owner = randomUUID(), client = randomUUID(), company = randomUUID(), authIds = [randomUUID(), randomUUID()];
const invited = randomUUID(), invitationToken = randomBytes(32).toString('hex');
const temporaryAccountColumns = ['accessToken', 'refreshToken', 'idToken', 'accessTokenExpiresAt', 'refreshTokenExpiresAt'];
const bearerCredentials = { accessToken: 'qa-not-a-real-access-token', refreshToken: 'qa-not-a-real-refresh-token', idToken: 'qa-not-a-real-id-token', accessTokenExpiresAt: '2099-01-01 00:00:00+00', refreshTokenExpiresAt: '2099-01-01 00:00:00+00' };
const schema = `daybook_restore_qa_${randomBytes(8).toString('hex')}`, failedSchema = `daybook_restore_qa_${randomBytes(8).toString('hex')}`;
const fileMap = new Map(), restoredFiles = new Map();
const fakeStorage = map => ({
  environment: 'qa',
  async read(pathname) { const bytes = map.get(pathname); return bytes ? { size: bytes.length, stream: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) } : null; },
  async write(pathname, bytes) { assert.match(pathname, /^daybook\/qa\/restore\//); map.set(pathname, Buffer.from(bytes)); },
  async remove(pathname) { map.delete(pathname); },
});
const sourceStorage = fakeStorage(fileMap), realPaths = [];
const baseTarget = realStorage ? backupRestoreStorage() : fakeStorage(restoredFiles);
assert.equal(baseTarget.environment, 'qa');
const targetStorage = { ...baseTarget, async write(pathname, bytes, type) { if (realStorage) realPaths.push(pathname); await baseTarget.write(pathname, bytes, type); } };
const access = { ownerId, organizationId, userId: authIds[0], role: 'owner', member: { id: owner, name: 'Propietario ficticio', email: `${owner}@example.test`, role: 'owner', status: 'active', hasAccount: true, customerCompanyId: null, companyAccess: 'own', createdAt: now, updatedAt: now } };
async function cloneEmpty(destination) {
  await database.transaction(async tx => {
    await tx.query(`CREATE SCHEMA "${destination}"`);
    for (const table of BACKUP_TABLES) await tx.query(`CREATE TABLE "${destination}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    // Retrieve fully qualified FK definitions, then remap every reference to the isolated clone.
    await tx.query('SET LOCAL search_path=pg_catalog');
    const constraints = (await tx.query(`SELECT r.relname AS table_name,c.conname,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname=ANY($1::text[]) AND c.contype='f'`, [BACKUP_TABLES])).rows;
    for (const constraint of constraints) await tx.query(`ALTER TABLE "${destination}"."${constraint.table_name}" ADD CONSTRAINT "${constraint.conname}" ${constraint.definition.replaceAll('REFERENCES public.', `REFERENCES "${destination}".`)}`);
  });
}
async function assertTemporaryCredentialsNotRestored(destination) {
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM "${destination}".invitations`)).rows[0].n, 0);
  const destinationDatabase = { prepare(sql) { return database.prepare(sql.replace('FROM invitations i JOIN members m', `FROM "${destination}".invitations i JOIN "${destination}".members m`)); } };
  assert.equal(await readInvitation(destinationDatabase, invitationToken), null, 'The original valid invitation cannot activate an account in the recovered workspace.');
  const member = (await pool.query(`SELECT status,"userId" FROM "${destination}".members WHERE id=$1`, [invited])).rows[0];
  assert.deepEqual(member, { status: 'invited', userId: null }, 'Invited members remain available for a new invitation.');
  const accounts = (await pool.query(`SELECT * FROM "${destination}"."authAccount"`)).rows;
  assert.equal(accounts.length, authIds.length);
  for (const account of accounts) {
    assert.equal(account.password, 'QA-NOT-A-REAL-CREDENTIAL');
    assert.equal(account.providerId, 'credential'); assert.equal(account.accountId, account.userId);
    for (const column of temporaryAccountColumns) assert.equal(account[column], null, `${column} must not become a recovered credential.`);
  }
}
try {
  for (let i = 0; i < authIds.length; i++) {
    await pool.query('INSERT INTO "authUser" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,\'Cuenta ficticia QA\',$2,true,$3,$3)', [authIds[i], `${authIds[i]}@example.test`, '2026-11-05T04:00:00.123456Z']);
    await pool.query('INSERT INTO "authAccount" (id,"accountId","providerId","userId",password,"accessToken","refreshToken","idToken","accessTokenExpiresAt","refreshTokenExpiresAt","createdAt","updatedAt") VALUES ($1,$2,\'credential\',$2,\'QA-NOT-A-REAL-CREDENTIAL\',$3,$4,$5,$6,$7,$8,$8)', [randomUUID(), authIds[i], ...temporaryAccountColumns.map(column => bearerCredentials[column]), now]);
  }
  await pool.query('INSERT INTO organizations (id,"ownerId",name,"createdAt") VALUES ($1,$1,\'Respaldo ficticio QA\',$2)', [ownerId, now]);
  await pool.query('INSERT INTO "customerCompanies" (id,"organizationId","ownerId",name,"createdAt","updatedAt") VALUES ($1,$2,$2,\'Empresa ficticia QA\',$3,$3)', [company, ownerId, now]);
  for (const [id, userId, role] of [[owner, authIds[0], 'owner'], [client, authIds[1], 'client']]) await pool.query('INSERT INTO members (id,"organizationId","ownerId","userId",email,name,role,status,"customerCompanyId","companyAccess","createdAt","updatedAt") VALUES ($1,$2,$2,$3,$4,\'Cuenta ficticia QA\',$5,\'active\',$6,\'own\',$7,$7)', [id, ownerId, userId, `${id}@example.test`, role, role === 'client' ? company : null, now]);
  await pool.query('INSERT INTO members (id,"organizationId","ownerId",email,name,role,status,"createdAt","updatedAt") VALUES ($1,$2,$2,$3,\'Invitación ficticia QA\',\'client\',\'invited\',$4,$4)', [invited, ownerId, `${invited}@example.test`, now]);
  await pool.query('INSERT INTO invitations ("memberId","ownerId","tokenHash","expiresAt","createdAt") VALUES ($1,$2,$3,$4,$5)', [invited, ownerId, await hashInvite(invitationToken), new Date(Date.now() + 72 * 3600000).toISOString(), now]);
  assert.equal((await readInvitation(database, invitationToken))?.id, invited, 'The source fixture has a valid invitation before export.');
  const ticket = (await pool.query('INSERT INTO tickets ("ownerId","creationKey",subject,"requesterName","requesterEmail","requesterMemberId","customerCompanyId",department,assignee,"assigneeMemberId",status,priority,"createdAt","updatedAt","dueAt") VALUES ($1,$2,\'QA recuperación\',\'Cliente ficticio\',$3,$4,$5,\'Soporte\',\'Propietario ficticio\',$6,\'open\',\'normal\',$7,$7,$7) RETURNING id', [ownerId, randomUUID(), `${client}@example.test`, client, company, owner, now])).rows[0].id;
  for (const [kind, authorId, role] of [['request', client, 'client'], ['note', owner, 'owner']]) {
    const messageId = (await pool.query('INSERT INTO messages ("ownerId","ticketId",author,"authorMemberId","authorRole",body,"bodyFormat",kind,"createdAt") VALUES ($1,$2,\'Cuenta ficticia QA\',$3,$4,$5,\'markdown\',$6,$7) RETURNING id', [ownerId, ticket, authorId, role, kind === 'note' ? 'Nota **privada** ficticia' : 'Solicitud **pública** ficticia', kind, now])).rows[0].id;
    const id = randomUUID(), pathname = `qa-backup-fixture/${id}.txt`, bytes = Buffer.from(`Archivo ${kind} ficticio para recuperación`); fileMap.set(pathname, bytes);
    await pool.query('INSERT INTO attachments (id,"ownerId","memberId","draftId","ticketId","messageId",kind,pathname,name,"contentType",size,status,"expiresAt","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,\'qa-fixture.txt\',\'text/plain\',$9,\'attached\',$10,$10,$10)', [id, ownerId, authorId, randomUUID(), ticket, messageId, kind, pathname, bytes.length, now]);
  }
  const queuedId = randomUUID(), processingId = randomUUID();
  for (const [id, status] of [[queuedId, 'queued'], [processingId, 'processing']]) await pool.query('INSERT INTO "mailOutbox" (id,"ownerId","eventKey",event,"recipientMemberId","ticketId",status,attempts,"payloadJson","createdAt","updatedAt") VALUES ($1,$2,$1,\'ticket_created\',$3,$4,$5,1,$6,$7,$7)', [id, ownerId, owner, ticket, status, JSON.stringify({ fixture: 'frozen-qa-payload' }), now]);
  await pool.query('INSERT INTO "notificationSettings" ("ownerId","alertsActivatedAt","remindersEnabled","remindersActivatedAt") VALUES ($1,$2,true,$2)', [ownerId, now]);
  const archive = await createWorkspaceBackup(access, database, sourceStorage);
  assert.equal(archive.files.length, 2); assert.equal(archive.tables.find(table => table.name === 'messages').rows.length, 2);
  assert.match(archive.tables.find(table => table.name === 'authUser').rows[0].createdAt, /123456/);
  assert.ok(archive.tables.find(table => table.name === 'authAccount').rows.every(row => row.password === 'QA-NOT-A-REAL-CREDENTIAL'));
  assert.ok(archive.tables.find(table => table.name === 'authAccount').rows.every(row => temporaryAccountColumns.every(column => row[column] === null)));
  assert.equal(archive.tables.find(table => table.name === 'invitations').rows.length, 0, 'Temporary invitation credentials never enter a new archive.');
  assert.equal((await readInvitation(database, invitationToken))?.id, invited, 'Export never revokes the source invitation.');
  await assert.rejects(createWorkspaceBackup({ ...access, role: 'admin' }, database, sourceStorage), error => error.status === 403);
  const encrypted = encryptBackup(archive, 'qa-only-recovery-password'), recovered = decryptBackup(encrypted, 'qa-only-recovery-password');
  assert.deepEqual(recovered, archive);
  await cloneEmpty(schema); await cloneEmpty(failedSchema);
  const result = await restoreWorkspaceBackup(recovered, database, targetStorage, { environment: 'qa', schema });
  assert.equal(result.restored, true); assert.equal(result.fingerprints.length, BACKUP_TABLES.length); assert.equal(result.files, 2);
  assert.equal(result.temporaryCredentialsRestored, false);
  await assertTemporaryCredentialsNotRestored(schema);
  assert.equal((await pool.query(`SELECT "remindersEnabled" FROM "${schema}"."notificationSettings"`)).rows[0].remindersEnabled, false);
  assert.equal((await pool.query(`SELECT status FROM "${schema}"."mailOutbox" WHERE id=$1`, [queuedId])).rows[0].status, 'cancelled');
  assert.equal((await pool.query(`SELECT status FROM "${schema}"."mailOutbox" WHERE id=$1`, [processingId])).rows[0].status, 'unknown');
  if (!realStorage) { assert.equal(restoredFiles.size, 2); assert.deepEqual([...restoredFiles.values()].map(sha256).sort(), [...fileMap.values()].map(sha256).sort()); }
  else assert.equal(realPaths.length, 2, 'Two private QA objects were written and verified by the recovery operator.');
  const countBefore = restoredFiles.size;
  await assert.rejects(restoreWorkspaceBackup(recovered, database, targetStorage, { environment: 'qa', schema }), /empty destination/);
  assert.equal(restoredFiles.size, countBefore, 'Refusing an occupied destination creates no new files.');
  if (realStorage) assert.equal(realPaths.length, 2);
  const brokenFiles = new Map(), broken = { ...fakeStorage(brokenFiles), async write(pathname, bytes) { brokenFiles.set(pathname, Buffer.from('corrupt')); void bytes; } };
  await assert.rejects(restoreWorkspaceBackup(recovered, database, broken, { environment: 'qa', schema: failedSchema }), /checksum|size/i);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM "${failedSchema}".tickets`)).rows[0].n, 0);
  assert.equal(brokenFiles.size, 0, 'Failed pre-commit copies are cleaned after rollback.');
  // The v1 reader must also accept old archives, verify their original rows and invalidate
  // temporary credentials inside the recovery transaction before they become usable.
  const legacy = structuredClone(recovered);
  for (const row of legacy.tables.find(table => table.name === 'authAccount').rows) Object.assign(row, bearerCredentials);
  legacy.tables.find(table => table.name === 'invitations').rows = (await pool.query('SELECT * FROM invitations WHERE "ownerId"=$1', [ownerId])).rows;
  for (const table of legacy.tables) table.sha256 = sha256(canonicalBackupRows(table.rows));
  const uncertainFiles = new Map(), uncertainDatabase = { async transaction(work) { const value = await database.transaction(work); void value; throw new Error('qa-lost-commit-response'); } };
  await assert.rejects(restoreWorkspaceBackup(legacy, uncertainDatabase, fakeStorage(uncertainFiles), { environment: 'qa', schema: failedSchema }), /lost-commit/);
  assert.equal(uncertainFiles.size, 2, 'An uncertain commit never deletes files that the committed rows reference.');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM "${failedSchema}".tickets`)).rows[0].n, 1);
  await assertTemporaryCredentialsNotRestored(failedSchema);
  console.log(JSON.stringify({ result: 'PASS', tables: BACKUP_TABLES.length, files: 2, storage: realStorage ? 'real-private-qa' : 'injected-private', checks: ['owner-only-export', 'private-note-and-file-preservation', 'credential-and-microsecond-preservation', 'temporary-credentials-excluded', 'legacy-v1-credentials-invalidated', 'invited-members-preserved', 'encrypted-exact-roundtrip', 'real-foreign-keys', 'empty-destination-only', 'all-row-checksums', 'private-file-hashes', 'restored-deliveries-paused', 'corrupt-file-rollback', 'uncertain-commit-keeps-files'], externalEmailRequests: 0 }));
} finally {
  const storageCleanupErrors = [];
  for (const pathname of realPaths) {
    try { assert.match(pathname, /^daybook\/qa\/restore\/[a-f0-9-]+\/[a-f0-9-]+\.bin$/); await baseTarget.remove(pathname); }
    catch (error) { storageCleanupErrors.push(error); }
  }
  // Test-owned isolated schemas only. No existing schema/table is dropped.
  for (const destination of [schema, failedSchema]) await pool.query(`DROP SCHEMA IF EXISTS "${destination}" CASCADE`);
  for (const table of [...BACKUP_TABLES].reverse().filter(table => !['authUser', 'authAccount'].includes(table))) await pool.query(`DELETE FROM "${table}" WHERE "ownerId"=$1`, [ownerId]);
  await pool.query('DELETE FROM "authAccount" WHERE "userId"=ANY($1::text[])', [authIds]); await pool.query('DELETE FROM "authUser" WHERE id=ANY($1::text[])', [authIds]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM organizations WHERE "ownerId"=$1', [ownerId])).rows[0].n, 0);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM pg_namespace WHERE nspname=ANY($1::text[])', [[schema, failedSchema]])).rows[0].n, 0);
  await pool.end();
  assert.equal(storageCleanupErrors.length, 0, 'All generated private QA objects must be removed.');
  console.log(`QA recovery cleanup PASS: test accounts, ${realStorage ? 'private QA objects' : 'in-memory files'} and isolated schemas removed.`);
}
