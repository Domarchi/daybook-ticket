import { requireAccess } from '@/lib/access';
import { confirmFulfillmentReceipt } from '@/lib/fulfillment';
import { handle, json, parseId } from '@/lib/server';
type Context = { params: Promise<{ id: string }> };
/** "Confirmar recepción": optional, by the person who asked, once the requirement was delivered. */
export async function POST(request: Request, context: Context) {
  return handle(async () => {
    const access = await requireAccess(request),
      { id } = await context.params;
    return json(await confirmFulfillmentReceipt(access, parseId(id)));
  });
}
