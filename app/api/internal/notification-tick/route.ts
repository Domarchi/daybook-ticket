import { createNotificationTickHandler } from '@/lib/notification-tick';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  return createNotificationTickHandler({
    enabled: process.env.DAYBOOK_NOTIFICATION_JOB_ENABLED === 'true',
    secret: process.env.DAYBOOK_NOTIFICATION_JOB_SECRET,
    run: async ({ invocationId }) => {
      // Import only after authentication, including its database dependencies.
      const { runNotificationTick } = await import('@/lib/reminders');
      return runNotificationTick(invocationId);
    },
  })(request);
}
