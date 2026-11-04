import {handle,json,parseBody,patchTicketSchema,parseId,type RouteContext} from '@/lib/server';
import {requireAccess,requireStaff} from '@/lib/access';
import {patchTicket} from '@/lib/ticket-mutations';
export async function PATCH(request:Request,context:RouteContext) {
  return handle(async()=>{
    const access=requireStaff(await requireAccess(request));
    const id=parseId((await context.params).id);
    return json(await patchTicket(access,id,await parseBody(request,patchTicketSchema)));
  });
}
