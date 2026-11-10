/** SERIAL QA ONLY. Fictitious workspace, real SQL/crypto, in-memory private file transport. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Database } from '../db/database.ts';
import {
  PgAutomaticBackupRepository,
  executeAutomaticBackup,
  saveAutomaticBackupSettings,
  getAutomaticBackupStatus,
  downloadAutomaticBackup,
} from '../lib/automatic-backup.ts';
import { automaticBackupConfiguration, AUTOMATIC_BACKUP_MAX_BYTES } from '../lib/automatic-backup-model.ts';
import { decryptBackup } from '../lib/backup-format.ts';
import { createWorkspaceBackup, backupRestoreStorage } from '../lib/workspace-backup.ts';
import { automaticBackupStorage } from '../lib/automatic-backup-storage.ts';
import { withQaCleanup } from './qa-cleanup-transaction.mjs';

assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
const realStorage = process.argv.slice(2).includes('--real-qa-storage');
assert.ok(process.argv.slice(2).every(value => value === '--real-qa-storage'));
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
assert.equal(url.pathname, '/daybook_ticket');
assert.ok(!process.env.RESEND_API_KEY && !process.env.RESEND_INBOUND_API_KEY && !process.env.VAPID_PRIVATE_KEY);
if (realStorage) {
  assert.notEqual(process.env.VERCEL_ENV, 'production');
  assert.equal(process.env.DAYBOOK_BLOB_ENV, 'qa');
  assert.ok(
    !process.env.DAYBOOK_BLOB_PRODUCTION_READ_WRITE_TOKEN && !process.env.DAYBOOK_AUTOMATIC_BACKUP_KEY_PRODUCTION,
  );
}
const pool = new pg.Pool({ connectionString: url.toString(), max: 4 }),
  database = new Database(pool);
const ownerId = `qa-automatic-backup-${randomUUID()}`,
  userId = randomUUID(),
  memberId = randomUUID();
const now = new Date(),
  timestamp = now.toISOString(),
  archiveMap = new Map();
const env = {
  VERCEL_ENV: 'preview',
  DAYBOOK_BLOB_ENV: 'qa',
  DAYBOOK_BLOB_QA_READ_WRITE_TOKEN: 'fictional-not-a-store-token',
  DAYBOOK_AUTOMATIC_BACKUP_ENABLED: 'true',
  DAYBOOK_AUTOMATIC_BACKUP_KEY_QA: 'fictional-qa-backup-key-only-xxxxxxxxxxxxxxxxxxxxxxxx',
  DAYBOOK_AUTOMATIC_BACKUP_STORAGE_BUDGET_MIB: '512',
  DAYBOOK_AUTOMATIC_BACKUP_MONTHLY_TRANSFER_BUDGET_MIB: '4096',
  DAYBOOK_AUTOMATIC_BACKUP_PLAN_CHECKED_AT: timestamp,
};
const config = automaticBackupConfiguration(realStorage ? process.env : env, now);
assert.equal(config.ready, true);
assert.equal(config.environment, 'qa');
const realArchivePaths = [],
  baseArchiveStorage = realStorage ? automaticBackupStorage() : null;
const storage = {
  async write(path, bytes, deadline) {
    assert.equal(archiveMap.has(path), false);
    if (baseArchiveStorage) {
      realArchivePaths.push(path);
      await baseArchiveStorage.write(path, bytes, deadline);
    }
    archiveMap.set(path, Buffer.from(bytes));
  },
  async read(path, deadline) {
    if (baseArchiveStorage) return baseArchiveStorage.read(path, deadline);
    const bytes = archiveMap.get(path);
    return bytes ? Buffer.from(bytes) : null;
  },
  async remove(path, deadline) {
    if (baseArchiveStorage) await baseArchiveStorage.remove(path, deadline);
    archiveMap.delete(path);
  },
};
const sourceBytes = Buffer.from('Fictitious private attachment for the automatic backup QA drill.');
const sourcePath = realStorage
  ? `daybook/qa/automatic-backup-drill/${randomUUID()}.txt`
  : `qa-automatic-backup/${ownerId}`;
const realSourceStorage = realStorage ? backupRestoreStorage() : null;
if (realSourceStorage) assert.equal(realSourceStorage.environment, 'qa');
let sourceMayExist = false;
const sourceStorage = realSourceStorage || {
  async read(path) {
    assert.equal(path, sourcePath);
    return {
      size: sourceBytes.length,
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(sourceBytes);
          controller.close();
        },
      }),
    };
  },
  async remove() {
    assert.fail('A backup must never delete source attachments.');
  },
};
const access = {
  ownerId,
  organizationId: ownerId,
  userId,
  role: 'owner',
  member: {
    id: memberId,
    role: 'owner',
    name: 'Propietario ficticio QA',
    email: `${memberId}@example.test`,
    status: 'active',
    hasAccount: true,
    customerCompanyId: null,
    companyAccess: 'own',
    createdAt: timestamp,
    updatedAt: timestamp,
  },
};
const repository = new PgAutomaticBackupRepository(database);
try {
  if (realSourceStorage) {
    sourceMayExist = true;
    await realSourceStorage.write(sourcePath, sourceBytes, 'text/plain');
  }
  await pool.query(
    'INSERT INTO "authUser" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,\'QA ficticio\',$2,true,$3,$3)',
    [userId, `${userId}@example.test`, timestamp],
  );
  await pool.query(
    'INSERT INTO organizations (id,"ownerId",name,"createdAt") VALUES ($1,$1,\'Respaldo automático QA\',$2)',
    [ownerId, timestamp],
  );
  await pool.query(
    'INSERT INTO members (id,"organizationId","ownerId","userId",email,name,role,status,"createdAt","updatedAt") VALUES ($1,$2,$2,$3,$4,\'QA ficticio\',\'owner\',\'active\',$5,$5)',
    [memberId, ownerId, userId, `${memberId}@example.test`, timestamp],
  );
  const ticket = (
    await pool.query(
      'INSERT INTO tickets ("ownerId","creationKey",subject,"requesterName","requesterEmail",department,assignee,status,priority,"createdAt","updatedAt","dueAt") VALUES ($1,$2,\'QA respaldo\',\'QA ficticio\',$3,\'Soporte\',\'\',\'open\',\'normal\',$4,$4,$4) RETURNING id',
      [ownerId, randomUUID(), `${memberId}@example.test`, timestamp],
    )
  ).rows[0].id;
  const message = (
    await pool.query(
      'INSERT INTO messages ("ownerId","ticketId",author,"authorMemberId","authorRole",body,kind,"createdAt") VALUES ($1,$2,\'QA ficticio\',$3,\'owner\',\'Nota privada ficticia\',\'note\',$4) RETURNING id',
      [ownerId, ticket, memberId, timestamp],
    )
  ).rows[0].id;
  await pool.query(
    'INSERT INTO attachments (id,"ownerId","memberId","draftId","ticketId","messageId",kind,pathname,name,"contentType",size,status,"expiresAt","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,\'note\',$7,\'qa.txt\',\'text/plain\',$8,\'attached\',$9,$9,$9)',
    [randomUUID(), ownerId, memberId, randomUUID(), ticket, message, sourcePath, sourceBytes.length, timestamp],
  );
  assert.equal((await getAutomaticBackupStatus(access, database, config)).settings.enabled, false);
  await assert.rejects(
    saveAutomaticBackupSettings(
      access,
      database,
      { enabled: true, localTime: '00:00', retention: 7, storageBudgetMiB: 512, version: 0, planConfirmed: false },
      config,
    ),
  );
  const retention = config.storageBudgetMiB >= 256 ? 7 : 1;
  await saveAutomaticBackupSettings(
    access,
    database,
    {
      enabled: true,
      localTime: '00:00',
      retention,
      storageBudgetMiB: config.storageBudgetMiB,
      version: 0,
      planConfirmed: true,
    },
    config,
  );
  const claims = await Promise.all([repository.claim(access, config, now), repository.claim(access, config, now)]);
  assert.equal(claims.filter(Boolean).length, 1, 'Concurrent invocations must share one daily run and one lease.');
  const claim = claims.find(Boolean);
  const diagnostics = [];
  const outcome = await executeAutomaticBackup(claim, repository, {
    config,
    storage,
    deadline: Date.now() + 270000,
    diagnostic: detail => {
      diagnostics.push(detail);
      console.log(JSON.stringify({ automaticBackupDiagnostic: detail }));
    },
    create: () => createWorkspaceBackup(access, database, sourceStorage, { deadline: Date.now() + 180000 }),
  });
  assert.equal(outcome.result, 'complete', `Automatic backup outcome: ${JSON.stringify({ outcome, diagnostics })}`);
  assert.equal(archiveMap.size, 1);
  const restored = decryptBackup([...archiveMap.values()][0], config.key);
  assert.equal(restored.files.length, 1);
  assert.equal(Buffer.from(restored.files[0].base64, 'base64').equals(sourceBytes), true);
  assert.equal(restored.tables.find(table => table.name === 'messages').rows[0].body, 'Nota privada ficticia');
  await repository.release(claim);
  const repeated = await repository.claim(access, config, now);
  assert.equal(repeated.cleanupOnly, true);
  await repository.release(repeated);
  assert.equal(
    (await pool.query('SELECT count(*)::int AS n FROM "automaticBackupRuns" WHERE "ownerId"=$1', [ownerId])).rows[0].n,
    1,
  );
  const delivered = await downloadAutomaticBackup(access, claim.run.id, database, config, storage);
  assert.equal(delivered.bytes.equals([...archiveMap.values()][0]), true);
  delivered.bytes.fill(0);
  assert.equal((await getAutomaticBackupStatus(access, database, config)).runs[0].downloadable, true);
  await assert.rejects(getAutomaticBackupStatus({ ...access, role: 'admin' }, database, config));
  // A lease token from an earlier invocation cannot mutate the completed run.
  assert.equal(
    await repository.saveArchive(
      { ...claim, token: randomUUID() },
      { keyId: config.keyId, archiveSha256: '0'.repeat(64), sizeBytes: 1, rowCount: 0, fileCount: 0 },
    ),
    false,
  );
  await pool.query('UPDATE "automaticBackupUsage" SET "transferBytes"=$2 WHERE "ownerId"=$1', [
    ownerId,
    config.monthlyTransferBudgetMiB * 1048576,
  ]);
  await assert.rejects(
    repository.claim(access, config, new Date(now.getTime() + 86400000)),
    error => error.code === 'monthly_budget_reached',
  );
  assert.equal(
    (await pool.query('SELECT count(*)::int AS n FROM "automaticBackupRuns" WHERE "ownerId"=$1', [ownerId])).rows[0].n,
    1,
    'A quota failure must roll back the daily reservation.',
  );
  // Fill the physical budget with old verified objects. A new day must still
  // obtain maintenance without consuming another transfer reservation.
  await pool.query(
    'UPDATE "automaticBackupSettings" SET retention=1,"storageBudgetMiB"=64,version=version+1 WHERE "ownerId"=$1',
    [ownerId],
  );
  const oldIds = [randomUUID(), randomUUID()];
  for (let index = 0; index < oldIds.length; index++)
    await pool.query(
      `INSERT INTO "automaticBackupRuns"
    (id,"ownerId",environment,"localDate",status,attempts,"keyId","archiveSha256","sizeBytes","reservedBytes","rowCount","fileCount","createdAt","updatedAt","verifiedAt")
    VALUES ($1,$2,'qa',$3,'complete',1,$4,$5,$6,$6,0,0,$7,$7,$7)`,
      [
        oldIds[index],
        ownerId,
        `2020-01-0${index + 1}`,
        config.keyId,
        '0'.repeat(64),
        AUTOMATIC_BACKUP_MAX_BYTES,
        `2020-01-0${index + 1}T00:00:00.000Z`,
      ],
    );
  const maintenance = await repository.claim(access, config, new Date(now.getTime() + 86400000));
  assert.equal(maintenance.cleanupOnly, true, 'Full storage must not prevent cleanup.');
  const removed = [],
    cleanupStorage = {
      ...storage,
      async remove(path) {
        removed.push(path);
        await storage.remove(path);
      },
    };
  await pool.query('UPDATE "automaticBackupSettings" SET enabled=false WHERE "ownerId"=$1', [ownerId]);
  await repository.cleanup(maintenance, cleanupStorage, Date.now() + 270000);
  assert.deepEqual(removed, [], 'A paused schedule cannot delete archives.');
  await pool.query('UPDATE "automaticBackupSettings" SET enabled=true,version=version+1 WHERE "ownerId"=$1', [ownerId]);
  await repository.cleanup(maintenance, cleanupStorage, Date.now() + 270000);
  assert.deepEqual(removed, [], 'Changed retention/settings defer cleanup until a fresh claim.');
  await repository.release(maintenance);
  const freshMaintenance = await repository.claim(access, config, new Date(now.getTime() + 86400000));
  await repository.cleanup(freshMaintenance, cleanupStorage, Date.now() + 270000);
  await repository.release(freshMaintenance);
  assert.equal(removed.length, 2);
  assert.equal(
    (await pool.query('SELECT status FROM "automaticBackupRuns" WHERE id=$1', [claim.run.id])).rows[0].status,
    'complete',
    'The latest verified archive must survive cleanup.',
  );
  assert.equal(
    (
      await pool.query('SELECT "transferBytes"::text AS bytes FROM "automaticBackupUsage" WHERE "ownerId"=$1', [
        ownerId,
      ])
    ).rows[0].bytes,
    String(config.monthlyTransferBudgetMiB * 1048576),
    'Physical cleanup never refunds monthly transfer.',
  );
  assert.equal(AUTOMATIC_BACKUP_MAX_BYTES, 33554432);
  console.log(
    `PASS automatic encrypted backup QA: owner ACL, concurrent lease, snapshot/private-file/hash/decryption/readback, daily identity, download, stale fencing, quota rollback and retention/pause/version fences; ${realStorage ? 'private QA Blob transport' : 'in-memory transport; no external providers'}.`,
  );
} finally {
  await withQaCleanup(pool, ownerId, async tx => {
    for (const table of [
      'automaticBackupUsage',
      'automaticBackupRuns',
      'automaticBackupSettings',
      'attachments',
      'messages',
      'tickets',
      'members',
      'organizations',
    ]) {
      await tx.query(`DELETE FROM "${table}" WHERE "ownerId"=$1`, [ownerId]);
    }
    await tx.query('DELETE FROM "authUser" WHERE id=$1', [userId]);
  });
  try {
    if (baseArchiveStorage) for (const path of realArchivePaths) await baseArchiveStorage.remove(path);
    if (sourceMayExist) await realSourceStorage.remove(sourcePath);
  } finally {
    archiveMap.clear();
    await pool.end();
  }
}
