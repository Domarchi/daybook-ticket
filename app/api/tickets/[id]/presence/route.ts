import { requireAccess, requireStaff } from '@/lib/access';
import { db, handle, json, parseBody, parseId, type RouteContext } from '@/lib/server';
import { heartbeatTicketPresence, readTicketPresence, releaseTicketPresence } from '@/lib/ticket-presence';
import { presenceInputSchema, presenceReleaseSchema } from '@/lib/ticket-presence-validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = requireStaff(await requireAccess(request)),
      id = parseId((await context.params).id);
    return json(await readTicketPresence(db(), access, id));
  });
}
export async function POST(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = requireStaff(await requireAccess(request)),
      id = parseId((await context.params).id);
    return json(await heartbeatTicketPresence(db(), access, id, await parseBody(request, presenceInputSchema)));
  });
}
export async function DELETE(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = requireStaff(await requireAccess(request)),
      id = parseId((await context.params).id);
    const { tabId } = await parseBody(request, presenceReleaseSchema);
    await releaseTicketPresence(db(), access, id, tabId);
    return json({ released: true });
  });
}
