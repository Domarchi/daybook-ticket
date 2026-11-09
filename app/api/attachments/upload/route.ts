import { handleUpload } from '@vercel/blob/client';
import { z } from 'zod';
import { requireAccess } from '@/lib/access';
import { ApiError, handle, json, parseBody } from '@/lib/server';
import { consumeRateLimit, RATE_RULES } from '@/lib/rate-limit';
import { attachmentUploadTokenOptions } from '@/lib/attachments';
import { attachmentStorageConfig } from '@/lib/attachments-storage';

const uploadRequest = z.object({ type: z.literal('blob.generate-client-token'), payload: z.object({
  pathname: z.string().min(1).max(250), multipart: z.boolean(), clientPayload: z.string().max(200),
}).strict() }).strict();
const payloadSchema = z.object({ attachmentId: z.string().uuid() }).strict();

export async function POST(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request);
    await consumeRateLimit(access, RATE_RULES.attachmentUpload);
    const body = await parseBody(request, uploadRequest);
    const config = attachmentStorageConfig();
    if (!config) throw new ApiError(503, 'Los adjuntos privados todavía no están configurados.');
    let payload;
    try { payload = payloadSchema.parse(JSON.parse(body.payload.clientPayload)); }
    catch { throw new ApiError(400, 'La reserva del archivo no es válida.'); }
    // Authenticate every issuance. No webhook is needed: the authenticated complete
    // endpoint reads the private object and validates its actual bytes.
    const constraints = await attachmentUploadTokenOptions(access, payload.attachmentId, body.payload.pathname, body.payload.multipart);
    try {
      return json(await handleUpload({ body, request, token: config.token, onBeforeGenerateToken: async () => constraints }));
    } catch { throw new ApiError(503, 'No se pudo autorizar la carga. Intenta nuevamente.'); }
  });
}
