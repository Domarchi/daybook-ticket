import { requireAccess, requireAdmin } from '@/lib/access';
import { getMailStatus, drainOutbox } from '@/lib/mail';
import { handle, json } from '@/lib/server';

export async function POST(request: Request) {
  return handle(async () => {
    const context = await requireAccess(request);
    requireAdmin(context);
    // An explicit administrative action reports its actual processed totals.
    const result = await drainOutbox(context.ownerId, { maxDurationMs: 30_000 });
    return json({ ...result, mailStatus: await getMailStatus(context.ownerId) });
  });
}
