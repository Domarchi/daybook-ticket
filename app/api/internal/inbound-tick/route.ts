import { createNotificationTickHandler } from '@/lib/notification-tick';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  return createNotificationTickHandler({
    enabled: process.env.DAYBOOK_NOTIFICATION_JOB_ENABLED === 'true',
    secret: process.env.DAYBOOK_NOTIFICATION_JOB_SECRET,
    run: async () => {
      // Authenticate before importing any database dependency.
      const { db } = await import('@/lib/server');
      const { drainInboundMailJobs } = await import('@/lib/inbound-email-jobs');
      const { activeWorkspaceOwners }=await import('@/lib/workspaces');
      const owners=await activeWorkspaceOwners(db()),deadline=Date.now()+45000;
      const {drainAutomationBestEffort}=await import('@/lib/automation');
      let attempted=0;
      for(const [index,owner] of owners.entries()){
        if(Date.now()>deadline-1000)break;
        try{const result=await drainInboundMailJobs(owner.ownerId,{maxJobs:1,maxDurationMs:Math.max(1000,Math.floor((deadline-Date.now())/(owners.length-index)))});attempted+=result.attempted;await drainAutomationBestEffort(owner.ownerId);}catch{/* Durable per-space job health records the failure. */}
      }
      return {attempted,skipped:!owners.length};
    },
  })(request);
}
