import { requireAccess } from '@/lib/access';
import { handle,json } from '@/lib/server';
import { getSecurityHealth } from '@/lib/security';
export const dynamic='force-dynamic';
export async function GET(request:Request) { return handle(async()=>json(await getSecurityHealth(await requireAccess(request)))); }
