import assert from 'node:assert/strict';
import test from 'node:test';
import { createNotificationPinger } from '../functions/notification-pinger/handler';
const payload = {
  version: 1,
  invocation_id: 'qa-maintenance',
  trigger: { id: 'qa-trigger', type: 'schedule' },
  data: { scheduled_at: '2026-11-05T15:00:00.000Z' },
};
const request = () =>
  new Request('https://qa.compute.cell.us-east-1.aws.neon.tech/tick', {
    method: 'POST',
    headers: { 'x-neon-trigger-invocation-id': payload.invocation_id },
    body: JSON.stringify(payload),
  });
const config = {
  enabled: true,
  environment: 'qa' as const,
  targetOrigin: 'https://daybook-ticket-qa-maintenance.vercel.app',
  expectedTriggerId: 'qa-trigger',
  jobSecret: 'qa-fictional-job-secret-'.repeat(3),
  inboundEnabled: true,
  backupsEnabled: true,
  automationBypassSecret: 'fictitious-qa-bypass',
};
test('reminders run first; independent inbound/backup failures do not suppress other workers', async () => {
  for (const failure of ['', 'notification-tick', 'inbound-tick', 'backup-tick']) {
    const paths: string[] = [];
    const handler = createNotificationPinger(config, {
      fetch: async (input, init) => {
        const path = new URL(String(input)).pathname;
        paths.push(path);
        assert.equal(init?.redirect, 'manual');
        assert.equal(new Headers(init?.headers).get('x-vercel-protection-bypass'), config.automationBypassSecret);
        if (path.endsWith(failure) && failure) throw new Error('Simulated interruption');
        return Response.json({ ok: true });
      },
    });
    const result = await handler(request());
    assert.deepEqual(paths, [
      '/api/internal/notification-tick',
      '/api/internal/inbound-tick',
      '/api/internal/backup-tick',
    ]);
    assert.equal(result.status, failure ? 503 : 200);
  }
});
test('maintenance stays opt-in and rejects untrusted triggers before all workers', async () => {
  let calls = 0;
  const handler = createNotificationPinger(
    { ...config, inboundEnabled: false, backupsEnabled: false },
    {
      fetch: async () => {
        calls++;
        return Response.json({ ok: true });
      },
    },
  );
  assert.equal(
    (await handler(new Request('https://qa.compute.cell.us-east-1.aws.neon.tech/tick', { method: 'POST', body: '{}' })))
      .status,
    401,
  );
  assert.equal(calls, 0);
  assert.equal((await handler(request())).status, 200);
  assert.equal(calls, 1);
});
