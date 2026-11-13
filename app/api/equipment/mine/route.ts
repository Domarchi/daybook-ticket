import { requireAccess } from '@/lib/access';
import { listOwnEquipment } from '@/lib/equipment-inventory';
import { handle, json } from '@/lib/server';
export const dynamic = 'force-dynamic';
/** The equipment assigned to the signed-in person (the portal's "Mis equipos"). */
export async function GET(request: Request) {
  return handle(async () => json({ equipment: await listOwnEquipment(await requireAccess(request)) }));
}
