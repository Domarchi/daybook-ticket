import { createHash } from 'node:crypto';
import { attachmentStorageConfig } from './attachments-storage';

export const AUTOMATIC_BACKUP_MAX_BYTES = 32 * 1024 * 1024;
export const AUTOMATIC_BACKUP_LEASE_MS = 10 * 60_000;
export const AUTOMATIC_BACKUP_DEFAULTS = {
  enabled: false,
  localTime: '03:00',
  retention: 7,
  storageBudgetMiB: 512,
  version: 0,
};
export interface AutomaticBackupConfiguration {
  environment: 'qa' | 'production';
  ready: boolean;
  reason: string | null;
  key: string;
  keyId: string;
  storageBudgetMiB: number;
  monthlyTransferBudgetMiB: number;
}
export interface AutomaticBackupSettings {
  ownerId: string;
  enabled: boolean;
  localTime: string;
  retention: number;
  storageBudgetMiB: number;
  planReviewedAt: string | null;
  version: number;
  leaseToken: string | null;
  leaseUntil: string | null;
  lastErrorCode: string | null;
  updatedAt: string;
}
export interface AutomaticBackupRun {
  id: string;
  ownerId: string;
  environment: 'qa' | 'production';
  localDate: string;
  status: 'processing' | 'complete' | 'failed' | 'deleting' | 'deleted';
  attempts: number;
  keyId: string | null;
  archiveSha256: string | null;
  sizeBytes: number | null;
  reservedBytes: number;
  rowCount: number | null;
  fileCount: number | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  uploadedAt: string | null;
  verifiedAt: string | null;
  deletedAt: string | null;
}
export class AutomaticBackupError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export function automaticBackupConfiguration(
  env: Readonly<Record<string, string | undefined>> = process.env,
  now = new Date(),
): AutomaticBackupConfiguration {
  const environment = env.VERCEL_ENV === 'production' ? 'production' : 'qa';
  const key =
    env[environment === 'production' ? 'DAYBOOK_AUTOMATIC_BACKUP_KEY_PRODUCTION' : 'DAYBOOK_AUTOMATIC_BACKUP_KEY_QA'] ||
    '';
  const numeric = (name: string, maximum: number) =>
    /^\d+$/.test(env[name] || '') && Number(env[name]) >= 64 && Number(env[name]) <= maximum ? Number(env[name]) : 0;
  const storageBudgetMiB = numeric('DAYBOOK_AUTOMATIC_BACKUP_STORAGE_BUDGET_MIB', 1024);
  const monthlyTransferBudgetMiB = numeric('DAYBOOK_AUTOMATIC_BACKUP_MONTHLY_TRANSFER_BUDGET_MIB', 8192);
  const checked = Date.parse(env.DAYBOOK_AUTOMATIC_BACKUP_PLAN_CHECKED_AT || '');
  let reason: string | null = null;
  if (env.DAYBOOK_AUTOMATIC_BACKUP_ENABLED !== 'true') reason = 'operator_paused';
  else if (!attachmentStorageConfig(env) || !/^[A-Za-z0-9_-]{43,128}$/.test(key)) reason = 'configuration_missing';
  else if (
    !storageBudgetMiB ||
    !monthlyTransferBudgetMiB ||
    !Number.isFinite(checked) ||
    checked > now.getTime() ||
    now.getTime() - checked > 30 * 86400_000
  )
    reason = 'plan_check_required';
  return {
    environment,
    ready: reason === null,
    reason,
    key,
    keyId: key ? createHash('sha256').update(key).digest('hex').slice(0, 16) : '',
    storageBudgetMiB,
    monthlyTransferBudgetMiB,
  };
}
export function santiagoBackupClock(now: Date) {
  if (!Number.isFinite(now.getTime())) throw new AutomaticBackupError('invalid_clock');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (name: string) => parts.find(value => value.type === name)!.value;
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}
export function automaticBackupDue(
  settings: Pick<AutomaticBackupSettings, 'enabled' | 'localTime' | 'updatedAt'>,
  now: Date,
): string | null {
  const clock = santiagoBackupClock(now);
  // No catch-up storm: only the current local day, after its configured slot.
  // The date key also collapses duplicated wall-clock hours at the DST change.
  return settings.enabled && clock.time >= settings.localTime ? clock.date : null;
}
export function automaticBackupPath(environment: 'qa' | 'production', ownerId: string, id: string): string {
  if (!/^[a-f0-9-]{36}$/i.test(id) || !ownerId || ownerId.length > 256)
    throw new AutomaticBackupError('invalid_backup_identity');
  const owner = createHash('sha256').update(ownerId).digest('hex');
  return `daybook/${environment}/automatic-backups/${owner}/${id}.daybook`;
}
export function publicAutomaticBackupRun(run: AutomaticBackupRun) {
  return {
    id: run.id,
    localDate: run.localDate,
    status: run.status,
    attempts: run.attempts,
    sizeBytes: run.sizeBytes,
    rowCount: run.rowCount,
    fileCount: run.fileCount,
    errorCode: run.errorCode,
    createdAt: run.createdAt,
    verifiedAt: run.verifiedAt,
    deletedAt: run.deletedAt,
    downloadable: run.status === 'complete' && Boolean(run.verifiedAt) && !run.deletedAt,
  };
}
export function automaticBackupRetentionCandidates(runs: AutomaticBackupRun[], retention: number, now = new Date()) {
  const live = runs.filter(run => !run.deletedAt);
  const verified = live
    .filter(run => run.verifiedAt && ['complete', 'deleting'].includes(run.status))
    .sort((a, b) => b.verifiedAt!.localeCompare(a.verifiedAt!) || b.id.localeCompare(a.id));
  const old = verified.slice(Math.max(1, retention));
  const abandoned = live.filter(
    run =>
      !run.verifiedAt &&
      (run.status === 'deleting' ||
        (run.status === 'failed' && (run.attempts >= 3 || Date.parse(run.updatedAt) < now.getTime() - 86400_000))),
  );
  return [...old, ...abandoned];
}
