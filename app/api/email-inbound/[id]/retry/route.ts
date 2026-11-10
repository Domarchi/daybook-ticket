import { drainAutomationBestEffort } from '@/lib/automation';
import { after } from 'next/server';
import { z } from 'zod';
import { requireAccess, requireAdmin } from '@/lib/access';
import { ApiError, db, handle, json, parseBody, type RouteContext } from '@/lib/server';
import { drainInboundMailBestEffort, retryInboundMailJob } from '@/lib/inbound-email-jobs';
import { inboundConfiguration, InvalidInboundEmail } from '@/lib/inbound-email-validation';
import { InboundRejectError } from '@/lib/inbound-email-errors';

export const runtime = 'nodejs';
export const maxDuration = 60;
const schema = z.object({ operationId: z.string().uuid() }).strict();
export async function POST(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    if (!inboundConfiguration().enabled) throw new ApiError(503, 'La recepción está en pausa.');
    const { operationId } = await parseBody(request, schema),
      providerId = (await context.params).id;
    let job;
    try {
      job = await retryInboundMailJob(db(), access, providerId, operationId);
    } catch (error) {
      if (error instanceof InvalidInboundEmail) throw new ApiError(400, 'Selecciona un ingreso válido.');
      if (error instanceof InboundRejectError)
        throw new ApiError(409, 'Este ingreso ya alcanzó tres reintentos manuales.');
      throw error;
    }
    if (!job) throw new ApiError(404, 'El ingreso no existe.');
    if (job.status === 'pending')
      after(async () => {
        await drainInboundMailBestEffort(access.ownerId, { providerId });
        const [{ drainOutboxBestEffort }, { processPushOutboxBestEffort }] = await Promise.all([
          import('@/lib/mail'),
          import('@/lib/push'),
        ]);
        await Promise.allSettled([
          drainOutboxBestEffort(access.ownerId),
          processPushOutboxBestEffort(access.ownerId),
          drainAutomationBestEffort(access.ownerId),
        ]);
      });
    return json({ job });
  });
}
