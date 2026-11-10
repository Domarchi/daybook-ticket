import { z } from 'zod';
import { requireAccess } from '@/lib/access';
import { handle, type RouteContext } from '@/lib/server';
import { previewAttachment } from '@/lib/attachments';
export const maxDuration = 60;
export async function GET(request: Request, context: RouteContext) {
  return handle(async () =>
    previewAttachment(
      await requireAccess(request),
      z
        .string()
        .uuid()
        .parse((await context.params).id),
    ),
  );
}
