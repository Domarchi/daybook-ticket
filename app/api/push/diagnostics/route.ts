import { z } from 'zod';
import { requireAccess } from '@/lib/access';
import { handle, json, parseBody } from '@/lib/server';
import { pushReceipt } from '@/lib/push';

const diagnosticSchema = z
  .object({
    subscriptionId: z.string().uuid(),
    eventId: z.string().uuid().optional(),
    test: z.literal(true).optional(),
    stage: z.enum(['shown', 'display_failed']),
    reason: z.enum(['not_allowed', 'invalid_state', 'unsupported', 'unknown']).optional(),
  })
  .strict()
  .refine(value => Boolean(value.eventId) !== Boolean(value.test), 'El aviso no es válido.');

export async function POST(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request);
    const input = await parseBody(request, diagnosticSchema);
    // A report is accepted only for a device/event this signed-in account can receive.
    await pushReceipt(access, input);
    console.info(
      'Daybook Ticket push display',
      JSON.stringify({
        kind: input.test ? 'test' : 'ticket',
        stage: input.stage,
        ...(input.stage === 'display_failed' ? { reason: input.reason || 'unknown' } : {}),
      }),
    );
    return json({ ok: true });
  });
}
