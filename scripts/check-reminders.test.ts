import assert from 'node:assert/strict';
import { activeReminderReasons, nextReminderReasons, reminderRecipients, type ReminderClock, type ReminderHistory } from '../lib/reminders-policy';
import { createNotificationTickHandler } from '../lib/notification-tick';
import { createNotificationPinger, type PingerConfiguration } from '../functions/notification-pinger/handler';

const now = new Date('2026-11-04T12:00:00.000Z');
const ago = (hours: number) => new Date(now.getTime() - hours * 3600_000).toISOString();
const later = (hours: number) => ago(-hours);
const empty: ReminderHistory = { unansweredSent: false, dueSoonSent: false, overdueSent: false, lastEnqueuedAt: null };
const waiting: ReminderClock = { status: 'open', dueAt: later(4), unansweredSince: ago(2), unansweredMessageId: 42 };
assert.deepEqual(activeReminderReasons({ ...waiting, unansweredSince: ago(2 - 1 / 3600) }, now), [], 'No reminder one second before two hours');
assert.deepEqual(nextReminderReasons(waiting, empty, now), ['unanswered']);
assert.deepEqual(nextReminderReasons({ ...waiting, dueAt: later(1) }, empty, now), ['unanswered', 'due_soon'], 'Coinciding reasons form one grouped event');
assert.deepEqual(nextReminderReasons({ ...waiting, dueAt: now.toISOString() }, empty, now), ['unanswered', 'overdue'], 'At due time, do not also replay the due-soon stage');
assert.deepEqual(nextReminderReasons({ ...waiting, status: 'resolved' }, empty, now), []);
assert.deepEqual(activeReminderReasons({ ...waiting, unansweredSince: null, unansweredMessageId: null }, now), [], 'A public staff reply closes only unanswered');
assert.deepEqual(activeReminderReasons({ ...waiting, unansweredSince: null, unansweredMessageId: null, dueAt: ago(1) }, now), ['overdue']);
const firstSent = { ...empty, unansweredSent: true, lastEnqueuedAt: ago(1) };
assert.deepEqual(nextReminderReasons(waiting, firstSent, now), [], 'Comments do not reset or multiply a waiting reminder');
assert.deepEqual(nextReminderReasons({ ...waiting, dueAt: later(0.5) }, firstSent, now), ['unanswered', 'due_soon'], 'Escalation can arrive before the daily interval');
assert.deepEqual(nextReminderReasons(waiting, { ...firstSent, lastEnqueuedAt: ago(24 - 1 / 3600) }, now), []);
assert.deepEqual(nextReminderReasons(waiting, { ...firstSent, lastEnqueuedAt: ago(24) }, now), ['unanswered'], 'Daily cadence is a rolling 24 hours');
assert.deepEqual(nextReminderReasons(waiting, { ...firstSent, lastEnqueuedAt: ago(240) }, now), ['unanswered'], 'Ten missed days produce one event, not ten');
assert.deepEqual(nextReminderReasons({ ...waiting, dueAt: later(0.5) }, { ...firstSent, dueSoonSent: true }, now), [], 'Moving a deadline away and back does not repeat the stage');
assert.deepEqual(nextReminderReasons(waiting, { ...firstSent, unansweredSent: false }, now), ['unanswered'], 'A new public client episode rearms its waiting stage');
// UTC instants cross evenings/weekends without a business-calendar exclusion.
assert.deepEqual(activeReminderReasons({ ...waiting, dueAt: '2026-11-08T00:00:00Z', unansweredSince: '2026-11-07T21:00:00Z' }, new Date('2026-11-08T01:00:00Z')), ['unanswered', 'overdue']);
const staff = [
  { id: 'a', role: 'agent', status: 'active', userId: 'ua' },
  { id: 'b', role: 'owner', status: 'active', userId: 'ub' },
  { id: 'c', role: 'client', status: 'active', userId: 'uc' },
  { id: 'd', role: 'agent', status: 'invited', userId: null },
  { id: 'e', role: 'agent', status: 'revoked', userId: 'ue' },
];
assert.deepEqual(reminderRecipients(staff, 'a', ['a', 'b', 'c', 'd', 'e']), ['a']);
assert.deepEqual(reminderRecipients(staff, 'e', ['b', 'b', 'c']), ['b']);
assert.deepEqual(reminderRecipients(staff, null, []), [], 'An empty configured set cannot silently notify all staff');

const secret = 'q'.repeat(48); let touches = 0;
const tick = createNotificationTickHandler({ enabled: true, secret, run: async () => { touches++; return { queued: 1 }; } });
const request = (authorization?: string, body: unknown = { invocationId: 'test-1', scheduledAt: now.toISOString() }) => new Request('https://daybook-ticket.vercel.app/api/internal/notification-tick', {
  method: 'POST', headers: authorization ? { authorization } : {}, body: JSON.stringify(body),
});
assert.equal((await tick(request())).status, 401);
assert.equal((await tick(request(`Bearer ${'x'.repeat(48)}`))).status, 401);
assert.equal((await tick(request(`Bearer ${'é'.repeat(48)}`))).status, 401, 'Multibyte headers cannot throw before authorization');
assert.equal(touches, 0, 'Untrusted requests never reach the worker/database dependency');
assert.equal((await tick(request(`Bearer ${secret}`, { invocationId: '../bad', scheduledAt: 'bad' }))).status, 400);
assert.equal((await tick(request(`Bearer ${secret}`, { huge: 'x'.repeat(4200) }))).status, 413);
assert.equal(touches, 0);
assert.equal((await tick(request(`Bearer ${secret}`))).status, 200);
assert.equal(touches, 1);
const off = createNotificationTickHandler({ enabled: false, secret, run: async () => { throw new Error('must not run'); } });
assert.equal((await off(request(`Bearer ${secret}`))).status, 503);
assert.equal((await createNotificationTickHandler({ enabled: true, secret: undefined, run: async () => { throw new Error('must not run'); } })(request())).status, 401);

const config: PingerConfiguration = { enabled: true, environment: 'qa', targetOrigin: 'https://daybook-ticket-qa-example.vercel.app', expectedTriggerId: 'trigger-qa', jobSecret: secret, automationBypassSecret: 'qa-only-bypass' };
const invocation = { version: 1, invocation_id: 'test-native-1', trigger: { id: 'trigger-qa', type: 'schedule', name: 'test' }, data: { scheduled_at: now.toISOString() } };
let calls = 0; let sentHeaders: Headers | undefined;
const pinger = createNotificationPinger(config, { fetch: async (url, init) => {
  calls++; assert.equal(String(url), `${config.targetOrigin}/api/internal/notification-tick`);
  assert.equal(init?.redirect, 'manual'); sentHeaders = new Headers(init?.headers);
  assert.equal(sentHeaders.get('authorization'), `Bearer ${secret}`);
  assert.equal(sentHeaders.get('x-vercel-protection-bypass'), config.automationBypassSecret);
  assert.equal(sentHeaders.get('cookie'), null);
  assert.deepEqual(JSON.parse(String(init?.body)), { invocationId: invocation.invocation_id, scheduledAt: now.toISOString() });
  return Response.json({ ok: true });
} });
const nativeRequest = (body: unknown = invocation, id?: string) => new Request('https://branch-pinger.compute.cell.us-east-1.aws.neon.tech/tick', {
  method: 'POST', headers: id ? { 'x-neon-trigger-invocation-id': id, cookie: 'do-not-forward=this', authorization: 'do-not-forward' } : {}, body: JSON.stringify(body),
});
assert.equal((await pinger(nativeRequest())).status, 401);
assert.equal((await pinger(nativeRequest({ ...invocation, trigger: { id: 'other', type: 'schedule' } }, invocation.invocation_id))).status, 401);
assert.equal((await pinger(nativeRequest({ ...invocation, trigger: { id: 'trigger-qa', type: 'storage_object_created' } }, invocation.invocation_id))).status, 401);
assert.equal(calls, 0);
// This simulates the already-trusted Neon proxy. A separate deployed edge test verifies stripping.
assert.equal((await pinger(nativeRequest(invocation, invocation.invocation_id))).status, 200);
assert.equal(calls, 1);
for (const upstream of [302, 401, 429, 500]) {
  const failing = createNotificationPinger(config, { fetch: async () => new Response(null, { status: upstream }) });
  const response = await failing(nativeRequest(invocation, invocation.invocation_id));
  assert.equal(response.status, 503); assert.equal(response.headers.get('retry-after'), '60');
}
const timeout = createNotificationPinger(config, { fetch: async () => { throw new DOMException('timeout', 'TimeoutError'); } });
assert.equal((await timeout(nativeRequest(invocation, invocation.invocation_id))).status, 503);
assert.throws(() => createNotificationPinger({ ...config, targetOrigin: 'https://daybook-ticket.vercel.app' }), /mismatch/);
assert.throws(() => createNotificationPinger({ ...config, environment: 'production', targetOrigin: 'https://daybook-ticket.vercel.app' }), /mismatch/);
assert.throws(() => createNotificationPinger({ ...config, targetOrigin: 'https://attacker.example/tick' }), /origin/);
assert.throws(() => createNotificationPinger({ ...config, targetOrigin: `${config.targetOrigin}/?secret=bad` }), /origin/);
console.log('Recordatorios: etapas agrupadas, reloj 24/7, diaria móvil, permisos; scheduler: auth antes de DB, aislamiento y reintentos verificados sin red.');
