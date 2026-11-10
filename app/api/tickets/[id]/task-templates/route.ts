import { requireAutomationAccess } from '@/lib/automation-access';
import { handle, json, parseBody, parseId, type RouteContext } from '@/lib/server';
import { templateApplySchema } from '@/lib/automation-model';
import { applyTaskTemplate } from '@/lib/automation';
export async function POST(request: Request, context: RouteContext) {
  return handle(async () =>
    json(
      await applyTaskTemplate(
        await requireAutomationAccess(request),
        parseId((await context.params).id),
        await parseBody(request, templateApplySchema),
      ),
      201,
    ),
  );
}
