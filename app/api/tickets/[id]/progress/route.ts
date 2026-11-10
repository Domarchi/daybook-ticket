import { requireAccess } from '@/lib/access';
import { db, handle, json, parseId, type RouteContext } from '@/lib/server';
import { readPublicTicketProgress } from '@/lib/ticket-presence-progress';

export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = await requireAccess(request),
      id = parseId((await context.params).id);
    return json(await readPublicTicketProgress(db(), access, id));
  });
}
