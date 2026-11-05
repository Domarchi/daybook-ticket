import { z } from 'zod';
import { handle,json,parseBody,type RouteContext } from '@/lib/server';
import { changePilot,renewPilotOwnerInvitation,requireOperator } from '@/lib/workspaces';
import { limitsSchema,workspaceIdSchema } from '@/lib/workspace-model';
export async function PATCH(request:Request,context:RouteContext){return handle(async()=>{const actor=await requireOperator(request,true);const id=workspaceIdSchema.parse((await context.params).id),input=await parseBody(request,z.object({state:z.enum(['draft','active','suspended']).optional(),limits:limitsSchema.optional(),capacityConfirmed:z.boolean().optional(),expectedVersion:z.number().int().nonnegative()}).strict());return json(await changePilot(id,input,undefined,undefined,actor));});}
export async function POST(request:Request,context:RouteContext){return handle(async()=>{const actor=await requireOperator(request,true),id=workspaceIdSchema.parse((await context.params).id),input=await parseBody(request,z.object({action:z.literal('renew_owner_invitation'),expectedVersion:z.number().int().nonnegative()}).strict());return json(await renewPilotOwnerInvitation(id,input.expectedVersion,undefined,actor));});}
