import { sessionRevocationSchema } from '@/lib/security-model';
import { requireAccess } from '@/lib/access';
import { handle,json,parseBody } from '@/lib/server';
import { listOwnSessions,revokeOwnSessions } from '@/lib/security';
export const dynamic='force-dynamic';
export async function GET(request:Request) { return handle(async()=>json(await listOwnSessions(await requireAccess(request)))); }
export async function DELETE(request:Request) { return handle(async()=>json(await revokeOwnSessions(await requireAccess(request),await parseBody(request,sessionRevocationSchema)))); }
