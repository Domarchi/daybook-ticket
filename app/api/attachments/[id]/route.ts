import { after } from 'next/server';
import { z } from 'zod';
import { requireAccess } from '@/lib/access';
import { handle, json, type RouteContext } from '@/lib/server';
import { cleanupAttachments, removePendingAttachment } from '@/lib/attachments';

export async function DELETE(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = await requireAccess(request);
    const id = z
      .string()
      .uuid()
      .parse((await context.params).id);
    const result = await removePendingAttachment(access, id);
    after(async () => {
      await cleanupAttachments(access.ownerId, access.member.id, 5).catch(() => {});
    });
    return json(result);
  });
}
