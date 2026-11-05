import { requireAccess } from '@/lib/access';
import { handle, json, parseBody, parseId, type RouteContext } from '@/lib/server';
import { taskCreateSchema } from '@/lib/work-organization-model';
import { createTicketTask, listTicketTasks } from '@/lib/work-organization';
export async function GET(request:Request,context:RouteContext) { return handle(async()=>{const params=new URL(request.url).searchParams;return json(await listTicketTasks(await requireAccess(request),parseId((await context.params).id),params.get('cursor'),Number(params.get('limit')??50)));}); }
export async function POST(request:Request,context:RouteContext) {return handle(async()=>json({task:await createTicketTask(await requireAccess(request),parseId((await context.params).id),await parseBody(request,taskCreateSchema))},201));}
