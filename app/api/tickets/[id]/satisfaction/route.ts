import { z } from 'zod';
import { requireAccess } from '@/lib/access';
import { db, handle, json, parseBody, parseId, type RouteContext } from '@/lib/server';
import { lockAccess, lockTicket, runOperation } from '@/lib/ticket-mutations';
import { acquireTicketWorkLock } from '@/lib/work-lock';
import { getTicketSatisfaction, submitTicketSatisfaction } from '@/lib/satisfaction';

export const dynamic = 'force-dynamic';
const schema = z.object({ operationId: z.string().uuid(), satisfactionId: z.string().uuid(), score: z.number().int().min(1).max(5), comment: z.string().trim().max(2000).default('') }).strict();
export async function GET(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = await requireAccess(request), id = parseId((await context.params).id);
    return json(await db().transaction(async tx => {
      await acquireTicketWorkLock(tx, access.ownerId);
      const fresh = await lockAccess(tx, access), ticket = await lockTicket(tx, fresh, id);
      return { satisfaction: await getTicketSatisfaction(tx, fresh, ticket) };
    }));
  });
}
export async function POST(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = await requireAccess(request), id = parseId((await context.params).id), input = await parseBody(request, schema);
    const result = await runOperation(access, input.operationId, 'satisfaction', { ticketId: id, ...input }, async (tx, fresh) => {
      const ticket = await lockTicket(tx, fresh, id);
      return { ticket, satisfaction: await submitTicketSatisfaction(tx, fresh, ticket, input) };
    });
    // Returning ticketId in the durable result lets operation replay re-check the current ticket ACL.
    return json({ satisfaction: result.satisfaction });
  });
}
