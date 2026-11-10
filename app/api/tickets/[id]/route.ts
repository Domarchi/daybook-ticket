import { drainAutomationBestEffort } from '@/lib/automation';
import { handle, json, parseBody, patchTicketSchema, parseId, type RouteContext } from '@/lib/server';
import { requireAccess, requireStaff } from '@/lib/access';
import { patchTicket } from '@/lib/ticket-mutations';
import { drainOutboxBestEffort } from '@/lib/mail';
import { after } from 'next/server';
export async function PATCH(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = requireStaff(await requireAccess(request));
    const id = parseId((await context.params).id);
    const result = await patchTicket(access, id, await parseBody(request, patchTicketSchema));
    after(async () => {
      await Promise.allSettled([drainOutboxBestEffort(access.ownerId), drainAutomationBestEffort(access.ownerId)]);
    });
    return json(result);
  });
}
