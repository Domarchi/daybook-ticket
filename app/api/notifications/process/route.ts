import { requireAccess, requireAdmin } from '@/lib/access';
import { getMailStatus, processOutbox } from '@/lib/mail';
import { handle, json } from '@/lib/server';

export async function POST(request: Request) {
  return handle(async () => {
    const context = await requireAccess(request);
    requireAdmin(context);
    const result = await processOutbox(context.ownerId);
    return json({ ...result, mailStatus: await getMailStatus(context.ownerId) });
  });
}
