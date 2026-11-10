import { requireAccess, requireAdmin } from '@/lib/access';
import { getMailStatus, listNotifications } from '@/lib/mail';
import { handle, json } from '@/lib/server';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(async () => {
    const context = await requireAccess(request);
    requireAdmin(context);
    const [mailStatus, notifications] = await Promise.all([
      getMailStatus(context.ownerId),
      listNotifications(context.ownerId),
    ]);
    return json({ mailStatus, notifications });
  });
}
