import { requireAccess, requireAdmin } from '@/lib/access';
import { ApiError, db, handle, json } from '@/lib/server';
import { lockAccess } from '@/lib/ticket-mutations';
import { acquireTicketWorkLock } from '@/lib/work-lock';
import { MetricsQueryError, parseMetricsQuery } from '@/lib/agent-metrics-model';
import { getSatisfactionReport } from '@/lib/satisfaction';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    const params = new URL(request.url).searchParams;
    const agentIds = params.getAll('agentId'),
      agentId = params.get('agentId') || null;
    if (
      agentIds.length > 1 ||
      (agentId && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(agentId))
    )
      throw new ApiError(400, 'Selecciona un integrante válido.');
    params.delete('agentId');
    let period;
    try {
      period = parseMetricsQuery(params);
    } catch (error) {
      if (error instanceof MetricsQueryError) throw new ApiError(400, error.message);
      throw error;
    }
    return json(
      await db().transaction(async tx => {
        await acquireTicketWorkLock(tx, access.ownerId);
        const fresh = requireAdmin(await lockAccess(tx, access));
        return getSatisfactionReport(tx, fresh, period, agentId);
      }),
    );
  });
}
