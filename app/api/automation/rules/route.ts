import { requireAutomationAccess } from '@/lib/automation-access';
import { handle, json, parseBody } from '@/lib/server';
import { ruleCreateSchema, rulePatchSchema } from '@/lib/automation-model';
import { createAutomationRule, listAutomationRules, patchAutomationRule } from '@/lib/automation';
export async function GET(request: Request) {
  return handle(async () => {
    const q = new URL(request.url).searchParams;
    return json(
      await listAutomationRules(
        await requireAutomationAccess(request),
        q.get('includeArchived') === 'true',
        q.get('cursor'),
        Number(q.get('limit') ?? 50),
      ),
    );
  });
}
export async function POST(request: Request) {
  return handle(async () => {
    const data = await parseBody(request, ruleCreateSchema);
    return json(
      { rule: await createAutomationRule(await requireAutomationAccess(request), data.rule, data.simulationProof) },
      201,
    );
  });
}
export async function PATCH(request: Request) {
  return handle(async () =>
    json({
      rule: await patchAutomationRule(
        await requireAutomationAccess(request),
        await parseBody(request, rulePatchSchema),
      ),
    }),
  );
}
