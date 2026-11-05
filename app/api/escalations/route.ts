import { z } from 'zod';
import { requireAccess, requireAdmin } from '@/lib/access';
import { db, handle, json, parseBody } from '@/lib/server';
import { lockAccess } from '@/lib/ticket-mutations';
import { acquireTicketWorkLock } from '@/lib/work-lock';
import { getEscalationPolicy, saveEscalationPolicy } from '@/lib/escalations';

export const dynamic = 'force-dynamic';
const schema = z.object({ enabled: z.boolean(), unansweredMinutes: z.number().int().min(120).max(43200),
  overdueMinutes: z.number().int().min(0).max(43200), recipientMemberIds: z.array(z.string().uuid()).max(20), version: z.number().int().nonnegative() }).strict();

export async function GET(request: Request) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    return json(await db().transaction(async tx => {
      await acquireTicketWorkLock(tx, access.ownerId);
      const fresh = requireAdmin(await lockAccess(tx, access));
      return getEscalationPolicy(tx, fresh.ownerId);
    }));
  });
}
export async function PATCH(request: Request) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    const input = await parseBody(request, schema);
    return json(await db().transaction(async tx => {
      await acquireTicketWorkLock(tx, access.ownerId);
      const fresh = requireAdmin(await lockAccess(tx, access));
      return saveEscalationPolicy(tx, fresh, input);
    }));
  });
}
