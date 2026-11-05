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
      const organization = await db().prepare('SELECT "ownerId" FROM organizations WHERE id=$1').bind('daybook').first<{ ownerId: string }>();
      if (!organization) return { skipped: true };
      const result=await drainInboundMailJobs(organization.ownerId, { maxJobs: 2, maxDurationMs: 40_000 });
      const {drainAutomationBestEffort}=await import('@/lib/automation');
      await drainAutomationBestEffort(organization.ownerId);
      return result;
    },
  })(request);
}
