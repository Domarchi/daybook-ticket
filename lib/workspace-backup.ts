import { randomUUID } from 'node:crypto';
import { put } from '@vercel/blob';
import type { PoolClient } from 'pg';
import { type AccessContext } from './access';
import { db, ApiError } from './server';
import type { Database } from '../db/database';
import { lockAccess } from './ticket-mutations';
import { attachmentStorage, attachmentStorageConfig, readAttachmentBytes, type PrivateAttachmentStorage } from './attachments-storage';
import { BACKUP_TABLES, compatibleBackupColumns, canonicalBackupRows, MAX_BACKUP_BYTES, sha256, validateBackup, type BackupRow, type WorkspaceBackup } from './backup-format';
import { validateAttachment } from './attachments-validation';

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const qualified = (schema: string, table: string) => `${quote(schema)}.${quote(table)}`;
const temporaryAccountColumns = ['accessToken', 'refreshToken', 'idToken', 'accessTokenExpiresAt', 'refreshTokenExpiresAt'];
async function columns(tx: PoolClient, table: string, schema = 'public'): Promise<string[]> {
  return (await tx.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position', [schema, table])).rows.map(row => row.column_name);
}
async function selectColumns(tx: PoolClient, table: string, schema = 'public', excludeTemporaryCredentials = false) {
  const metadata = (await tx.query('SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position', [schema, table])).rows;
  // Avoid pg's Date parser truncating timestamp microseconds during an exact recovery.
  return metadata.map(row => excludeTemporaryCredentials && table === 'authAccount' && temporaryAccountColumns.includes(row.column_name)
    ? `NULL AS ${quote(row.column_name)}`
    : /^timestamp/.test(row.data_type) ? `${quote(row.column_name)}::text AS ${quote(row.column_name)}` : quote(row.column_name)).join(',');
}

/** One consistent DB snapshot. Uploaded drafts, sessions and reset/device credentials are not portable logins. */
export async function createWorkspaceBackup(access: AccessContext, database = db(), storage?: PrivateAttachmentStorage, options: { deadline?: number } = {}): Promise<WorkspaceBackup> {
  if (access.role !== 'owner') throw new ApiError(403, 'Solo el propietario puede exportar el respaldo completo.');
  return database.transaction(async tx => {
    let deadline = options.deadline ?? Number.POSITIVE_INFINITY;
    // Automatic jobs have a shorter total budget. Clamp every SQL statement to
    // its remaining time; a slow query cannot start a fresh ninety-second wait.
    const query = async (sql: string, values?: unknown[]) => {
      if (options.deadline === undefined) return tx.query(sql, values);
      const remaining = deadline - Date.now();
      if (remaining < 1) throw new ApiError(503, 'El respaldo agotó su tiempo disponible. Se puede reintentar sin modificar los datos.');
      if (options.deadline !== undefined) await tx.query("SELECT set_config('statement_timeout',$1,true)", [`${Math.min(90000, remaining)}ms`]);
      return tx.query(sql, values);
    };
    const reader = { query } as PoolClient;
    // Acquire the current owner before creating a repeatable snapshot. A concurrent revocation waits for this export.
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await tx.query("SET LOCAL TIME ZONE 'UTC'; SET LOCAL DateStyle='ISO,YMD'");
    const reserved = (await tx.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked", [`daybook-backup:${access.ownerId}`])).rows[0]?.locked;
    if (!reserved) throw new ApiError(409, 'Ya se está preparando un respaldo de este espacio.');
    const fresh = await lockAccess(reader, access);
    if (fresh.role !== 'owner') throw new ApiError(403, 'Solo el propietario puede exportar el respaldo completo.');
    await tx.query("SET LOCAL statement_timeout='90s'");
    const backup: WorkspaceBackup = { format: 'daybook.workspace.v1', createdAt: new Date().toISOString(), ownerId: access.ownerId, organizationId: access.organizationId, tables: [], files: [], omissions: ['Active sessions, password reset tokens and rate limits require a fresh sign-in after recovery.', 'Invitation tokens and OAuth bearer tokens are excluded. Invited members remain; issue new invitations after recovery.', 'Unsent draft attachments are temporary and are excluded. Environment variables and provider keys are never included.'] };
    let bytes = 0, rowsCount = 0;
    if (options.deadline === undefined) deadline = Date.now() + 210000;
    for (const table of BACKUP_TABLES) {
      const tableColumns = await columns(reader, table);
      if (!tableColumns.length) throw new ApiError(503, 'Aplica la migración de esta versión antes de crear respaldos.');
      let where = '"ownerId"=$1';
      if (table === 'authUser') where = 'id IN (SELECT "userId" FROM members WHERE "ownerId"=$1 AND "userId" IS NOT NULL)';
      else if (['authAccount','twoFactor','securityProfiles','userPreferences'].includes(table)) where = '"userId" IN (SELECT "userId" FROM members WHERE "ownerId"=$1 AND "userId" IS NOT NULL)';
      else if (table === 'attachments') where += " AND status='attached'";
      else if (table === 'invitations' || table === 'ticketPresence') where += ' AND FALSE';
      else if (table === 'inboundMailJobFiles') where = '"providerId" IN (SELECT "providerId" FROM "inboundMailJobs" WHERE "ownerId"=$1) AND "attachmentId" IN (SELECT id FROM attachments WHERE "ownerId"=$1 AND status=\'attached\')';
      // Omit temporary credentials in SQL, before they can enter the Function or its byte totals.
      const selection = `SELECT ${await selectColumns(reader, table, 'public', true)} FROM ${quote(table)} WHERE ${where} LIMIT 100001`;
      // Count bytes inside the same snapshot before pg materializes private rows.
      // LIMIT bounds this aggregate too; only two totals leave PostgreSQL.
      const total = (await query(`SELECT count(*)::text AS rows, COALESCE(sum(octet_length(row_to_json(source)::text)),0)::text AS bytes FROM (${selection}) source`, [access.ownerId])).rows[0];
      const tableRows = Number(total?.rows), tableBytes = Number(total?.bytes);
      if (!Number.isSafeInteger(tableRows) || tableRows < 0 || !Number.isSafeInteger(tableBytes) || tableBytes < 0
        || rowsCount + tableRows > 100000 || bytes + tableBytes > 24 * 1024 * 1024) throw new ApiError(413, 'El espacio supera el límite de esta exportación. Usa el procedimiento operativo de respaldo de base y archivos.');
      const result = await query(selection, [access.ownerId]);
      const rows = JSON.parse(JSON.stringify(result.rows)) as BackupRow[]; // pg timestamps become portable ISO strings.
      rowsCount += rows.length;
      const encoded = canonicalBackupRows(rows); bytes += Buffer.byteLength(encoded);
      if (rowsCount > 100000 || bytes > 24 * 1024 * 1024) throw new ApiError(413, 'El espacio supera el límite de esta exportación. Usa el procedimiento operativo de respaldo de base y archivos.');
      backup.tables.push({ name: table, columns: tableColumns, rows, sha256: sha256(encoded) });
    }
    const sent = backup.tables.find(table => table.name === 'attachments')!.rows;
    if (sent.length) {
      const store = storage ?? attachmentStorage();
      for (const row of sent) {
        if (Date.now() >= deadline) throw new ApiError(503, 'El respaldo necesita más tiempo. Usa el procedimiento operativo para este volumen.');
        const content = await readAttachmentBytes(store, String(row.pathname), Number(row.size));
        if (!content) throw new ApiError(503, 'Falta un archivo protegido. El respaldo no se marcará como completo.');
        const base64 = content.toString('base64'); bytes += base64.length;
        if (bytes > MAX_BACKUP_BYTES - 1024 * 1024) throw new ApiError(413, 'El respaldo supera 128 MiB. Usa el procedimiento operativo de respaldo de base y archivos.');
        backup.files.push({ attachmentId: String(row.id), size: content.length, sha256: sha256(content), base64 });
      }
    }
    return validateBackup(backup);
  });
}

export interface BackupRestoreStorage extends PrivateAttachmentStorage { environment: 'qa' | 'production'; write(pathname: string, bytes: Buffer, contentType: string): Promise<void> }
export function backupRestoreStorage(): BackupRestoreStorage {
  const config = attachmentStorageConfig();
  if (!config) throw new Error('Configure the isolated destination private storage.');
  return { ...attachmentStorage(), environment: config.environment, async write(pathname, bytes, contentType) {
    await put(pathname, bytes, { access: 'private', token: config.token, contentType, addRandomSuffix: false, allowOverwrite: false, abortSignal: AbortSignal.timeout(30000) });
  } };
}

/** Operator-only recovery into EMPTY, already-migrated tables. Never deletes/replaces existing data. */
export async function restoreWorkspaceBackup(input: WorkspaceBackup, database: Database, storage: BackupRestoreStorage, options: { environment: 'qa' | 'production'; schema?: string; allowProduction?: boolean }) {
  const backup = validateBackup(input), schema = options.schema || 'public';
  if (storage.environment !== options.environment) throw new Error('Destination storage environment mismatch.');
  if (schema !== 'public' && (!/^daybook_restore_qa_[a-f0-9]{16}$/.test(schema) || options.environment !== 'qa')) throw new Error('Invalid isolated recovery schema.');
  if (options.environment === 'production' && !options.allowProduction) throw new Error('Production recovery requires a separate operator confirmation.');
  const written: string[] = [], attachmentPaths = new Map<string, string>();
  let readyToCommit = false;
  try {
    return await database.transaction(async tx => {
      await tx.query("SET LOCAL TIME ZONE 'UTC'; SET LOCAL DateStyle='ISO,YMD'");
      await tx.query("SET LOCAL statement_timeout='90s'");
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('daybook-workspace-restore',0))");
      // Lock all target tables before verifying emptiness. Existing customers are never overwritten.
      const locked = [...BACKUP_TABLES, ...(schema === 'public' ? ['authSession', 'authVerification', 'authRateLimit','securityAssurances'] : [])];
      await tx.query(`LOCK TABLE ${locked.map(table => qualified(schema, table)).join(',')} IN ACCESS EXCLUSIVE MODE`);
      for (const table of BACKUP_TABLES) {
        if (Number((await tx.query(`SELECT count(*)::int AS n FROM ${qualified(schema, table)}`)).rows[0].n) !== 0) throw new Error('Recovery requires an empty destination. No existing data was changed.');
        const source = backup.tables.find(item => item.name === table);
        if (!source) continue; // A verified v1 archive predates the additive reliability tables.
        const target = await columns(tx, table, schema);
        if (!compatibleBackupColumns(table,target,source.columns)) throw new Error(`Schema version mismatch: ${table}`);
      }
      if (schema === 'public') for (const table of ['authSession', 'authVerification', 'authRateLimit','securityAssurances']) {
        if (Number((await tx.query(`SELECT count(*)::int AS n FROM ${qualified(schema, table)}`)).rows[0].n) !== 0) throw new Error('Recovery requires empty temporary authentication tables.');
      }
      for (const file of backup.files) {
        const row = backup.tables.find(table => table.name === 'attachments')!.rows.find(row => row.id === file.attachmentId)!;
        const pathname = `daybook/${options.environment}/restore/${randomUUID()}/${file.attachmentId}.bin`;
        const content = Buffer.from(file.base64, 'base64');
        const validated = await validateAttachment(content, String(row.name), file.size);
        if (validated.contentType !== row.contentType) throw new Error('Restored attachment type mismatch.');
        written.push(pathname);
        await storage.write(pathname, content, validated.contentType);
        attachmentPaths.set(file.attachmentId, pathname);
        const restored = await readAttachmentBytes(storage, pathname, file.size);
        if (!restored || sha256(restored) !== file.sha256) throw new Error('Restored attachment checksum mismatch.');
      }
      const fingerprints: { table: string; rows: number; sha256: string }[] = [];
      for (const table of BACKUP_TABLES) {
        const source = backup.tables.find(item => item.name === table);
        if (!source) continue;
        for (const original of source.rows) {
          const row = table === 'attachments' ? { ...original, pathname: attachmentPaths.get(String(original.id))! } : original;
          await tx.query(`INSERT INTO ${qualified(schema, table)} (${source.columns.map(quote).join(',')}) VALUES (${source.columns.map((_, i) => `$${i + 1}`).join(',')})`, source.columns.map(column => row[column]));
        }
        const restored = JSON.parse(JSON.stringify((await tx.query(`SELECT ${await selectColumns(tx, table, schema)} FROM ${qualified(schema, table)}`)).rows)) as BackupRow[];
        // File bytes are copied to new private paths; compare the original metadata after reversing that intentional mapping.
        if (table === 'attachments') for (const row of restored) row.pathname = source.rows.find(original => original.id === row.id)!.pathname;
        const fingerprint = sha256(canonicalBackupRows(restored.map(row => Object.fromEntries(source.columns.map(column => [column, row[column]])))));
        if (fingerprint !== source.sha256) throw new Error(`Recovery checksum mismatch: ${table}`);
        fingerprints.push({ table, rows: restored.length, sha256: fingerprint });
      }
      if(backup.tables.some(table=>table.name==='serviceContextNotificationSettings')){
        await tx.query(`UPDATE ${qualified(schema,'serviceContextNotificationSettings')} SET enabled=false,"activatedAt"=NULL`);
        await tx.query(`UPDATE ${qualified(schema,'serviceContextJobHealth')} SET "leaseToken"=NULL,"leaseUntil"=NULL,"cursorKey"='',"lastErrorCode"='restore_paused'`);
      }
      // Older v1 archives may contain these credentials. Verify their original fingerprints first,
      // then invalidate them before COMMIT; password hashes and account/provider identities stay intact.
      await tx.query(`DELETE FROM ${qualified(schema, 'invitations')}`);
      // Verify archived fingerprints first; commercial delivery and admission must be re-approved after recovery.
      await tx.query(`UPDATE ${qualified(schema,'workspaceProfiles')} SET state='draft',\"mailEnabled\"=false,\"inboundEnabled\"=false,\"lastJobAt\"=NULL`);
      await tx.query(`UPDATE ${qualified(schema, 'authAccount')} SET ${temporaryAccountColumns.map(column => `${quote(column)}=NULL`).join(',')}`);
      await tx.query(`UPDATE ${qualified(schema, 'automaticBackupSettings')} SET enabled=false,"leaseToken"=NULL,"leaseUntil"=NULL,"lastErrorCode"='restore_paused'`);
      await tx.query(`UPDATE ${qualified(schema, 'automaticBackupRuns')} SET status='deleted',"deletedAt"=COALESCE("deletedAt",$1),"reservedBytes"=0,"errorCode"='restore_nonportable'`,[new Date().toISOString()]);
      await tx.query(`DELETE FROM ${qualified(schema, 'ticketPresence')}`);
      await tx.query(`UPDATE ${qualified(schema, 'inboundMailJobs')} SET status='failed',attempts=6,"lastErrorCode"='restore_paused',"leaseToken"=NULL,"leaseUntil"=NULL,"nextAttemptAt"=NULL WHERE status IN ('pending','processing','retry')`);
      // Recovered work stays paused until the owner checks accounts/files and explicitly enables integrations.
      await tx.query(`UPDATE ${qualified(schema, 'notificationSettings')} SET "remindersEnabled"=false`);
      await tx.query(`UPDATE ${qualified(schema, 'escalationSettings')} SET enabled=false`);
      await tx.query(`UPDATE ${qualified(schema, 'pushSubscriptions')} SET active=false`);
      await tx.query(`UPDATE ${qualified(schema, 'notificationJobHealth')} SET "leaseToken"=NULL,"leaseUntil"=NULL`);
      await tx.query(`UPDATE ${qualified(schema, 'assignmentRules')} SET enabled=false`);
      // E4 tables are registered by the stacked release. Old archives restore into
      // that same empty current schema; never replay their pending rule events.
      if ((BACKUP_TABLES as readonly string[]).includes('automationSettings')) {
        const pausedAt = new Date().toISOString();
        await tx.query(`UPDATE ${qualified(schema, 'automationSettings')} SET enabled=false,"activatedAt"=NULL,version=version+1,"updatedAt"=$1`, [pausedAt]);
        await tx.query(`UPDATE ${qualified(schema, 'automationEvents')} SET status='cancelled',"lastErrorCode"='restore_paused',"updatedAt"=$1 WHERE status='queued'`, [pausedAt]);
        // The worker holds a transaction rather than a portable lease. A stale
        // start marker is cleared while keeping execution history and counts.
        await tx.query(`UPDATE ${qualified(schema, 'automationJobHealth')} SET "lastStartedAt"=NULL,"lastErrorCode"='restore_paused',"updatedAt"=$1`, [pausedAt]);
      }
      await tx.query(`UPDATE ${qualified(schema, 'mailOutbox')} SET status=CASE WHEN status='processing' THEN 'unknown' ELSE 'cancelled' END,"lastErrorCode"=CASE WHEN status='processing' THEN 'restore_uncertain' ELSE 'restore_paused' END,"leaseUntil"=NULL,"nextAttemptAt"=NULL WHERE status IN ('queued','awaiting_configuration','processing')`);
      await tx.query(`UPDATE ${qualified(schema, 'pushDeliveries')} SET status='cancelled',"lastErrorCode"='restore_paused',"leaseUntil"=NULL WHERE status IN ('queued','processing')`);
      if (schema === 'public') for (const table of ['tickets', 'messages', 'articles']) {
        const relation = `${schema}.${quote(table)}`;
        await tx.query(`SELECT setval(pg_get_serial_sequence($1,'id'),GREATEST(COALESCE((SELECT max(id) FROM ${qualified(schema, table)}),0),1),(SELECT count(*)>0 FROM ${qualified(schema, table)}))`, [relation]);
      }
      readyToCommit = true;
      return { restored: true, fingerprints, files: backup.files.length, sessionsRestored: false, temporaryCredentialsRestored: false, integrationsPaused: true, attachmentPathsChanged: true };
    });
  } catch (error) {
    // A lost COMMIT response is uncertain: keep private objects for operator review.
    // Never remove files that a committed database may already reference.
    if (!readyToCommit) for (const pathname of written) await storage.remove(pathname).catch(() => undefined);
    throw error;
  }
}
