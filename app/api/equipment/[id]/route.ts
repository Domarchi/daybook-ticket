import { requireAccess, requireStaff } from '@/lib/access';
import { equipmentChangeSchema } from '@/lib/client-equipment-model';
import { assignEquipment, equipmentHistory, setEquipmentArchived } from '@/lib/equipment-inventory';
import { handle, json, parseBody } from '@/lib/server';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
/** The equipment's history and the tickets that named it (F6-A3). */
export async function GET(request: Request, context: Context) {
  return handle(async () => {
    const access = requireStaff(await requireAccess(request)),
      { id } = await context.params;
    return json(await equipmentHistory(access, id));
  });
}
/** Assigns equipment to a client of its company or frees it; or gives it up («Dar de baja») or reactivates it. */
export async function PATCH(request: Request, context: Context) {
  return handle(async () => {
    const access = requireStaff(await requireAccess(request)),
      { id } = await context.params,
      body = await parseBody(request, equipmentChangeSchema);
    return json(
      'archived' in body ? await setEquipmentArchived(access, id, body) : await assignEquipment(access, id, body),
    );
  });
}
