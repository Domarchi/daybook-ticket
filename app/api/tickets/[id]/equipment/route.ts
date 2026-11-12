import { requireAccess } from '@/lib/access';
import { listTicketEquipment } from '@/lib/equipment-inventory';
import { handle, json, parseId } from '@/lib/server';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
/** The equipment a ticket is about, for anyone who can open the ticket. */
export async function GET(request: Request, context: Context) {
  return handle(async () => {
    const access = await requireAccess(request),
      { id } = await context.params;
    return json({ equipment: await listTicketEquipment(access, parseId(id)) });
  });
}
