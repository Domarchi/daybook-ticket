import { handle,json } from '@/lib/server';
import { listIdentityWorkspaces } from '@/lib/workspaces';
export async function GET(request:Request){return handle(async()=>json(await listIdentityWorkspaces(request)));}
