import { z } from 'zod';
import { requireIdentityAccess } from '@/lib/identity-access';
import { handle,json,parseBody,ApiError } from '@/lib/server';
import { acknowledgeRecovery,consumeSecurityAttempt,getSecurityStatus,recordCurrentPasswordProof } from '@/lib/security';
import { daybookAuth } from '@/lib/daybook-auth';
export async function GET(request:Request){return handle(async()=>json(await getSecurityStatus(await requireIdentityAccess(request))));}
export async function POST(request:Request){return handle(async()=>{const access=await requireIdentityAccess(request),input=await parseBody(request,z.discriminatedUnion('action',[z.object({action:z.literal('reauthenticate'),password:z.string().min(1).max(128)}).strict(),z.object({action:z.literal('acknowledge_recovery'),confirmed:z.literal(true)}).strict()]));if(input.action==='acknowledge_recovery')await acknowledgeRecovery(access);else{await consumeSecurityAttempt(access);try{await daybookAuth().api.verifyPassword({headers:request.headers,body:{password:input.password}});}catch{throw new ApiError(403,'No se pudo verificar tu contraseña.');}await recordCurrentPasswordProof(access);}return json(await getSecurityStatus(access));});}
