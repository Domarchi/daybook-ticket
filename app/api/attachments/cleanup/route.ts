import { z } from 'zod';
import { requireAccess, requireAdmin } from '@/lib/access';
import { cleanupAttachments } from '@/lib/attachments';
import { handle, json, parseBody } from '@/lib/server';
export const maxDuration = 60;

export async function POST(request: Request) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    await parseBody(request, z.object({}).strict());
    return json(await cleanupAttachments(access.ownerId, null, 10));
  });
}
