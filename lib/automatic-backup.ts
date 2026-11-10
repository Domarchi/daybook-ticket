import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Database } from '../db/database';
import { publicMember, type AccessContext, type MemberRecord } from './access';
import { lockAccess } from './ticket-mutations';
import { ApiError } from './server';
import { decryptBackup, encryptBackup, sha256, type WorkspaceBackup } from './backup-format';
import { createWorkspaceBackup } from './workspace-backup';
import { automaticBackupStorage, type AutomaticBackupStorage } from './automatic-backup-storage';
import {
  AUTOMATIC_BACKUP_DEFAULTS,
  AUTOMATIC_BACKUP_LEASE_MS,
  AUTOMATIC_BACKUP_MAX_BYTES,
  AutomaticBackupError,
  automaticBackupConfiguration,
  automaticBackupDue,
  automaticBackupPath,
  automaticBackupRetentionCandidates,
  publicAutomaticBackupRun,
  type AutomaticBackupConfiguration,
  type AutomaticBackupRun,
  type AutomaticBackupSettings,
} from './automatic-backup-model';

const MIB = 1024 * 1024;
// Reserve 128 MiB of source-file reads plus 32 MiB upload and read-back.
// Reservations are conservative, remain consumed after failures/deletion, and
// are never interpreted as a provider quota or permission to increase a plan.
const TRANSFER_RESERVATION = 192 * MIB;
export interface AutomaticBackupClaim {
  access: AccessContext;
  settings: AutomaticBackupSettings;
  run: AutomaticBackupRun;
  token: string;
  cleanupOnly: boolean;
}
export interface AutomaticBackupArchive {
  keyId: string;
  archiveSha256: string;
  sizeBytes: number;
  rowCount: number;
  fileCount: number;
}
export interface AutomaticBackupJobRepository {
  saveArchive(claim: AutomaticBackupClaim, archive: AutomaticBackupArchive): Promise<boolean>;
  complete(claim: AutomaticBackupClaim): Promise<boolean>;
  fail(claim: AutomaticBackupClaim, code: string): Promise<void>;
}
export type AutomaticBackupStage =
  | 'resume_read'
  | 'source_snapshot'
  | 'encryption'
  | 'archive_metadata'
  | 'archive_upload'
  | 'archive_readback'
  | 'archive_verification'
  | 'archive_complete';
export interface AutomaticBackupDiagnostic {
  stage: AutomaticBackupStage;
  elapsedMs: number;
  stageElapsedMs: number;
  errorName: string;
  errorCode: string | null;
}
/** Only fixed class/code allowlists leave the failure boundary. No error
 * message, stack, provider response, URL, path or encryption material escapes. */
export function automaticBackupDiagnostic(
  error: unknown,
  stage: AutomaticBackupStage,
  elapsedMs: number,
  stageElapsedMs: number,
): AutomaticBackupDiagnostic {
  const names = new Set([
    'Error',
    'ApiError',
    'AutomaticBackupError',
    'TypeError',
    'RangeError',
    'SyntaxError',
    'AbortError',
    'TimeoutError',
    'AttachmentSizeError',
    'BlobError',
    'BlobAccessError',
    'BlobOidcEnvironmentNotAllowedError',
    'BlobContentTypeNotAllowedError',
    'BlobPathnameMismatchError',
    'BlobClientTokenExpiredError',
    'BlobFileTooLargeError',
    'BlobStoreNotFoundError',
    'BlobStoreSuspendedError',
    'BlobUnknownError',
    'BlobNotFoundError',
    'BlobServiceNotAvailable',
    'BlobServiceRateLimited',
    'BlobRequestAbortedError',
    'BlobPreconditionFailedError',
  ]);
  const name = error instanceof Error ? error.constructor.name : '';
  const object = error && typeof error === 'object' ? (error as { code?: unknown; cause?: { code?: unknown } }) : {};
  const candidate = object.code ?? object.cause?.code;
  const networkCodes = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'ENOTFOUND',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
    'ABORT_ERR',
  ]);
  let errorCode =
    typeof candidate === 'string' && (/^[0-9A-Z]{5}$/.test(candidate) || networkCodes.has(candidate))
      ? candidate
      : null;
  if (error instanceof ApiError) errorCode = `http_${error.status}`;
  if (error instanceof AutomaticBackupError) {
    const known = new Set([
      'configuration_missing',
      'invalid_backup_path',
      'invalid_backup_identity',
      'archive_too_large',
      'archive_size_mismatch',
      'time_budget_reached',
      'encryption_key_changed',
      'archive_verification_failed',
      'lease_lost',
      'monthly_budget_reached',
      'storage_budget_reached',
    ]);
    errorCode = known.has(error.code) ? error.code : null;
  }
  return {
    stage,
    elapsedMs: Math.max(0, Math.min(3600000, Math.floor(elapsedMs))),
    stageElapsedMs: Math.max(0, Math.min(3600000, Math.floor(stageElapsedMs))),
    errorName: names.has(name) ? name : 'UnknownError',
    errorCode,
  };
}
const ensureOwner = (access: AccessContext) => {
  if (access.role !== 'owner')
    throw new ApiError(403, 'Solo el propietario puede gestionar los respaldos automáticos.');
};
async function transactionLimits(tx: PoolClient) {
  await tx.query("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='15s'");
}
async function boundedStatement(database: Database, sql: string, values: unknown[]) {
  return database.transaction(async tx => {
    await transactionLimits(tx);
    return tx.query(sql, values);
  });
}
async function reserveTransfer(
  tx: PoolClient,
  ownerId: string,
  config: AutomaticBackupConfiguration,
  bytes: number,
  now: Date,
) {
  const month = now.toISOString().slice(0, 7);
  await tx.query(
    `INSERT INTO "automaticBackupUsage" ("ownerId",environment,month,"transferBytes") VALUES ($1,$2,$3,0) ON CONFLICT DO NOTHING`,
    [ownerId, config.environment, month],
  );
  const result = await tx.query(
    `UPDATE "automaticBackupUsage" SET "transferBytes"="transferBytes"+$4 WHERE "ownerId"=$1 AND environment=$2 AND month=$3
    AND "transferBytes"+$4<=$5 RETURNING month`,
    [ownerId, config.environment, month, bytes, config.monthlyTransferBudgetMiB * MIB],
  );
  if (result.rowCount !== 1) throw new AutomaticBackupError('monthly_budget_reached');
}
function fence(claim: AutomaticBackupClaim) {
  return [claim.access.ownerId, claim.token, claim.run.id];
}

/** Private ciphertext is downloaded again and fully decrypted before completion.
 * decryptBackup validates every table and file hash, file count and ownership.
 * This is a restoration-readiness check, never a restore into a live database. */
export function verifyAutomaticBackupArchive(
  bytes: Buffer,
  config: AutomaticBackupConfiguration,
  run: Pick<AutomaticBackupRun, 'ownerId' | 'keyId' | 'archiveSha256' | 'sizeBytes' | 'rowCount' | 'fileCount'>,
): WorkspaceBackup {
  if (run.keyId !== config.keyId) throw new AutomaticBackupError('encryption_key_changed');
  if (
    bytes.length !== run.sizeBytes ||
    bytes.length > AUTOMATIC_BACKUP_MAX_BYTES ||
    sha256(bytes) !== run.archiveSha256
  )
    throw new AutomaticBackupError('archive_verification_failed');
  let restored: WorkspaceBackup;
  try {
    restored = decryptBackup(bytes, config.key);
  } catch {
    throw new AutomaticBackupError('archive_verification_failed');
  }
  if (
    restored.ownerId !== run.ownerId ||
    restored.tables.reduce((total, table) => total + table.rows.length, 0) !== run.rowCount ||
    restored.files.length !== run.fileCount
  )
    throw new AutomaticBackupError('archive_verification_failed');
  return restored;
}

export class PgAutomaticBackupRepository implements AutomaticBackupJobRepository {
  constructor(readonly database: Database) {}
  async claim(
    access: AccessContext,
    config: AutomaticBackupConfiguration,
    now: Date,
  ): Promise<AutomaticBackupClaim | null> {
    return this.database.transaction(async tx => {
      await transactionLimits(tx);
      const fresh = await lockAccess(tx, access);
      ensureOwner(fresh);
      const settings = (
        await tx.query<AutomaticBackupSettings>(
          'SELECT * FROM "automaticBackupSettings" WHERE "ownerId"=$1 FOR UPDATE',
          [access.ownerId],
        )
      ).rows[0];
      if (!settings?.enabled) return null;
      if (!config.ready) {
        await tx.query('UPDATE "automaticBackupSettings" SET "lastErrorCode"=$2 WHERE "ownerId"=$1', [
          access.ownerId,
          config.reason,
        ]);
        return null;
      }
      if (settings.leaseUntil && Date.parse(settings.leaseUntil) > now.getTime()) return null;
      // Recover the oldest abandoned attempt before creating another date key.
      let run = (
        await tx.query<AutomaticBackupRun>(
          `SELECT * FROM "automaticBackupRuns" WHERE "ownerId"=$1 AND environment=$2
        AND status='processing' ORDER BY "createdAt",id LIMIT 1 FOR UPDATE`,
          [access.ownerId, config.environment],
        )
      ).rows[0];
      const date = automaticBackupDue(settings, now);
      if (!run && !date) return null;
      if (!run)
        run = (
          await tx.query<AutomaticBackupRun>(
            'SELECT * FROM "automaticBackupRuns" WHERE "ownerId"=$1 AND environment=$2 AND "localDate"=$3 FOR UPDATE',
            [access.ownerId, config.environment, date],
          )
        ).rows[0];
      let cleanupOnly = run?.status === 'complete' || run?.status === 'deleted';
      let maintenanceReason: string | null = null;
      if (run && !cleanupOnly && run.attempts >= 3) {
        // An invocation killed during its final attempt cannot retain a stale
        // processing state forever. Its blob remains reserved until cleanup.
        if (run.status === 'processing') {
          await tx.query(
            `UPDATE "automaticBackupRuns" SET status='failed',"errorCode"='attempts_exhausted',"updatedAt"=$2 WHERE id=$1`,
            [run.id, now.toISOString()],
          );
          run.status = 'failed';
        }
        await tx.query(
          'UPDATE "automaticBackupSettings" SET "lastErrorCode"=\'attempts_exhausted\' WHERE "ownerId"=$1',
          [access.ownerId],
        );
        cleanupOnly = true;
        maintenanceReason = 'attempts_exhausted';
      }
      if (!settings.planReviewedAt) throw new AutomaticBackupError('owner_plan_review_required');
      const storageLimit = Math.min(settings.storageBudgetMiB, config.storageBudgetMiB) * MIB;
      const physical = Number(
        (
          await tx.query(
            `SELECT COALESCE(sum("reservedBytes"),0)::text AS bytes FROM "automaticBackupRuns" WHERE "ownerId"=$1 AND environment=$2 AND "deletedAt" IS NULL`,
            [access.ownerId, config.environment],
          )
        ).rows[0]?.bytes || 0,
      );
      if (!cleanupOnly && physical + (run ? 0 : AUTOMATIC_BACKUP_MAX_BYTES) > storageLimit) {
        // Maintenance must remain possible when storage is full. Otherwise an
        // abandoned reservation or a lower retention/budget would deadlock all
        // future runs before cleanup could free their physical objects.
        cleanupOnly = true;
        maintenanceReason = 'storage_budget_reached';
        if (!run)
          run = (
            await tx.query<AutomaticBackupRun>(
              'SELECT * FROM "automaticBackupRuns" WHERE "ownerId"=$1 AND environment=$2 AND "deletedAt" IS NULL ORDER BY "createdAt" DESC,id DESC LIMIT 1 FOR UPDATE',
              [access.ownerId, config.environment],
            )
          ).rows[0];
        if (!run) throw new AutomaticBackupError('storage_budget_reached');
      }
      const token = randomUUID(),
        timestamp = now.toISOString();
      await tx.query(
        'UPDATE "automaticBackupSettings" SET "leaseToken"=$2,"leaseUntil"=$3,"lastErrorCode"=$4 WHERE "ownerId"=$1',
        [access.ownerId, token, new Date(now.getTime() + AUTOMATIC_BACKUP_LEASE_MS).toISOString(), maintenanceReason],
      );
      if (!cleanupOnly) {
        await reserveTransfer(tx, access.ownerId, config, TRANSFER_RESERVATION, now);
        if (run)
          run = (
            await tx.query<AutomaticBackupRun>(
              `UPDATE "automaticBackupRuns" SET status='processing',attempts=attempts+1,"errorCode"=NULL,"updatedAt"=$2 WHERE id=$1 RETURNING *`,
              [run.id, timestamp],
            )
          ).rows[0];
        else
          run = (
            await tx.query<AutomaticBackupRun>(
              `INSERT INTO "automaticBackupRuns" (id,"ownerId",environment,"localDate",status,attempts,"reservedBytes","createdAt","updatedAt")
          VALUES ($1,$2,$3,$4,'processing',1,$5,$6,$6) RETURNING *`,
              [randomUUID(), access.ownerId, config.environment, date, AUTOMATIC_BACKUP_MAX_BYTES, timestamp],
            )
          ).rows[0];
      }
      return { access: fresh, settings, run, token, cleanupOnly };
    });
  }
  async saveArchive(claim: AutomaticBackupClaim, archive: AutomaticBackupArchive) {
    const result = await boundedStatement(
      this.database,
      `UPDATE "automaticBackupRuns" r SET "keyId"=$4,"archiveSha256"=$5,"sizeBytes"=$6,"rowCount"=$7,"fileCount"=$8,"updatedAt"=$9
      WHERE r."ownerId"=$1 AND r.id=$3 AND r.status='processing' AND EXISTS (SELECT 1 FROM "automaticBackupSettings" s WHERE s."ownerId"=$1 AND s."leaseToken"=$2 AND s.enabled=true AND s."leaseUntil">$9)`,
      [
        ...fence(claim),
        archive.keyId,
        archive.archiveSha256,
        archive.sizeBytes,
        archive.rowCount,
        archive.fileCount,
        new Date().toISOString(),
      ],
    );
    if (result.rowCount === 1) Object.assign(claim.run, archive);
    return result.rowCount === 1;
  }
  async complete(claim: AutomaticBackupClaim) {
    const now = new Date().toISOString();
    return this.database.transaction(async tx => {
      await transactionLimits(tx);
      const locked = (
        await tx.query(
          `SELECT "ownerId" FROM "automaticBackupSettings" WHERE "ownerId"=$1 AND "leaseToken"=$2 AND enabled=true AND "leaseUntil">$3 FOR UPDATE`,
          [claim.access.ownerId, claim.token, now],
        )
      ).rowCount;
      if (locked !== 1) return false;
      const result = await tx.query(
        `UPDATE "automaticBackupRuns" SET status='complete',"reservedBytes"="sizeBytes","uploadedAt"=COALESCE("uploadedAt",$3),"verifiedAt"=$3,"updatedAt"=$3,"errorCode"=NULL
        WHERE id=$1 AND "ownerId"=$2 AND status='processing' AND "archiveSha256" IS NOT NULL AND "sizeBytes" IS NOT NULL`,
        [claim.run.id, claim.access.ownerId, now],
      );
      return result.rowCount === 1;
    });
  }
  async fail(claim: AutomaticBackupClaim, code: string) {
    await this.database.transaction(async tx => {
      await transactionLimits(tx);
      const locked = (
        await tx.query(
          'SELECT "ownerId" FROM "automaticBackupSettings" WHERE "ownerId"=$1 AND "leaseToken"=$2 FOR UPDATE',
          [claim.access.ownerId, claim.token],
        )
      ).rowCount;
      if (!locked) return;
      await tx.query(
        `UPDATE "automaticBackupRuns" SET status='failed',"errorCode"=$3,"updatedAt"=$4 WHERE id=$1 AND "ownerId"=$2 AND status='processing'`,
        [claim.run.id, claim.access.ownerId, code, new Date().toISOString()],
      );
      await tx.query('UPDATE "automaticBackupSettings" SET "lastErrorCode"=$3 WHERE "ownerId"=$1 AND "leaseToken"=$2', [
        claim.access.ownerId,
        claim.token,
        code,
      ]);
    });
  }
  async release(claim: AutomaticBackupClaim) {
    await this.database.transaction(async tx => {
      await transactionLimits(tx);
      await tx.query(
        'UPDATE "automaticBackupSettings" SET "leaseToken"=NULL,"leaseUntil"=NULL WHERE "ownerId"=$1 AND "leaseToken"=$2',
        [claim.access.ownerId, claim.token],
      );
    });
  }
  async cleanup(claim: AutomaticBackupClaim, storage: AutomaticBackupStorage, deadline: number) {
    if (Date.now() > deadline - 16_000) return;
    // Keep the newest verified backup regardless of retention or failures.
    const candidates = await this.database.transaction(async tx => {
      await transactionLimits(tx);
      const live = (
        await tx.query(
          'SELECT "ownerId" FROM "automaticBackupSettings" WHERE "ownerId"=$1 AND "leaseToken"=$2 AND enabled=true AND "leaseUntil">$3 AND version=$4 FOR UPDATE',
          [claim.access.ownerId, claim.token, new Date().toISOString(), claim.settings.version],
        )
      ).rowCount;
      if (!live) return [];
      const runs = (
        await tx.query<AutomaticBackupRun>(
          `SELECT * FROM "automaticBackupRuns" WHERE "ownerId"=$1 AND environment=$2 AND "deletedAt" IS NULL
        AND status IN ('complete','deleting','failed') ORDER BY "createdAt" DESC,id DESC FOR UPDATE`,
          [claim.access.ownerId, claim.run.environment],
        )
      ).rows;
      return automaticBackupRetentionCandidates(runs, claim.settings.retention);
    });
    for (const run of candidates.slice(0, 14)) {
      if (Date.now() > deadline - 46_000) break;
      // A durable deletion intent makes a lost response recoverable next tick.
      const marked = await boundedStatement(
        this.database,
        `UPDATE "automaticBackupRuns" r SET status='deleting',"updatedAt"=$4 WHERE r.id=$3 AND r."ownerId"=$1 AND r."deletedAt" IS NULL
        AND EXISTS (SELECT 1 FROM "automaticBackupSettings" s WHERE s."ownerId"=$1 AND s."leaseToken"=$2 AND s.enabled=true AND s."leaseUntil">$4 AND s.version=$6)
        AND ((r."verifiedAt" IS NULL AND (r.status='deleting' OR (r.status='failed' AND (r.attempts>=3 OR r."updatedAt"<$5))))
          OR EXISTS (SELECT 1 FROM "automaticBackupRuns" newer WHERE newer."ownerId"=$1 AND newer.environment=r.environment AND newer.status='complete' AND newer."verifiedAt">r."verifiedAt" AND newer."deletedAt" IS NULL))`,
        [
          claim.access.ownerId,
          claim.token,
          run.id,
          new Date().toISOString(),
          new Date(Date.now() - 86400_000).toISOString(),
          claim.settings.version,
        ],
      );
      if (marked.rowCount !== 1) continue;
      await storage.remove(automaticBackupPath(run.environment, run.ownerId, run.id), deadline);
      await boundedStatement(
        this.database,
        `UPDATE "automaticBackupRuns" SET status='deleted',"deletedAt"=$3,"updatedAt"=$3,"reservedBytes"=0 WHERE id=$1 AND "ownerId"=$2 AND status='deleting'`,
        [run.id, run.ownerId, new Date().toISOString()],
      );
    }
  }
}

/** Resumable upload + read-back verification. A crashed upload is read first on
 * retry. Never overwrite its ciphertext or mark an unchecked blob complete. */
export async function executeAutomaticBackup(
  claim: AutomaticBackupClaim,
  repository: AutomaticBackupJobRepository,
  options: {
    config: AutomaticBackupConfiguration;
    storage: AutomaticBackupStorage;
    create: () => Promise<WorkspaceBackup>;
    deadline: number;
    diagnostic?: (detail: AutomaticBackupDiagnostic) => void;
  },
) {
  const { config, storage, deadline } = options;
  const path = automaticBackupPath(config.environment, claim.access.ownerId, claim.run.id);
  let bytes: Buffer | null = null;
  const started = Date.now();
  let stage: AutomaticBackupStage = 'resume_read',
    stageStarted = started;
  const at = (value: AutomaticBackupStage) => {
    stage = value;
    stageStarted = Date.now();
  };
  const time = () => {
    if (Date.now() >= deadline - 1000) throw new AutomaticBackupError('time_budget_reached');
  };
  try {
    time();
    if (claim.run.archiveSha256) bytes = await storage.read(path, deadline);
    if (!bytes) {
      at('source_snapshot');
      time();
      const backup = await options.create();
      time();
      at('encryption');
      bytes = encryptBackup(backup, config.key);
      if (bytes.length > AUTOMATIC_BACKUP_MAX_BYTES) throw new AutomaticBackupError('archive_too_large');
      const archive = {
        keyId: config.keyId,
        archiveSha256: sha256(bytes),
        sizeBytes: bytes.length,
        rowCount: backup.tables.reduce((total, table) => total + table.rows.length, 0),
        fileCount: backup.files.length,
      };
      at('archive_metadata');
      if (!(await repository.saveArchive(claim, archive))) throw new AutomaticBackupError('lease_lost');
      at('archive_upload');
      time();
      await storage.write(path, bytes, deadline);
      bytes.fill(0);
      bytes = null;
      at('archive_readback');
      time();
      bytes = await storage.read(path, deadline);
    }
    time();
    if (!bytes) throw new AutomaticBackupError('archive_verification_failed');
    at('archive_verification');
    verifyAutomaticBackupArchive(bytes, config, claim.run);
    at('archive_complete');
    time();
    if (!(await repository.complete(claim))) throw new AutomaticBackupError('lease_lost');
    return { result: 'complete' as const, id: claim.run.id };
  } catch (error) {
    try {
      options.diagnostic?.(automaticBackupDiagnostic(error, stage, Date.now() - started, Date.now() - stageStarted));
    } catch {
      /* Diagnostics cannot alter job/lease semantics. */
    }
    const code =
      error instanceof AutomaticBackupError
        ? error.code
        : error instanceof ApiError && error.status === 413
          ? 'archive_too_large'
          : 'backup_unavailable';
    await repository.fail(claim, code);
    return { result: 'failed' as const, code };
  } finally {
    bytes?.fill(0);
  }
}

/** Called by the existing pinger's separate authenticated backup endpoint.
 * One workspace, one daily key and one fenced lease; never runs reminders. */
export async function processDueBackups(
  options: {
    database?: Database;
    now?: Date;
    configuration?: AutomaticBackupConfiguration;
    storage?: AutomaticBackupStorage;
  } = {},
) {
  const deadline = Date.now() + 270_000;
  const now = options.now || new Date(),
    config = options.configuration || automaticBackupConfiguration();
  if (!config.ready) return { result: 'paused', code: config.reason || 'configuration_missing' };
  const database = options.database || (await import('../db')).getDatabase();
  const repository = new PgAutomaticBackupRepository(database);
  const source = await database.transaction(async tx => {
    await transactionLimits(tx);
    return (
      await tx.query<MemberRecord>(`SELECT m.* FROM members m JOIN organizations o ON o.id=m."organizationId" AND o."ownerId"=m."ownerId"
      WHERE o.id='daybook' AND m.role='owner' AND m.status='active' AND m."userId" IS NOT NULL ORDER BY m.id LIMIT 1`)
    ).rows[0];
  });
  if (!source) return { result: 'skipped', code: 'owner_unavailable' };
  const access: AccessContext = {
    ownerId: source.ownerId,
    organizationId: source.organizationId,
    userId: source.userId!,
    role: 'owner',
    member: publicMember({ ...source, hasAccount: true }),
  };
  let claim: AutomaticBackupClaim | null = null;
  try {
    claim = await repository.claim(access, config, now);
    if (!claim) return { result: 'skipped', code: config.reason || 'not_due_or_leased' };
    const storage = options.storage || automaticBackupStorage();
    const workDeadline = deadline - 30_000;
    const result = claim.cleanupOnly
      ? { result: 'maintenance', id: claim.run.id }
      : await executeAutomaticBackup(claim, repository, {
          config,
          storage,
          deadline: workDeadline,
          create: () =>
            createWorkspaceBackup(claim!.access, database, undefined, {
              deadline: Math.min(workDeadline - 90_000, Date.now() + 180_000),
            }),
        });
    // Cleanup is independent of current-run success and always preserves the
    // latest known good archive. A cleanup failure never reclassifies it.
    try {
      await repository.cleanup(claim, storage, deadline);
    } catch {
      await boundedStatement(
        database,
        'UPDATE "automaticBackupSettings" SET "lastErrorCode"=\'retention_cleanup_pending\' WHERE "ownerId"=$1 AND "leaseToken"=$2',
        [access.ownerId, claim.token],
      );
    }
    return result;
  } catch (error) {
    const code = error instanceof AutomaticBackupError ? error.code : 'backup_unavailable';
    if (claim) await repository.fail(claim, code).catch(() => undefined);
    else
      await boundedStatement(
        database,
        'UPDATE "automaticBackupSettings" SET "lastErrorCode"=$2 WHERE "ownerId"=$1 AND enabled=true',
        [access.ownerId, code],
      ).catch(() => undefined);
    return { result: 'paused', code };
  } finally {
    if (claim) await repository.release(claim).catch(() => undefined);
  }
}

export async function getAutomaticBackupStatus(
  access: AccessContext,
  database: Database,
  config = automaticBackupConfiguration(),
) {
  ensureOwner(access);
  return database.transaction(async tx => {
    await transactionLimits(tx);
    ensureOwner(await lockAccess(tx, access));
    const settings = (
      await tx.query<AutomaticBackupSettings>('SELECT * FROM "automaticBackupSettings" WHERE "ownerId"=$1', [
        access.ownerId,
      ])
    ).rows[0];
    const runs = (
      await tx.query<AutomaticBackupRun>(
        'SELECT * FROM "automaticBackupRuns" WHERE "ownerId"=$1 AND environment=$2 ORDER BY "createdAt" DESC,id DESC LIMIT 30',
        [access.ownerId, config.environment],
      )
    ).rows;
    const usage = Number(
      (
        await tx.query(
          'SELECT "transferBytes"::text AS bytes FROM "automaticBackupUsage" WHERE "ownerId"=$1 AND environment=$2 AND month=$3',
          [access.ownerId, config.environment, new Date().toISOString().slice(0, 7)],
        )
      ).rows[0]?.bytes || 0,
    );
    return {
      settings: settings
        ? {
            enabled: settings.enabled,
            localTime: settings.localTime,
            retention: settings.retention,
            storageBudgetMiB: settings.storageBudgetMiB,
            version: settings.version,
            planReviewedAt: settings.planReviewedAt,
            lastErrorCode: settings.lastErrorCode,
            running: Boolean(settings.leaseUntil && Date.parse(settings.leaseUntil) > Date.now()),
          }
        : { ...AUTOMATIC_BACKUP_DEFAULTS, planReviewedAt: null, lastErrorCode: null, running: false },
      configuration: {
        ready: config.ready,
        reason: config.reason,
        environment: config.environment,
        maximumArchiveBytes: AUTOMATIC_BACKUP_MAX_BYTES,
        maximumStorageMiB: config.storageBudgetMiB,
        monthlyTransferBudgetMiB: config.monthlyTransferBudgetMiB,
        monthlyTransferUsedBytes: usage,
      },
      runs: runs.map(publicAutomaticBackupRun),
    };
  });
}

export async function saveAutomaticBackupSettings(
  access: AccessContext,
  database: Database,
  input: {
    enabled: boolean;
    localTime: string;
    retention: number;
    storageBudgetMiB: number;
    version: number;
    planConfirmed: boolean;
  },
  config = automaticBackupConfiguration(),
) {
  ensureOwner(access);
  if (
    !/^([01]\d|2[0-3]):(00|30)$/.test(input.localTime) ||
    !Number.isInteger(input.retention) ||
    input.retention < 1 ||
    input.retention > 14 ||
    !Number.isInteger(input.storageBudgetMiB) ||
    input.storageBudgetMiB < (input.retention + 1) * 32 ||
    input.storageBudgetMiB > 1024
  )
    throw new ApiError(
      400,
      'Elige una hora de media hora y presupuesto suficiente para la retención más un respaldo nuevo.',
    );
  if (input.enabled && (!config.ready || input.storageBudgetMiB > config.storageBudgetMiB || !input.planConfirmed))
    throw new ApiError(409, 'Revisa las cuotas del plan y la configuración privada antes de activar los respaldos.');
  await database.transaction(async tx => {
    await transactionLimits(tx);
    ensureOwner(await lockAccess(tx, access));
    const old = (
      await tx.query<AutomaticBackupSettings>('SELECT * FROM "automaticBackupSettings" WHERE "ownerId"=$1 FOR UPDATE', [
        access.ownerId,
      ])
    ).rows[0];
    if ((old?.version || 0) !== input.version)
      throw new ApiError(409, 'La configuración cambió. Actualiza antes de guardar.');
    const now = new Date().toISOString();
    await tx.query(
      `INSERT INTO "automaticBackupSettings" ("ownerId",enabled,"localTime",retention,"storageBudgetMiB","planReviewedAt",version,"updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT ("ownerId") DO UPDATE SET enabled=EXCLUDED.enabled,"localTime"=EXCLUDED."localTime",retention=EXCLUDED.retention,
      "storageBudgetMiB"=EXCLUDED."storageBudgetMiB","planReviewedAt"=EXCLUDED."planReviewedAt",version=EXCLUDED.version,"updatedAt"=EXCLUDED."updatedAt"`,
      [
        access.ownerId,
        input.enabled,
        input.localTime,
        input.retention,
        input.storageBudgetMiB,
        input.enabled ? now : old?.planReviewedAt || null,
        input.version + 1,
        now,
      ],
    );
  });
  return getAutomaticBackupStatus(access, database, config);
}

export async function downloadAutomaticBackup(
  access: AccessContext,
  id: string,
  database: Database,
  config = automaticBackupConfiguration(),
  storage?: AutomaticBackupStorage,
) {
  ensureOwner(access);
  if (!config.ready) throw new ApiError(503, 'El almacén privado o la clave de respaldo no están disponibles.');
  const run = await database
    .transaction(async tx => {
      await transactionLimits(tx);
      ensureOwner(await lockAccess(tx, access));
      const row = (
        await tx.query<AutomaticBackupRun>(
          'SELECT * FROM "automaticBackupRuns" WHERE id=$1 AND "ownerId"=$2 AND environment=$3 AND status=\'complete\' AND "verifiedAt" IS NOT NULL AND "deletedAt" IS NULL FOR SHARE',
          [id, access.ownerId, config.environment],
        )
      ).rows[0];
      if (!row) throw new ApiError(404, 'El respaldo no está disponible.');
      if (row.keyId !== config.keyId)
        throw new ApiError(
          409,
          'Este respaldo requiere su clave privada anterior. Conserva esa clave para recuperarlo.',
        );
      await reserveTransfer(tx, access.ownerId, config, row.sizeBytes! * 2, new Date());
      return row;
    })
    .catch(error => {
      if (error instanceof AutomaticBackupError && error.code === 'monthly_budget_reached')
        throw new ApiError(429, 'Se alcanzó el presupuesto mensual de transferencia para respaldos.');
      throw error;
    });
  const bytes = await (storage || automaticBackupStorage()).read(
    automaticBackupPath(run.environment, run.ownerId, run.id),
  );
  if (!bytes) throw new ApiError(503, 'El respaldo no está disponible temporalmente.');
  try {
    verifyAutomaticBackupArchive(bytes, config, run);
  } catch {
    bytes.fill(0);
    throw new ApiError(503, 'El respaldo no superó la comprobación de integridad.');
  }
  return { bytes, date: run.localDate };
}
