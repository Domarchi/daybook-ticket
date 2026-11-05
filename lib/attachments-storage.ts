import { del, get, head } from '@vercel/blob';
import { MAX_ATTACHMENT_BYTES } from './attachments-validation';

export interface PrivateAttachmentStorage {
  read(pathname: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null>;
  remove(pathname: string): Promise<void>;
}
export class AttachmentSizeError extends Error {}
/** The SDK reports zero when the HTTP transfer omits Content-Length. Obtain
 * authenticated object metadata before reading; the stream is still checked
 * against this size and the database reservation by readAttachmentBytes. */
export async function resolvePrivateAttachmentSize(reported: number, metadata: () => Promise<{ size: number }>): Promise<number> {
  const size = reported === 0 ? (await metadata()).size : reported;
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_ATTACHMENT_BYTES) throw new AttachmentSizeError('Attachment size invalid.');
  return size;
}
export function attachmentStorageConfig(env: Readonly<Record<string, string | undefined>> = process.env): { environment: 'qa' | 'production'; token: string } | null {
  const environment = env.VERCEL_ENV === 'production' ? 'production' : 'qa';
  const token = environment === 'production' ? env.DAYBOOK_BLOB_PRODUCTION_READ_WRITE_TOKEN : env.DAYBOOK_BLOB_QA_READ_WRITE_TOKEN;
  // Never fall back to SDK ambient credentials, or let a preview use production.
  if (env.DAYBOOK_BLOB_ENV !== environment || !token) return null;
  // SDK emulators/endpoint overrides must never redirect a real store credential.
  if (env.VERCEL_BLOB_API_URL || env.NEXT_PUBLIC_VERCEL_BLOB_API_URL) return null;
  return { environment, token };
}
export function attachmentStorage(): PrivateAttachmentStorage {
  const config = attachmentStorageConfig();
  if (!config) throw new Error('Private attachment storage is not configured.');
  return {
    async read(pathname) {
      const result = await get(pathname, { access: 'private', token: config.token, useCache: false, abortSignal: AbortSignal.timeout(30_000) });
      if (result?.statusCode !== 200) return null;
      try {
        const size = await resolvePrivateAttachmentSize(result.blob.size, () => head(pathname, { token: config.token, abortSignal: AbortSignal.timeout(15_000) }));
        return { stream: result.stream, size };
      } catch (error) { await result.stream.cancel().catch(() => undefined); throw error; }
    },
    async remove(pathname) { await del(pathname, { token: config.token, abortSignal: AbortSignal.timeout(15_000) }); },
  };
}
export async function readAttachmentBytes(storage: PrivateAttachmentStorage, pathname: string, expectedSize: number) {
  const result = await storage.read(pathname);
  if (!result) return null;
  if (result.size !== expectedSize || result.size > MAX_ATTACHMENT_BYTES) { await result.stream.cancel(); throw new AttachmentSizeError('Attachment size mismatch.'); }
  const reader = result.stream.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > expectedSize || size > MAX_ATTACHMENT_BYTES) throw new AttachmentSizeError('Attachment size exceeded.');
      chunks.push(Buffer.from(value));
    }
    if (size !== expectedSize) throw new AttachmentSizeError('Attachment size mismatch.');
    return Buffer.concat(chunks, size);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
