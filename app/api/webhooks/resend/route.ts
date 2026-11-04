import { getDatabase } from '@/db';
import { recordDeliveryReceipt } from '@/lib/mail-delivery';
import { InvalidDeliveryWebhook, normalizeDeliveryWebhook, readWebhookBody, verifyDeliverySignature } from '@/lib/mail-delivery-validation';
import { notificationEnvironment } from '@/lib/mail-templates';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!secret) return Response.json({ error: 'Seguimiento de correo no configurado.' }, { status: 503, headers });
  try {
    const raw = await readWebhookBody(request);
    const id = verifyDeliverySignature(raw, request.headers, secret);
    const receipt = normalizeDeliveryWebhook(raw, id, notificationEnvironment());
    if (receipt) await recordDeliveryReceipt(getDatabase(), receipt);
    return Response.json({ received: true }, { headers });
  } catch (error) {
    if (error instanceof InvalidDeliveryWebhook) return Response.json({ error: 'Solicitud de correo no válida.' }, { status: 400, headers });
    // Do not log the request, recipient, signing secret or authenticated payload.
    console.error('Daybook Ticket delivery receipt could not be recorded');
    return Response.json({ error: 'No se pudo registrar el aviso de entrega.' }, { status: 503, headers });
  }
}
