import type { InboundResult } from './inbound-email';
import {
  decodeInboundWebhook, inboundConfiguration, InvalidInboundEmail, normalizeInboundWebhookEvent, parseInboundRoute,
  type InboundConfiguration, type InboundEnvelope,
} from './inbound-email-validation';
import {
  InvalidDeliveryWebhook, normalizeDeliveryWebhook, readWebhookBody, verifyDeliverySignature, type DeliveryReceipt,
} from './mail-delivery-validation';

interface WebhookDependencies {
  after: (task: () => Promise<void>) => void;
  env?: Record<string, string | undefined>;
  receive?: (envelope: InboundEnvelope, config: InboundConfiguration) => Promise<InboundResult | { status: 'pending'; ownerId: string; reasonCode: null; ticketId: null; messageId: null }>;
  recordDelivery?: (receipt: DeliveryReceipt) => Promise<void>;
  dispatchNotifications?: (ownerId: string) => Promise<void>;
  drainIncoming?: (ownerId: string, providerId: string) => Promise<unknown>;
}
const headers = { 'Cache-Control': 'private, no-store' };
const accepted = () => Response.json({ received: true }, { headers });
const unavailable = () => Response.json({ error: 'Correo entrante no configurado.' }, { status: 503, headers });

/** Both routes use the same receiving path, only after verifying their own
 * configured signing secret. Callbacks let route tests avoid DB/network access. */
export function createResendWebhookHandlers(dependencies: WebhookDependencies) {
  const env = dependencies.env || process.env;
  const receive = dependencies.receive || (async (envelope, config) => {
    const [{ getDatabase }, { enqueueInboundMail }] = await Promise.all([import('../db'), import('./inbound-email-jobs')]);
    return enqueueInboundMail(getDatabase(), envelope, config);
  });
  const recordDelivery = dependencies.recordDelivery || (async receipt => {
    const [{ getDatabase }, { recordDeliveryReceipt }] = await Promise.all([import('../db'), import('./mail-delivery')]);
    await recordDeliveryReceipt(getDatabase(), receipt);
  });
  const dispatchNotifications = dependencies.dispatchNotifications || (async ownerId => {
    const [{ drainOutboxBestEffort }, { processPushOutboxBestEffort },{drainAutomationBestEffort}] = await Promise.all([import('./mail'), import('./push'),import('./automation')]);
    await Promise.allSettled([drainOutboxBestEffort(ownerId), processPushOutboxBestEffort(ownerId),drainAutomationBestEffort(ownerId)]);
  });
  const drainIncoming = dependencies.drainIncoming || (async (ownerId, providerId) => (await import('./inbound-email-jobs')).drainInboundMailBestEffort(ownerId, { providerId }));

  async function receiveVerified(raw: Buffer, webhookId: string, config: InboundConfiguration): Promise<Response | null> {
    // Decode incoming JSON once, after HMAC verification, without reserializing
    // the signed bytes. Paused/missing configuration must permit provider retry.
    const event = decodeInboundWebhook(raw);
    if (event.type !== 'email.received') return null;
    if (!config.enabled) return unavailable();
    const envelope = normalizeInboundWebhookEvent(event, webhookId);
    if (!envelope || !envelope.to.some(address => parseInboundRoute(address, config))) return accepted();
    const result = await receive(envelope, config);
    if ((result.status === 'processed' || result.status === 'pending') && result.ownerId) {
      const ownerId = result.ownerId;
      dependencies.after(async () => {
        if (result.status === 'pending') await drainIncoming(ownerId, envelope.providerId);
        await dispatchNotifications(ownerId);
      });
    }
    return accepted();
  }

  async function delivery(request: Request): Promise<Response> {
    const secret = env.RESEND_WEBHOOK_SECRET?.trim();
    if (!secret) return Response.json({ error: 'Seguimiento de correo no configurado.' }, { status: 503, headers });
    try {
      const raw = await readWebhookBody(request);
      const id = verifyDeliverySignature(raw, request.headers, secret);
      const config = inboundConfiguration(env);
      if (config.webhookMode !== 'independent') {
        const incoming = await receiveVerified(raw, id, config);
        if (incoming) return incoming;
      }
      const receipt = normalizeDeliveryWebhook(raw, id, config.environment);
      if (receipt) await recordDelivery(receipt);
      return accepted();
    } catch (error) {
      if (error instanceof InvalidDeliveryWebhook || error instanceof InvalidInboundEmail) {
        return Response.json({ error: 'Solicitud de correo no válida.' }, { status: 400, headers });
      }
      console.error('Daybook Ticket delivery receipt could not be recorded');
      return Response.json({ error: 'No se pudo registrar el aviso de entrega.' }, { status: 503, headers });
    }
  }

  async function inbound(request: Request): Promise<Response> {
    const config = inboundConfiguration(env);
    // A shared installation has one active ingress; no dual signature fallback.
    if (!config.enabled || config.webhookMode !== 'independent') return unavailable();
    try {
      const raw = await readWebhookBody(request);
      const id = verifyDeliverySignature(raw, request.headers, config.webhookSecret);
      return await receiveVerified(raw, id, config) || accepted();
    } catch (error) {
      if (error instanceof InvalidDeliveryWebhook || error instanceof InvalidInboundEmail) {
        return Response.json({ error: 'Solicitud de correo no válida.' }, { status: 400, headers });
      }
      console.error('Daybook Ticket could not process an inbound receipt');
      return Response.json({ error: 'No se pudo procesar el correo. El proveedor puede reintentar.' }, { status: 503, headers });
    }
  }

  return { delivery, inbound };
}
