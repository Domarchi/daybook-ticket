import { after } from 'next/server';
import { inboundConfiguration, InvalidInboundEmail, normalizeInboundWebhook, parseInboundRoute } from '@/lib/inbound-email-validation';
import { InvalidDeliveryWebhook, readWebhookBody, verifyDeliverySignature } from '@/lib/mail-delivery-validation';

export const runtime = 'nodejs';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store' };

export async function POST(request: Request) {
  const config = inboundConfiguration();
  // Disabled / invalid requests never import or query the database.
  if (!config.enabled) return Response.json({ error: 'Correo entrante no configurado.' }, { status: 503, headers });
  try {
    const raw = await readWebhookBody(request);
    const webhookId = verifyDeliverySignature(raw, request.headers, config.webhookSecret);
    const envelope = normalizeInboundWebhook(raw, webhookId);
    if (!envelope || !envelope.to.some(address => parseInboundRoute(address, config))) return Response.json({ received: true }, { headers });
    const [{ getDatabase }, { receiveInboundEmail }] = await Promise.all([import('@/db'), import('@/lib/inbound-email')]);
    const result = await receiveInboundEmail(getDatabase(), envelope, { config });
    if (result.status === 'processed' && result.ownerId) {
      after(async () => {
        const [{ drainOutboxBestEffort }, { processPushOutboxBestEffort }] = await Promise.all([import('@/lib/mail'), import('@/lib/push')]);
        await Promise.allSettled([drainOutboxBestEffort(result.ownerId!), processPushOutboxBestEffort(result.ownerId!)]);
      });
    }
    return Response.json({ received: true }, { headers });
  } catch (error) {
    if (error instanceof InvalidDeliveryWebhook || error instanceof InvalidInboundEmail) {
      return Response.json({ error: 'Solicitud de correo no válida.' }, { status: 400, headers });
    }
    console.error('Daybook Ticket could not process an inbound receipt');
    return Response.json({ error: 'No se pudo procesar el correo. El proveedor puede reintentar.' }, { status: 503, headers });
  }
}
