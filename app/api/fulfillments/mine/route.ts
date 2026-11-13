import { requireAccess } from '@/lib/access';
import { listOwnFulfillments } from '@/lib/fulfillment';
import { handle, json } from '@/lib/server';
export const dynamic = 'force-dynamic';
/** The portal's "Mis requerimientos": follow-ups of the tickets the signed-in person can see. */
export async function GET(request: Request) {
  return handle(async () => json(await listOwnFulfillments(await requireAccess(request))));
}
