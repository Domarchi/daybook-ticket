import { requireAccess, requireStaff } from '@/lib/access';
import { isFulfillmentListFilter, listFulfillments } from '@/lib/fulfillment';
import { handle, json } from '@/lib/server';
export const dynamic = 'force-dynamic';
/** The "Requerimientos" section for the staff. */
export async function GET(request: Request) {
  return handle(async () => {
    const access = requireStaff(await requireAccess(request)),
      filter = new URL(request.url).searchParams.get('filter');
    return json(await listFulfillments(access, isFulfillmentListFilter(filter) ? filter : 'active'));
  });
}
