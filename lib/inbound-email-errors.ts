export class InboundRetryError extends Error {}
export class InboundRejectError extends Error {}

export const INBOUND_ERROR_CODES = [
  'provider_unavailable',
  'storage_unavailable',
  'pending_attachment_quota',
  'processing_unavailable',
  'lease_lost',
  'invalid_json',
  'invalid_event',
  'invalid_envelope',
  'invalid_provider_id',
  'provider_response_too_large',
  'invalid_provider_json',
  'provider_mismatch',
  'headers_too_large',
  'invalid_headers',
  'invalid_text',
  'invalid_html',
  'message_too_large',
  'invalid_attachments',
  'invalid_inline_logo_url',
  'inline_logo_too_large',
  'attachment_invalid',
  'attachment_limit',
  'attachment_changed',
  'authentication_required',
  'automatic_message',
  'empty_message',
  'inactive_client',
  'sender_changed',
  'sender_mismatch',
  'hourly_limit',
  'ticket_access_revoked',
  'unknown_route',
  'ambiguous_recipient',
  'foreign_recipient',
  'expired_route',
  'invalid_route',
  'disabled',
  'conflicting_provider_id',
  'retry_exhausted',
  'manual_retry_limit',
] as const;
export function safeInboundErrorCode(value: unknown): string {
  return typeof value === 'string' && (INBOUND_ERROR_CODES as readonly string[]).includes(value)
    ? value
    : 'processing_unavailable';
}
