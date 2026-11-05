import { requireAutomationAccess } from '@/lib/automation-access';
import { handle,json,parseBody,parseId,type RouteContext } from '@/lib/server';
import { relationPatchSchema,ticketRelationSchema } from '@/lib/automation-model';
import { createTicketRelation,listTicketRelations,patchTicketRelation } from '@/lib/ticket-relations';
export async function GET(request:Request,context:RouteContext){return handle(async()=>{const q=new URL(request.url).searchParams;return json(await listTicketRelations(await requireAutomationAccess(request),parseId((await context.params).id),q.get('cursor'),Number(q.get('limit')??50)));});}
export async function POST(request:Request,context:RouteContext){return handle(async()=>json(await createTicketRelation(await requireAutomationAccess(request),parseId((await context.params).id),await parseBody(request,ticketRelationSchema)),201));}
export async function PATCH(request:Request,context:RouteContext){return handle(async()=>json(await patchTicketRelation(await requireAutomationAccess(request),parseId((await context.params).id),await parseBody(request,relationPatchSchema))));}
