import { requireAccess } from '@/lib/access';
import { handle, json, parseBody } from '@/lib/server';
import { reserveAttachment, reserveAttachmentSchema } from '@/lib/attachments';

export async function POST(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request);
    return json(await reserveAttachment(access, await parseBody(request, reserveAttachmentSchema)), 201);
  });
}
