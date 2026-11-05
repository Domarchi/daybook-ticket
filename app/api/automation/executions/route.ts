import { requireAccess } from '@/lib/access';
import { handle,json } from '@/lib/server';
import { listAutomationExecutions } from '@/lib/automation';
export async function GET(request:Request){return handle(async()=>{const q=new URL(request.url).searchParams;return json(await listAutomationExecutions(await requireAccess(request),q.get('cursor'),Number(q.get('limit')??50)));});}
