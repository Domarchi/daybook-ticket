import { createNotificationTickHandler } from '@/lib/notification-tick';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request) {return createNotificationTickHandler({enabled:process.env.DAYBOOK_SERVICE_CONTEXT_JOB_ENABLED==='true',secret:process.env.DAYBOOK_SERVICE_CONTEXT_JOB_SECRET,run:async({invocationId})=>{const {runServiceContextTick}=await import('@/lib/service-context-reminders');return runServiceContextTick(invocationId);}})(request);}
