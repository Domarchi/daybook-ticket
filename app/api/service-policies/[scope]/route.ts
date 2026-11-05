import { requireAccess, requireAdmin } from '@/lib/access';
import { db, handle, json, parseBody } from '@/lib/server';
import { deleteServicePolicy, deleteServicePolicySchema, getServicePolicy, saveServicePolicy, saveServicePolicySchema } from '@/lib/service-policies';

export const dynamic = 'force-dynamic';
type PolicyContext = { params: Promise<{ scope: string }> };

export async function GET(request: Request, context: PolicyContext) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    const { scope } = await context.params;
    return json({ policy: await db().transaction(tx => getServicePolicy(tx, access, scope)) });
  });
}
export async function PUT(request: Request, context: PolicyContext) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    const { scope } = await context.params;
    const data = await parseBody(request, saveServicePolicySchema);
    return json({ policy: await db().transaction(tx => saveServicePolicy(tx, access, scope, data)) });
  });
}
export async function DELETE(request: Request, context: PolicyContext) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    const { scope } = await context.params;
    const data = await parseBody(request, deleteServicePolicySchema);
    return json({ policy: await db().transaction(tx => deleteServicePolicy(tx, access, scope, data)) });
  });
}
