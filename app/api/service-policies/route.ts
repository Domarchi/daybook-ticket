import { requireAccess, requireAdmin } from '@/lib/access';
import { db, handle, json } from '@/lib/server';
import { listServicePolicies } from '@/lib/service-policies';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    return json(await db().transaction(tx => listServicePolicies(tx, access)));
  });
}
