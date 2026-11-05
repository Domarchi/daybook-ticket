import { z } from 'zod';
import { requireAccess } from '@/lib/access';
import { handle,json,parseBody,type RouteContext } from '@/lib/server';
import { taskPatchSchema } from '@/lib/work-organization-model';
import { patchTicketTask } from '@/lib/work-organization';
export async function PATCH(request:Request,context:RouteContext) {return handle(async()=>json({task:await patchTicketTask(await requireAccess(request),z.string().uuid().parse((await context.params).id),await parseBody(request,taskPatchSchema))}));}
