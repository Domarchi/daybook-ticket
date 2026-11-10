export interface PingerConfiguration {
  enabled: boolean;
  environment: 'qa' | 'production';
  targetOrigin: string;
  expectedTriggerId: string;
  jobSecret: string;
  automationBypassSecret?: string;
  inboundEnabled?: boolean;
  backupsEnabled?: boolean;
  serviceContextEnabled?: boolean;
  serviceContextJobSecret?: string;
  automationEnabled?: boolean;
  automationJobSecret?: string;
}
export interface PingerDependencies {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Neon edge removes client-provided X-Neon-* headers. Presence only proves
 * provenance on the native Neon host, never on localhost or a different host.
 * Equivalent boundary checks to @neon/functions parseTriggerDelivery:
 * https://neon.com/docs/compute/functions/triggers/overview#confirming-a-request-came-from-neon
 */
export function createNotificationPinger(config: PingerConfiguration, dependencies: PingerDependencies = {}) {
  const origin = new URL(config.targetOrigin);
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    !origin.hostname.endsWith('.vercel.app') ||
    !origin.hostname.startsWith('daybook-ticket')
  )
    throw new Error('Invalid target origin');
  const production = origin.hostname === 'daybook-ticket.vercel.app';
  if (production !== (config.environment === 'production') || (production && config.automationBypassSecret))
    throw new Error('Environment target mismatch');
  const validWorkerSecret = (secret: string | undefined) =>
    typeof secret === 'string' &&
    secret.length >= 32 &&
    secret.length <= 4096 &&
    secret.trim() === secret &&
    !/[\r\n]/.test(secret);
  if (
    !validWorkerSecret(config.jobSecret) ||
    !config.expectedTriggerId.trim() ||
    (config.automationBypassSecret &&
      (/[\r\n]/.test(config.automationBypassSecret) || config.automationBypassSecret.length > 4096))
  )
    throw new Error('Missing private scheduler configuration');
  if (
    (config.serviceContextEnabled && !validWorkerSecret(config.serviceContextJobSecret)) ||
    (config.automationEnabled && !validWorkerSecret(config.automationJobSecret))
  )
    throw new Error('Missing private worker configuration');
  const send = dependencies.fetch || fetch;
  return async (request: Request): Promise<Response> => {
    const privateHeaders = { 'cache-control': 'private, no-store' };
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/tick')
      return new Response('Not found', { status: 404, headers: privateHeaders });
    if (!config.enabled)
      return new Response('Disabled', { status: 503, headers: { ...privateHeaders, 'retry-after': '900' } });
    const invocationId = request.headers.get('x-neon-trigger-invocation-id')?.trim();
    if (!invocationId) return new Response('Unauthorized', { status: 401, headers: privateHeaders });
    if (!/^[a-zA-Z0-9:_-]{1,200}$/.test(invocationId))
      return new Response('Invalid invocation', { status: 400, headers: privateHeaders });
    let raw: unknown;
    try {
      // Native trigger payloads are small. Check bytes, not only the declared length.
      const reader = request.body?.getReader();
      if (!reader) throw new Error('Missing body');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 64 * 1024) {
            await reader.cancel();
            return new Response('Payload too large', { status: 413, headers: privateHeaders });
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return new Response('Invalid payload', { status: 400, headers: privateHeaders });
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      return new Response('Invalid payload', { status: 400, headers: privateHeaders });
    const body = raw as {
      version?: unknown;
      invocation_id?: unknown;
      trigger?: { type?: unknown; id?: unknown };
      data?: { scheduled_at?: unknown };
    };
    if (
      body.version !== 1 ||
      body.invocation_id !== invocationId ||
      body.trigger?.type !== 'schedule' ||
      body.trigger?.id !== config.expectedTriggerId ||
      typeof body.data?.scheduled_at !== 'string' ||
      !Number.isFinite(Date.parse(body.data.scheduled_at))
    )
      return new Response('Unauthorized', { status: 401, headers: privateHeaders });
    const invoke = async (path: string, timeout: number, secret = config.jobSecret) => {
      const headers = new Headers({ 'content-type': 'application/json', authorization: `Bearer ${secret}` });
      if (config.environment === 'qa' && config.automationBypassSecret)
        headers.set('x-vercel-protection-bypass', config.automationBypassSecret);
      try {
        const response = await send(new URL(path, origin), {
          method: 'POST',
          redirect: 'manual',
          headers,
          body: JSON.stringify({ invocationId, scheduledAt: body.data!.scheduled_at }),
          signal: AbortSignal.timeout(Math.max(1, Math.min(timeout, dependencies.timeoutMs || timeout))),
        });
        await response.body?.cancel();
        return response.ok;
      } catch {
        return false;
      }
    };
    // Each worker has its own lease/idempotency. Always run reminders first;
    // a slow archive never takes away the reminder worker's Function budget.
    const notificationOk = await invoke('/api/internal/notification-tick', 25_000);
    const inboundOk = !config.inboundEnabled || (await invoke('/api/internal/inbound-tick', 55_000));
    const serviceContextOk =
      !config.serviceContextEnabled ||
      (await invoke('/api/internal/service-context-tick', 45_000, config.serviceContextJobSecret));
    const automationOk =
      !config.automationEnabled || (await invoke('/api/internal/automation-tick', 45_000, config.automationJobSecret));
    const backupsOk = !config.backupsEnabled || (await invoke('/api/internal/backup-tick', 280_000));
    if (!notificationOk || !inboundOk || !serviceContextOk || !automationOk || !backupsOk)
      return new Response('Worker unavailable', { status: 503, headers: { ...privateHeaders, 'retry-after': '60' } });
    return Response.json({ ok: true }, { headers: privateHeaders });
  };
}
