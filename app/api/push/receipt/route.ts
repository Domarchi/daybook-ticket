import { z } from 'zod';
import { requireAccess } from '@/lib/access';
import { handle, json, parseBody } from '@/lib/server';
import { pushReceipt } from '@/lib/push';

const receiptSchema = z.object({ subscriptionId: z.string().uuid(), eventId: z.string().uuid().optional(), test: z.literal(true).optional() })
  .strict().refine(value => Boolean(value.eventId) !== Boolean(value.test), 'El aviso no es válido.');
export async function POST(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request);
    return json(await pushReceipt(access, await parseBody(request, receiptSchema)));
  });
}
