import { createHash } from 'node:crypto';
import { InvalidInboundEmail, type InboundConfiguration, type ReceivedEmail } from './inbound-email-validation';
import { boundedInboundBytes, inboundAssetUrl, inboundTimeout } from './inbound-email-assets';

// The existing public Daybook mark embedded in the outbound CID email template.
export const DAYBOOK_MAIL_LOGO_BYTES = 5181;
export const DAYBOOK_MAIL_LOGO_SHA256 = 'f3588e8c217aada515a03784015ce3248a14c05c77d139f01b619af901939187';

async function bounded(response: Response, maximum: number): Promise<Buffer> {
  if (!response.ok || !response.body) throw new Error('Inbound attachment provider unavailable');
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) throw new InvalidInboundEmail('inline_logo_too_large');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > maximum) { await reader.cancel(); throw new InvalidInboundEmail('inline_logo_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}

/** Email clients can quote our original CID logo in a plain text reply. Only
 * that exact public asset may be omitted. A matching name, MIME or size alone
 * never authorizes dropping a user's file. All other files require the portal. */
export async function withoutQuotedDaybookLogos(email: ReceivedEmail, config: InboundConfiguration, fetcher: typeof fetch = fetch, deadline = Date.now() + 45000): Promise<ReceivedEmail> {
  if (!email.authenticated || !email.attachments.length || email.attachments.length > 10
    || !/^[a-f0-9-]{36}$/i.test(email.id)
    || email.attachments.some(file => !/^[a-f0-9-]{36}$/i.test(file.id))) return email;
  const retained = [];
  for (const file of email.attachments) {
    if (file.contentType !== 'image/png' || file.size !== DAYBOOK_MAIL_LOGO_BYTES || file.disposition !== 'inline') { retained.push(file); continue; }
    const metadataResponse = await fetcher(`https://api.resend.com/emails/receiving/${email.id}/attachments/${file.id}`, {
      headers: { Authorization: `Bearer ${config.apiKey}` }, cache: 'no-store', redirect: 'error', signal: inboundTimeout(deadline),
    });
    let metadata;
    try { metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bounded(metadataResponse, 32 * 1024))); }
    catch (error) { if (error instanceof InvalidInboundEmail) throw error; throw new Error('Inbound attachment metadata unavailable'); }
    if (metadata?.id !== file.id || metadata.filename !== file.name || metadata.size !== DAYBOOK_MAIL_LOGO_BYTES
      || metadata.content_type !== 'image/png' || metadata.content_disposition !== 'inline') { retained.push(file); continue; }
    const url = inboundAssetUrl(metadata.download_url, email.id, file.id);
    const bytes = await boundedInboundBytes(await fetcher(url.toString(), { cache: 'no-store', redirect: 'error', signal: inboundTimeout(deadline) }), DAYBOOK_MAIL_LOGO_BYTES);
    if (bytes.length !== DAYBOOK_MAIL_LOGO_BYTES || createHash('sha256').update(bytes).digest('hex') !== DAYBOOK_MAIL_LOGO_SHA256) retained.push(file);
  }
  return { ...email, attachments: retained };
}
