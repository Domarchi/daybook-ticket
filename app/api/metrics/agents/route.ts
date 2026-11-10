import { requireAccess, requireAdmin } from '@/lib/access';
import { ApiError, db, handle, json } from '@/lib/server';
import { lockAccess } from '@/lib/ticket-mutations';
import { acquireTicketWorkLock } from '@/lib/work-lock';
import { getAgentMetrics } from '@/lib/agent-metrics';
import { MetricsQueryError, parseMetricsQuery } from '@/lib/agent-metrics-model';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    let period;
    try {
      period = parseMetricsQuery(new URL(request.url).searchParams);
    } catch (error) {
      if (error instanceof MetricsQueryError) throw new ApiError(400, error.message);
      throw error;
    }
    const report = await db().transaction(async tx => {
      await acquireTicketWorkLock(tx, access.ownerId);
      const fresh = requireAdmin(await lockAccess(tx, access));
      return getAgentMetrics(tx, fresh, period);
    });
    return json(report);
  });
}
