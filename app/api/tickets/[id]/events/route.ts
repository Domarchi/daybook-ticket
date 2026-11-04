import {db,handle,json,parseId,type RouteContext} from '@/lib/server';
import {requireAccess,requireStaff} from '@/lib/access';
import {lockAccess,lockTicket,ticketEvents} from '@/lib/ticket-mutations';
export async function GET(request:Request,context:RouteContext) {
  return handle(async()=>{
    const access=requireStaff(await requireAccess(request));
    const id=parseId((await context.params).id);
    const events=await db().transaction(async tx=>{const fresh=requireStaff(await lockAccess(tx,access));await lockTicket(tx,fresh,id);return ticketEvents(tx,access.ownerId,id);});
    return json({events});
  });
}
