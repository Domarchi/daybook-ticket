import { put, get, del, head } from '@vercel/blob';
import { attachmentStorageConfig, readAttachmentBytes, resolvePrivateAttachmentSize, type PrivateAttachmentStorage } from './attachments-storage';
import { inboundTimeout } from './inbound-email-assets';
import { InboundRetryError } from './inbound-email-errors';

export interface InboundAttachmentStorage extends PrivateAttachmentStorage {
  write(pathname: string, bytes: Buffer, contentType: string, deadline: number): Promise<void>;
}
export async function resolveInboundPrivateFile(stream: ReadableStream<Uint8Array>, reportedSize: number, metadata: () => Promise<{ size: number }>) {
  try { return { stream, size: await resolvePrivateAttachmentSize(reportedSize, metadata) }; }
  catch (error) { await stream.cancel().catch(() => undefined); throw error; }
}
export function inboundAttachmentStorage(deadline = Date.now() + 45000): InboundAttachmentStorage {
  const config = attachmentStorageConfig();
  // The installed SDK resolves an explicit token before all ambient credentials.
  if (!config) throw new InboundRetryError('storage_unavailable');
  const store: PrivateAttachmentStorage = {
    async read(pathname) {
      const result = await get(pathname, { access: 'private', token: config.token, useCache: false, abortSignal: inboundTimeout(deadline) });
      if (result?.statusCode !== 200) return null;
      return resolveInboundPrivateFile(result.stream, result.blob.size,
        () => head(pathname, { token: config.token, abortSignal: inboundTimeout(deadline) }));
    },
    async remove(pathname) { await del(pathname, { token: config.token, abortSignal: inboundTimeout(deadline) }); },
  };
  return { ...store, async write(pathname, bytes, contentType, deadline) {
    try {
      await put(pathname, bytes, { access: 'private', token: config.token, contentType, addRandomSuffix: false,
        allowOverwrite: false, cacheControlMaxAge: 60, abortSignal: inboundTimeout(deadline, 15000) });
    } catch {
      // A timeout may have committed the object. Verify it without overwriting
      // or deleting an ambiguous successful upload.
      const existing = await readAttachmentBytes(store, pathname, bytes.length).catch(() => null);
      if (!existing || !existing.equals(bytes)) throw new InboundRetryError('storage_unavailable');
    }
  } };
}
