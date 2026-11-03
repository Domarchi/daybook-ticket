import { z } from 'zod';
import { requireAccess } from '@/lib/access';
import { handle, json, parseBody } from '@/lib/server';
import { sendPushTest } from '@/lib/push';

export async function POST(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request);
    const { subscriptionId } = await parseBody(request, z.object({ subscriptionId: z.string().uuid() }).strict());
    return json(await sendPushTest(access, subscriptionId));
  });
}
