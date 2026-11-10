import { createNotificationPinger } from './handler';

const notificationPinger = {
  async fetch(request: Request) {
    const environment = process.env.DAYBOOK_PINGER_ENVIRONMENT;
    if (environment !== 'qa' && environment !== 'production') return new Response('Unconfigured', { status: 503 });
    try {
      return await createNotificationPinger({
        enabled: process.env.DAYBOOK_PINGER_ENABLED === 'true',
        environment,
        targetOrigin: process.env.DAYBOOK_NOTIFICATION_TARGET_ORIGIN || '',
        expectedTriggerId: process.env.DAYBOOK_EXPECTED_TRIGGER_ID || '',
        jobSecret: process.env.DAYBOOK_NOTIFICATION_JOB_SECRET || '',
        automationBypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
        inboundEnabled: process.env.DAYBOOK_PINGER_INBOUND_ENABLED === 'true',
        backupsEnabled: process.env.DAYBOOK_PINGER_BACKUPS_ENABLED === 'true',
        serviceContextEnabled: process.env.DAYBOOK_SERVICE_CONTEXT_JOB_ENABLED === 'true',
        serviceContextJobSecret: process.env.DAYBOOK_SERVICE_CONTEXT_JOB_SECRET,
        automationEnabled: process.env.DAYBOOK_AUTOMATION_JOB_ENABLED === 'true',
        automationJobSecret: process.env.DAYBOOK_AUTOMATION_JOB_SECRET,
      })(request);
    } catch {
      return new Response('Unconfigured', { status: 503 });
    }
  },
};

export default notificationPinger;
