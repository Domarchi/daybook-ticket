import { requireAutomationAccess } from '@/lib/automation-access';
import { handle, json } from '@/lib/server';
import { listAutomationExecutions } from '@/lib/automation';
export async function GET(request: Request) {
  return handle(async () => {
    const q = new URL(request.url).searchParams;
    return json(
      await listAutomationExecutions(
        await requireAutomationAccess(request),
        q.get('cursor'),
        Number(q.get('limit') ?? 50),
      ),
    );
  });
}
