import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

export const BACKUP_MAGIC = Buffer.from('DAYBOOK1\n');
export const MAX_BACKUP_BYTES = 128 * 1024 * 1024;
export const LEGACY_BACKUP_TABLES = ['authUser', 'authAccount', 'organizations', 'customerCompanies', 'members', 'tickets', 'messages', 'articles', 'settings', 'demoImports', 'savedReplies', 'operations', 'attachments', 'ticketEvents', 'servicePolicies', 'assignmentRules', 'agentAvailability', 'ticketSlaOutcomes', 'notificationSettings', 'reminderOccurrences', 'escalationSettings', 'escalationOccurrences', 'ticketSatisfaction', 'inboundMailReceipts', 'mailOutbox', 'mailDeliveryEvents', 'pushSubscriptions', 'pushDeliveries', 'invitations', 'notificationJobHealth'] as const;
export const RELIABILITY_BACKUP_TABLES = [...LEGACY_BACKUP_TABLES, 'inboundMailJobs', 'inboundMailJobFiles', 'ticketPresence', 'automaticBackupSettings', 'automaticBackupRuns', 'automaticBackupUsage'] as const;
export const SERVICE_CONTEXT_BACKUP_TABLES = ['companyProfiles','companySites','customerServices','customerAssets','serviceContracts','ticketServiceContext','ticketAssetLinks','ticketContractLinks','serviceContextEvents','serviceContextNotificationSettings','serviceContextReminders','serviceContextJobHealth'] as const;
type BackupTableName=typeof RELIABILITY_BACKUP_TABLES[number]|typeof SERVICE_CONTEXT_BACKUP_TABLES[number];
const orderedBackupTables:BackupTableName[]=[];
for(const table of RELIABILITY_BACKUP_TABLES) {
  // Referenced contract and occurrence rows must be restored before file/outbox FKs.
  if(table==='attachments') orderedBackupTables.push(...SERVICE_CONTEXT_BACKUP_TABLES.slice(0,9));
  if(table==='mailOutbox') orderedBackupTables.push(...SERVICE_CONTEXT_BACKUP_TABLES.slice(9));
  orderedBackupTables.push(table);
}
export const BACKUP_TABLES:readonly BackupTableName[]=orderedBackupTables;
export const BACKUP_TABLE_PROFILES=[LEGACY_BACKUP_TABLES,RELIABILITY_BACKUP_TABLES,BACKUP_TABLES] as const;
export type BackupTable = typeof BACKUP_TABLES[number];
export type BackupRow = Record<string, string | number | boolean | null>;
export interface WorkspaceBackup {
  format: 'daybook.workspace.v1'; createdAt: string; ownerId: string; organizationId: string;
  tables: { name: BackupTable; columns: string[]; rows: BackupRow[]; sha256: string }[];
  files: { attachmentId: string; size: number; sha256: string; base64: string }[];
  omissions: string[];
}
export const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export function canonicalBackupRows(rows: BackupRow[]) {
  return rows.map(row => JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])))).sort().join('\n');
}
export function backupPassword(value: string) {
  if (typeof value !== 'string' || value.length < 16 || value.length > 256) throw new Error('Usa una clave de respaldo de entre 16 y 256 caracteres.');
  return value;
}
export function encryptBackup(backup: WorkspaceBackup, password: string): Buffer {
  backupPassword(password);
  const json = Buffer.from(JSON.stringify(backup));
  if (json.length > MAX_BACKUP_BYTES) throw new Error('El respaldo supera el límite de 128 MiB. Usa una copia operativa de base y almacenamiento.');
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = scryptSync(password, salt, 32, { N: 32768, maxmem: 128 * 1024 * 1024 });
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(BACKUP_MAGIC);
    const encrypted = Buffer.concat([cipher.update(gzipSync(json)), cipher.final()]);
    return Buffer.concat([BACKUP_MAGIC, salt, iv, cipher.getAuthTag(), encrypted]);
  } finally { key.fill(0); json.fill(0); }
}
export function decryptBackup(bytes: Buffer, password: string): WorkspaceBackup {
  backupPassword(password);
  const start = BACKUP_MAGIC.length;
  if (bytes.length < start + 45 || bytes.length > MAX_BACKUP_BYTES || !bytes.subarray(0, start).equals(BACKUP_MAGIC)) throw new Error('El archivo no es un respaldo Daybook válido.');
  const key = scryptSync(password, bytes.subarray(start, start + 16), 32, { N: 32768, maxmem: 128 * 1024 * 1024 });
  let plain: Buffer | undefined;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(start + 16, start + 28));
    decipher.setAAD(BACKUP_MAGIC); decipher.setAuthTag(bytes.subarray(start + 28, start + 44));
    const compressed = Buffer.concat([decipher.update(bytes.subarray(start + 44)), decipher.final()]);
    try { plain = gunzipSync(compressed, { maxOutputLength: MAX_BACKUP_BYTES }); } finally { compressed.fill(0); }
    const parsed: unknown = JSON.parse(plain.toString('utf8'));
    return validateBackup(parsed);
  } catch { throw new Error('La clave no coincide o el respaldo está dañado. No se modificaron datos.'); }
  finally { key.fill(0); plain?.fill(0); }
}

export function validateBackup(input: unknown): WorkspaceBackup {
  if (!input || typeof input !== 'object') throw new Error('Invalid backup');
  const data = input as WorkspaceBackup;
  if (data.format !== 'daybook.workspace.v1' || typeof data.ownerId !== 'string' || !data.ownerId || data.ownerId.length > 256 || typeof data.organizationId !== 'string' || !data.organizationId || data.organizationId.length > 256 || !Array.isArray(data.tables) || !Array.isArray(data.files) || !Array.isArray(data.omissions) || data.omissions.some(value => typeof value !== 'string') || !BACKUP_TABLE_PROFILES.some(profile=>profile.length===data.tables.length) || typeof data.createdAt !== 'string' || !Number.isFinite(Date.parse(data.createdAt))) throw new Error('Invalid backup manifest');
  const names = new Set<string>();
  let rows = 0, bytes = 0;
  for (const table of data.tables) {
    if (!BACKUP_TABLES.includes(table.name) || names.has(table.name) || !Array.isArray(table.rows) || !Array.isArray(table.columns) || table.columns.some(column => typeof column !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(column)) || new Set(table.columns).size !== table.columns.length) throw new Error('Invalid backup table');
    names.add(table.name);
    rows += table.rows.length;
    if (rows > 100000) throw new Error('Backup row limit exceeded');
    for (const row of table.rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== table.columns.length || Object.keys(row).some(key => !table.columns.includes(key)) || Object.values(row).some(value => (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) || (typeof value === 'number' && !Number.isFinite(value)))) throw new Error('Invalid backup row');
      if ('ownerId' in row && row.ownerId !== data.ownerId) throw new Error('Backup workspace mismatch');
    }
    const canonical = canonicalBackupRows(table.rows); bytes += Buffer.byteLength(canonical);
    if (bytes > 24 * 1024 * 1024) throw new Error('Backup data limit exceeded');
    if (sha256(canonical) !== table.sha256) throw new Error('Backup table checksum mismatch');
  }
  const required = BACKUP_TABLE_PROFILES.find(profile=>profile.length===names.size && profile.every(name=>names.has(name)));
  if (!required) throw new Error('Backup is missing required tables');
  const attachments = new Map(data.tables.find(table => table.name === 'attachments')!.rows.map(row => [row.id, row]));
  const files = new Set<string>();
  for (const file of data.files) {
    if (!file || typeof file.base64 !== 'string' || file.base64.length > Math.ceil(10 * 1024 * 1024 / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64) || !Number.isInteger(file.size) || file.size < 1 || file.size > 10 * 1024 * 1024 || files.has(file.attachmentId)) throw new Error('Invalid backup file');
    bytes += file.base64.length;
    if (bytes > MAX_BACKUP_BYTES - 1024 * 1024) throw new Error('Backup total limit exceeded');
    const row = attachments.get(file.attachmentId), content = Buffer.from(file.base64, 'base64');
    if (!row || row.status !== 'attached' || row.size !== file.size || content.length !== file.size || sha256(content) !== file.sha256) throw new Error('Backup file checksum mismatch');
    files.add(file.attachmentId);
  }
  if (files.size !== attachments.size) throw new Error('Backup is missing private attachments');
  return data;
}
