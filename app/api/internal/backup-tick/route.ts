import { createNotificationTickHandler } from '@/lib/notification-tick';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request) {
  return createNotificationTickHandler({
    enabled: process.env.DAYBOOK_NOTIFICATION_JOB_ENABLED === 'true',
    secret: process.env.DAYBOOK_NOTIFICATION_JOB_SECRET,
    // Authenticate before importing database or backup transports. The pinger
    // invokes this independently, after the short reminder request finishes.
    run: async () => (await import('@/lib/automatic-backup')).processDueBackups(),
  })(request);
}
