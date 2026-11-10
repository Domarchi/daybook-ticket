/** Owner-only encrypted backup/recovery operator. No credential or plaintext backup is logged. */
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { Database } from '../db/database.ts';
import { createWorkspaceBackup, backupRestoreStorage, restoreWorkspaceBackup } from '../lib/workspace-backup.ts';
import { decryptBackup, encryptBackup, MAX_BACKUP_BYTES } from '../lib/backup-format.ts';

const [command, file] = process.argv.slice(2);
if (!['create', 'verify', 'restore'].includes(command) || !file)
  throw new Error(
    'Usage: node --env-file=<private.env> --import tsx scripts/daybook-backup.mjs create|verify|restore <file.daybook>',
  );
const password = process.env.DAYBOOK_BACKUP_PASSWORD;
if (!password) throw new Error('Set DAYBOOK_BACKUP_PASSWORD privately; never pass it as a command-line argument.');
async function readArchive() {
  if ((await stat(resolve(file))).size > MAX_BACKUP_BYTES) throw new Error('Backup file exceeds 128 MiB.');
  return readFile(resolve(file));
}
if (command === 'verify') {
  const backup = decryptBackup(await readArchive(), password);
  console.log(
    JSON.stringify({
      valid: true,
      tables: backup.tables.length,
      rows: backup.tables.reduce((n, table) => n + table.rows.length, 0),
      files: backup.files.length,
    }),
  );
} else {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Configure the explicit source/destination database.');
  if (
    command === 'restore' &&
    (process.env.RESEND_API_KEY ||
      process.env.RESEND_INBOUND_API_KEY ||
      process.env.VAPID_PRIVATE_KEY ||
      process.env.DAYBOOK_NOTIFICATION_JOB_ENABLED === 'true' ||
      process.env.DAYBOOK_INBOUND_ENABLED === 'true' ||
      process.env.DAYBOOK_SATISFACTION_ENABLED !== 'false')
  )
    throw new Error(
      'Disable all real delivery, inbound processing, satisfaction invitations and scheduled work before recovery.',
    );
  const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10000 }),
    database = new Database(pool);
  try {
    if (command === 'create') {
      const owners = await database
        .prepare(
          `SELECT m.*,o.id AS "organizationId" FROM members m JOIN organizations o ON o."ownerId"=m."ownerId" WHERE m.role='owner' AND m.status='active' AND m."userId" IS NOT NULL`,
        )
        .all();
      if (owners.results.length !== 1) throw new Error('Exactly one active workspace owner is required.');
      const owner = owners.results[0];
      const backup = await createWorkspaceBackup(
        {
          ownerId: owner.ownerId,
          organizationId: owner.organizationId,
          userId: owner.userId,
          member: { ...owner, hasAccount: true },
          role: 'owner',
        },
        database,
      );
      await writeFile(resolve(file), encryptBackup(backup, password), { mode: 0o600, flag: 'wx' });
      console.log(JSON.stringify({ created: true, tables: backup.tables.length, files: backup.files.length }));
    } else {
      const backup = decryptBackup(await readArchive(), password);
      if (process.env.DAYBOOK_BACKUP_RESTORE_CONFIRM !== backup.ownerId)
        throw new Error('Confirm the source ownerId privately with DAYBOOK_BACKUP_RESTORE_CONFIRM.');
      const environment = process.env.DAYBOOK_BLOB_ENV;
      if (!['qa', 'production'].includes(environment)) throw new Error('Choose the explicit destination environment.');
      if (new URL(connectionString).hostname.includes('ep-dawn-moon-bbwpjcrp') && environment !== 'production')
        throw new Error('The production database cannot be a QA recovery destination.');
      const result = await restoreWorkspaceBackup(backup, database, backupRestoreStorage(), {
        environment,
        allowProduction: process.env.DAYBOOK_BACKUP_ALLOW_PRODUCTION_RESTORE === 'I_HAVE_AN_EMPTY_RECOVERY_DATABASE',
      });
      console.log(
        JSON.stringify({
          ...result,
          fingerprints: result.fingerprints.map(row => ({ table: row.table, rows: row.rows })),
        }),
      );
    }
  } finally {
    await pool.end();
  }
}
