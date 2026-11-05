import { requireAccess } from '@/lib/access';
import { handle, json, parseBody } from '@/lib/server';
import { createAssignmentRule, createAssignmentRuleSchema, listAssignmentRules } from '@/lib/assignment-rules';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handle(async () => json({ rules: await listAssignmentRules(await requireAccess(request)) }));
}

export async function POST(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request);
    const data = await parseBody(request, createAssignmentRuleSchema);
    return json({ rule: await createAssignmentRule(access, data) }, 201);
  });
}
