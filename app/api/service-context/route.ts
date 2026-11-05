import { z } from 'zod';
import { requireAccess, requireStaff } from '@/lib/access';
import { handle,json,parseBody } from '@/lib/server';
import { listServiceContext,createServiceContext,getServiceReminderConfig,listServiceReminders } from '@/lib/service-context';
export async function GET(request:Request) {return handle(async()=>{const access=requireStaff(await requireAccess(request)),query=new URL(request.url).searchParams,resource=query.get('resource');return json(resource==='config'?await getServiceReminderConfig(access):resource==='reminders'?await listServiceReminders(access,query):await listServiceContext(access,query));});}
export async function POST(request:Request) {return handle(async()=>json(await createServiceContext(requireStaff(await requireAccess(request)),await parseBody(request,z.record(z.string(),z.unknown()))),201));}
