import { requireAccess, requireStaff } from '@/lib/access';
import { assignEquipmentSchema } from '@/lib/client-equipment-model';
import { assignEquipment } from '@/lib/equipment-inventory';
import { handle, json, parseBody } from '@/lib/server';
type Context = { params: Promise<{ id: string }> };
/** Assigns equipment to a client of its company, or frees it. */
export async function PATCH(request: Request, context: Context) {
  return handle(async () => {
    const access = requireStaff(await requireAccess(request)),
      { id } = await context.params;
    return json(await assignEquipment(access, id, await parseBody(request, assignEquipmentSchema)));
  });
}
