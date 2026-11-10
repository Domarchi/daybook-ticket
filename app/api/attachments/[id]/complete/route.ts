import { z } from 'zod';
import { requireAccess } from '@/lib/access';
import { handle, json, parseBody, type RouteContext } from '@/lib/server';
import { completeAttachment } from '@/lib/attachments';
export const maxDuration = 60;

export async function POST(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = await requireAccess(request);
    const id = z
      .string()
      .uuid()
      .parse((await context.params).id);
    await parseBody(request, z.object({}).strict());
    return json(await completeAttachment(access, id));
  });
}
