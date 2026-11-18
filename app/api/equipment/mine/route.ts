import { requireAccess } from '@/lib/access';
import { registerOwnEquipmentSchema } from '@/lib/client-equipment-model';
import { listOwnEquipment } from '@/lib/equipment-inventory';
import { registerOwnEquipment, requireActiveClient } from '@/lib/own-equipment';
import { consumeRateLimit, RATE_RULES } from '@/lib/rate-limit';
import { handle, json, parseBody } from '@/lib/server';
export const dynamic = 'force-dynamic';
/** The equipment assigned to the signed-in person (the portal's "Mis equipos"). */
export async function GET(request: Request) {
  return handle(async () => json({ equipment: await listOwnEquipment(await requireAccess(request)) }));
}
/** «Confirma tu equipo»: a client without equipment registers their own (Fase 7, L4). */
export async function POST(request: Request) {
  return handle(async () => {
    const access = requireActiveClient(await requireAccess(request));
    await consumeRateLimit(access, RATE_RULES.ownEquipment);
    return json(await registerOwnEquipment(access, await parseBody(request, registerOwnEquipmentSchema)), 201);
  });
}
