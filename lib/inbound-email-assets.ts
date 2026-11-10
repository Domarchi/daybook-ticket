import { InvalidInboundEmail } from './inbound-email-validation';
import { InboundRetryError } from './inbound-email-errors';

export function inboundAssetUrl(value: unknown, emailId: string, attachmentId: string): URL {
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    throw new InvalidInboundEmail('invalid_inline_logo_url');
  }
  const documented =
    url.hostname === 'inbound-cdn.resend.com' && url.pathname === `/${emailId}/attachments/${attachmentId}`;
  const receiving =
    url.hostname === 'cdn.resend.app' && url.pathname === `/receiving/${emailId}/attachments/${attachmentId}`;
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || (!documented && !receiving))
    throw new InvalidInboundEmail('invalid_inline_logo_url');
  return url;
}

export async function boundedInboundBytes(response: Response, maximum: number): Promise<Buffer> {
  if (!response.ok || !response.body) throw new InboundRetryError('provider_unavailable');
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum))
    throw new InvalidInboundEmail('inline_logo_too_large');
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel();
        throw new InvalidInboundEmail('inline_logo_too_large');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, total);
  } finally {
    reader.releaseLock();
  }
}

export function inboundTimeout(deadline: number, maximum = 10000): AbortSignal {
  const remaining = Math.min(maximum, deadline - Date.now());
  if (remaining < 250) throw new InboundRetryError('provider_unavailable');
  return AbortSignal.timeout(remaining);
}
