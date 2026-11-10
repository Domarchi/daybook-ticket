import { z } from 'zod';
import { requireAccess } from '@/lib/access';
import { handle, json, parseBody, type RouteContext } from '@/lib/server';
import {
  assignmentRuleVersionSchema,
  deleteAssignmentRule,
  patchAssignmentRuleSchema,
  updateAssignmentRule,
} from '@/lib/assignment-rules';

export async function PATCH(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = await requireAccess(request);
    const id = z
      .string()
      .uuid()
      .parse((await context.params).id);
    const data = await parseBody(request, patchAssignmentRuleSchema);
    return json({ rule: await updateAssignmentRule(access, id, data) });
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = await requireAccess(request);
    const id = z
      .string()
      .uuid()
      .parse((await context.params).id);
    const { expectedVersion } = await parseBody(request, assignmentRuleVersionSchema);
    await deleteAssignmentRule(access, id, expectedVersion);
    return json({ ok: true });
  });
}
