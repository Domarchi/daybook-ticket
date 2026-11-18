import { z } from 'zod';
import { requireAccess } from '@/lib/access';
import { completeOwnEquipmentSchema } from '@/lib/client-equipment-model';
import { completeOwnEquipment, requireActiveClient } from '@/lib/own-equipment';
import { consumeRateLimit, RATE_RULES } from '@/lib/rate-limit';
import { ApiError, handle, json, parseBody, type RouteContext } from '@/lib/server';

/** «Confirma tu equipo»: the holder adds the serial number to equipment registered without it (Fase 7, L4). */
export async function PATCH(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = requireActiveClient(await requireAccess(request));
    const id = z
      .string()
      .uuid()
      .safeParse((await context.params).id);
    if (!id.success) throw new ApiError(404, 'Ese equipo no está asignado a tu cuenta.');
    await consumeRateLimit(access, RATE_RULES.ownEquipment);
    return json(await completeOwnEquipment(access, id.data, await parseBody(request, completeOwnEquipmentSchema)));
  });
}
