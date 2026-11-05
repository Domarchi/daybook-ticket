import { requireAccess } from '@/lib/access';
import { handle,json,ApiError } from '@/lib/server';
import { listAutomationRuleVersions } from '@/lib/automation';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return handle(async()=>{const {id}=await params;if(!/^[a-fA-F0-9-]{36}$/.test(id))throw new ApiError(400,'La regla no es válida.');const q=new URL(request.url).searchParams;return json(await listAutomationRuleVersions(await requireAccess(request),id,q.has('beforeVersion')?Number(q.get('beforeVersion')):null,Number(q.get('limit')??25)));});}
