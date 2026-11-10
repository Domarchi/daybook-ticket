import { z } from 'zod';
import { requireAccess } from '@/lib/access';
import { handle, json, parseBody } from '@/lib/server';
import { pushReceipt } from '@/lib/push';

const receiptSchema = z
  .object({
    subscriptionId: z.string().uuid(),
    eventId: z.string().uuid().optional(),
    test: z.literal(true).optional(),
  })
  .strict()
  .refine(value => Boolean(value.eventId) !== Boolean(value.test), 'El aviso no es válido.');
export async function POST(request: Request) {
  let kind = 'unknown';
  const response = await handle(async () => {
    const access = await requireAccess(request);
    const input = await parseBody(request, receiptSchema);
    kind = input.test ? 'test' : 'ticket';
    return json(await pushReceipt(access, input));
  });
  // Bounded metadata only: never log subscriptions, cookies, keys or ticket content.
  console.info('Daybook Ticket push receipt', JSON.stringify({ status: response.status, kind }));
  return response;
}
