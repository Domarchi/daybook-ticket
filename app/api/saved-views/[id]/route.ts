import { z } from 'zod';
import { requireOrganizationAccess } from '@/lib/organization-access';
import { handle,json,parseBody,type RouteContext } from '@/lib/server';
import { savedViewSchema } from '@/lib/work-organization-model';
import { deleteTicketView,saveTicketView } from '@/lib/work-organization';
export async function PATCH(request:Request,context:RouteContext) {return handle(async()=>{const input=await parseBody(request,savedViewSchema.extend({expectedVersion:z.number().int().nonnegative()}));return json({view:await saveTicketView(await requireOrganizationAccess(request),input,z.string().uuid().parse((await context.params).id),input.expectedVersion)});});}
export async function DELETE(request:Request,context:RouteContext) {return handle(async()=>{const input=await parseBody(request,z.object({expectedVersion:z.number().int().nonnegative()}).strict());return json(await deleteTicketView(await requireOrganizationAccess(request),z.string().uuid().parse((await context.params).id),input.expectedVersion));});}
