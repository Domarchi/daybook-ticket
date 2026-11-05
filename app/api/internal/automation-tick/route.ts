import { createNotificationTickHandler } from '@/lib/notification-tick';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request){return createNotificationTickHandler({
  enabled:process.env.DAYBOOK_AUTOMATION_JOB_ENABLED==='true',
  secret:process.env.DAYBOOK_AUTOMATION_JOB_SECRET,
  run:async()=>{
    // Authentication precedes every database import; the scheduler is off by default.
    const { db }=await import('@/lib/server');
    const { drainAutomationEvents }=await import('@/lib/automation');
    const owners=await db().prepare(`SELECT s."ownerId" FROM "automationSettings" s JOIN "evolutionFeatures" e ON e."ownerId"=s."ownerId" JOIN organizations o ON o."ownerId"=s."ownerId" LEFT JOIN "workspaceProfiles" p ON p."workspaceId"=o.id AND p."ownerId"=o."ownerId" LEFT JOIN "automationJobHealth" h ON h."ownerId"=s."ownerId" WHERE (o.id='daybook' OR p.state='active') AND s.enabled AND COALESCE(e."featuresJson"::jsonb->>'automation','false')='true' ORDER BY h."lastStartedAt" ASC NULLS FIRST,s."ownerId" LIMIT 2`).all<{ownerId:string}>();
    const results=[];for(const owner of owners.results)results.push(await drainAutomationEvents(owner.ownerId,{maxEvents:2,maxDurationMs:20_000}));
    return {spaces:results.length,processed:results.reduce((n,v)=>n+v.processed,0),failed:results.reduce((n,v)=>n+v.failed,0)};
  },
})(request);}
