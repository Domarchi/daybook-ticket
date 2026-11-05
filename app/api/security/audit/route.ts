import { requireAccess } from '@/lib/access';
import { handle,json } from '@/lib/server';
import { listSecurityAudit } from '@/lib/security';
export const dynamic='force-dynamic';
export async function GET(request:Request) { return handle(async()=>json(await listSecurityAudit(await requireAccess(request),new URL(request.url).searchParams.get('cursor')))); }
