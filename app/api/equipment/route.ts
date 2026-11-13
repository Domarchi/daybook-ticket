import { requireAccess, requireStaff } from '@/lib/access';
import { createEquipmentSchema, isEquipmentFilter } from '@/lib/client-equipment-model';
import { createEquipment, listEquipment } from '@/lib/equipment-inventory';
import { handle, json, parseBody } from '@/lib/server';
export const dynamic = 'force-dynamic';
/** The equipment inventory for the staff (F6-A2). */
export async function GET(request: Request) {
  return handle(async () => {
    const access = requireStaff(await requireAccess(request)),
      params = new URL(request.url).searchParams,
      filter = params.get('filter');
    return json(
      await listEquipment(access, {
        query: params.get('q') ?? '',
        filter: isEquipmentFilter(filter) ? filter : 'all',
      }),
    );
  });
}
export async function POST(request: Request) {
  return handle(async () => {
    const access = requireStaff(await requireAccess(request));
    return json(await createEquipment(access, await parseBody(request, createEquipmentSchema)), 201);
  });
}
