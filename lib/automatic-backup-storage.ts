import { del, get, head, put } from '@vercel/blob';
import { attachmentStorageConfig } from './attachments-storage';
import { AUTOMATIC_BACKUP_MAX_BYTES, AutomaticBackupError } from './automatic-backup-model';

export interface AutomaticBackupStorage {
  write(pathname: string, bytes: Buffer, deadline?: number): Promise<void>;
  read(pathname: string, deadline?: number): Promise<Buffer | null>;
  remove(pathname: string, deadline?: number): Promise<void>;
}
export async function readAutomaticBackupStream(stream: ReadableStream<Uint8Array>, expected: number): Promise<Buffer> {
  if (!Number.isSafeInteger(expected) || expected < 1 || expected > AUTOMATIC_BACKUP_MAX_BYTES) { await stream.cancel(); throw new AutomaticBackupError('archive_too_large'); }
  const reader = stream.getReader(), chunks: Buffer[] = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > expected || length > AUTOMATIC_BACKUP_MAX_BYTES) throw new AutomaticBackupError('archive_size_mismatch');
      chunks.push(Buffer.from(value));
    }
    if (length !== expected) throw new AutomaticBackupError('archive_size_mismatch');
    return Buffer.concat(chunks, length);
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
export function automaticBackupStorage(env: Readonly<Record<string, string | undefined>> = process.env,
  commands: Pick<typeof import('@vercel/blob'), 'put' | 'get' | 'head' | 'del'> = { put, get, head, del }): AutomaticBackupStorage {
  const config = attachmentStorageConfig(env);
  if (!config) throw new AutomaticBackupError('configuration_missing');
  const check = (path: string) => {
    if (!new RegExp(`^daybook/${config.environment}/automatic-backups/[a-f0-9]{64}/[a-f0-9-]{36}\\.daybook$`, 'i').test(path)) throw new AutomaticBackupError('invalid_backup_path');
  };
  const signal = (maximum: number, deadline?: number) => {
    const remaining = deadline === undefined ? maximum : Math.min(maximum, deadline - Date.now());
    if (remaining < 1) throw new AutomaticBackupError('time_budget_reached');
    return AbortSignal.timeout(remaining);
  };
  return {
    async write(path, bytes, deadline) {
      check(path);
      if (bytes.length < 1 || bytes.length > AUTOMATIC_BACKUP_MAX_BYTES) throw new AutomaticBackupError('archive_too_large');
      await commands.put(path, bytes, { access: 'private', token: config.token, contentType: 'application/octet-stream', addRandomSuffix: false,
        allowOverwrite: false, abortSignal: signal(30_000, deadline) });
    },
    async read(path, deadline) {
      check(path);
      const result = await commands.get(path, { access: 'private', token: config.token, useCache: false, abortSignal: signal(30_000, deadline) });
      if (result?.statusCode !== 200) return null;
      try {
        // The SDK reports zero when a chunked GET has no Content-Length. Read
        // authenticated metadata instead of treating an unknown length as zero
        // or accepting an unbounded stream. Immutable paths bind both reads.
        let size = result.blob.size;
        if (!Number.isSafeInteger(size) || size < 1) {
          const metadata = await commands.head(path, { token: config.token, abortSignal: signal(30_000, deadline) });
          if (metadata.pathname !== path) throw new AutomaticBackupError('invalid_backup_path');
          size = metadata.size;
        }
        return await readAutomaticBackupStream(result.stream, size);
      } catch (error) { await result.stream.cancel().catch(() => undefined); throw error; }
    },
    async remove(path, deadline) { check(path); await commands.del(path, { token: config.token, abortSignal: signal(15_000, deadline) }); },
  };
}
