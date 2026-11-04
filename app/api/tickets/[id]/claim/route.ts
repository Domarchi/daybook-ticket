import {z} from 'zod';
import {handle,json,parseBody,parseId,type RouteContext} from '@/lib/server';
import {requireAccess,requireStaff} from '@/lib/access';
import {patchTicket} from '@/lib/ticket-mutations';
export async function POST(request:Request,context:RouteContext) {
  return handle(async()=>{
    const access=requireStaff(await requireAccess(request));
    const data=await parseBody(request,z.object({expectedVersion:z.number().int().nonnegative()}).strict());
    return json(await patchTicket(access,parseId((await context.params).id),data,true));
  });
}
