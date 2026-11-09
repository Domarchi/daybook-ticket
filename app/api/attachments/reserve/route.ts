import { requireAccess } from '@/lib/access';
import { handle, json, parseBody } from '@/lib/server';
import { consumeRateLimit, RATE_RULES } from '@/lib/rate-limit';
import { reserveAttachment, reserveAttachmentSchema } from '@/lib/attachments';

export async function POST(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request);
    await consumeRateLimit(access, RATE_RULES.attachmentReserve);
    return json(await reserveAttachment(access, await parseBody(request, reserveAttachmentSchema)), 201);
  });
}
