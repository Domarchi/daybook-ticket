import { z } from 'zod';
import { requireAccess } from '@/lib/access';
import { handle,json,parseBody } from '@/lib/server';
import { listOwnSessions,revokeOwnSessions } from '@/lib/security';
export const dynamic='force-dynamic';
export async function GET(request:Request) { return handle(async()=>json(await listOwnSessions(await requireAccess(request)))); }
const schema=z.union([z.object({id:z.string().min(1).max(256)}).strict(),z.object({others:z.literal(true)}).strict()]);
export async function DELETE(request:Request) { return handle(async()=>json(await revokeOwnSessions(await requireAccess(request),await parseBody(request,schema)))); }
