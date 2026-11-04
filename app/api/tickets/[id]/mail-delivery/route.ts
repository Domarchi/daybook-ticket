import { db, handle, json, parseId, type RouteContext } from '@/lib/server';
import { requireAccess, requireStaff } from '@/lib/access';
import { lockAccess, lockTicket } from '@/lib/ticket-mutations';
import { ticketMailDelivery } from '@/lib/mail-delivery';

export async function GET(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = requireStaff(await requireAccess(request));
    const id = parseId((await context.params).id);
    const messages = await db().transaction(async client => {
      const fresh = requireStaff(await lockAccess(client, access));
      await lockTicket(client, fresh, id);
      return ticketMailDelivery(client, fresh.ownerId, id);
    });
    return json({ messages });
  });
}
