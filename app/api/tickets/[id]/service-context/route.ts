import { requireStaff } from '@/lib/access';
import { requireServiceContextAccess } from '@/lib/service-context-access';
import { handle, json, parseBody, parseId, type RouteContext } from '@/lib/server';
import { readTicketServiceContext, saveTicketServiceContext } from '@/lib/service-context';
import { ticketContextSchema } from '@/lib/service-context-model';
export async function GET(request: Request, context: RouteContext) {
  return handle(async () =>
    json(
      await readTicketServiceContext(
        requireStaff(await requireServiceContextAccess(request)),
        parseId((await context.params).id),
      ),
    ),
  );
}
export async function PUT(request: Request, context: RouteContext) {
  return handle(async () =>
    json(
      await saveTicketServiceContext(
        requireStaff(await requireServiceContextAccess(request)),
        parseId((await context.params).id),
        await parseBody(request, ticketContextSchema),
      ),
    ),
  );
}
