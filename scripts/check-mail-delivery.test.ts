import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildMailPayload, escapeMailHtml, readFrozenMailPayload } from '../lib/mail-templates';
import { REMINDER_REASON_LABELS } from '../lib/reminders-policy';
import { InvalidDeliveryWebhook, normalizeDeliveryWebhook, projectDeliveryEvents, readWebhookBody, verifyDeliverySignature } from '../lib/mail-delivery-validation';

const now = new Date('2026-11-04T18:00:00.000Z');
const id = 'msg_daybook_qa_only';
const secret = `whsec_${Buffer.from('daybook-fictional-webhook-key-32b').toString('base64')}`;
const timestamp = String(now.getTime() / 1000);
const outboxId = '6240478e-151e-4734-b3e7-ee58464373e2';
const providerId = 'qa-provider-only';
function rawEvent(type = 'email.delivered', tags: unknown = { app: 'daybook_ticket', environment: 'qa', outbox_id: outboxId }) {
  return Buffer.from(JSON.stringify({ type, created_at: now.toISOString(), data: { email_id: providerId, from: 'Daybook QA <mail@example.test>', to: ['client@example.test'], tags, subject: 'must never persist', message: 'private raw body' } }));
}
function signedHeaders(raw: Buffer, time = timestamp) {
  const signature = createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`${id}.${time}.`).update(raw).digest('base64');
  return new Headers({ 'svix-id': id, 'svix-timestamp': time, 'svix-signature': `v1,${signature}` });
}

test('Svix official independent test vector verifies over exact raw bytes', () => {
  const raw = Buffer.from('{"event_type":"ping","data":{"success":true}}');
  const headers = new Headers({ 'svix-id': 'msg_loFOjxBNrRLzqYUf', 'svix-timestamp': '1731705121', 'svix-signature': 'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=' });
  assert.equal(verifyDeliverySignature(raw, headers, 'whsec_plJ3nmyCDGBKInavdOK15jsl', 1731705121_000), 'msg_loFOjxBNrRLzqYUf');
});

test('webhook authentication rejects mutation, stale/future timestamps and forged headers', () => {
  const raw = rawEvent(), headers = signedHeaders(raw);
  assert.equal(verifyDeliverySignature(raw, headers, secret, now.getTime()), id);
  assert.throws(() => verifyDeliverySignature(Buffer.concat([raw, Buffer.from(' ')]), headers, secret, now.getTime()), InvalidDeliveryWebhook);
  for (const offset of [-301, 301]) {
    const time = String(Number(timestamp) + offset);
    assert.throws(() => verifyDeliverySignature(raw, signedHeaders(raw, time), secret, now.getTime()), InvalidDeliveryWebhook);
  }
  for (const [name, value] of [['svix-id', '../escape'], ['svix-timestamp', 'NaN'], ['svix-signature', 'v1,forged'], ['svix-signature', 'x'.repeat(5000)]]) {
    const changed = new Headers(headers); changed.set(name, value);
    assert.throws(() => verifyDeliverySignature(raw, changed, secret, now.getTime()), InvalidDeliveryWebhook);
  }
  assert.throws(() => verifyDeliverySignature(raw, headers, 'whsec_?', now.getTime()), InvalidDeliveryWebhook);
});

test('signature rotation permits any valid v1 signature, never unsupported versions', () => {
  const raw = rawEvent(), headers = signedHeaders(raw);
  headers.set('svix-signature', `v2,${'A'.repeat(43)}= v1,${'A'.repeat(43)}= ${headers.get('svix-signature')}`);
  assert.equal(verifyDeliverySignature(raw, headers, secret, now.getTime()), id);
});

test('stream limits enforce actual bytes rather than trusting Content-Length', async () => {
  assert.deepEqual(await readWebhookBody(new Request('https://qa.example.test', { method: 'POST', body: rawEvent() })), rawEvent());
  await assert.rejects(readWebhookBody(new Request('https://qa.example.test', { method: 'POST', body: 'a', headers: { 'Content-Length': '300000' } })), InvalidDeliveryWebhook);
  await assert.rejects(readWebhookBody(new Request('https://qa.example.test', { method: 'POST', body: Buffer.alloc(300000), headers: { 'Content-Length': '1' } })), InvalidDeliveryWebhook);
});

test('only exact application/environment scope is correlated, shared-account and read trackers are ignored', () => {
  const event = normalizeDeliveryWebhook(rawEvent(), id, 'qa', now)!;
  assert.equal(event.outboxId, outboxId); assert.equal(event.environment, 'qa');
  assert.equal(event.from, 'mail@example.test'); assert.deepEqual(event.to, ['client@example.test']);
  assert.equal(event.payloadHash.length, 64);
  assert.equal(Object.hasOwn(event, 'subject'), false); assert.equal(Object.hasOwn(event, 'message'), false);
  for (const tags of [{ app: 'consorcio', environment: 'qa', outbox_id: outboxId }, { app: 'daybook_ticket', environment: 'production', outbox_id: outboxId }, { app: 'daybook_ticket' }, { outbox_id: outboxId }]) {
    assert.equal(normalizeDeliveryWebhook(rawEvent('email.delivered', tags), id, 'qa', now), null);
  }
  for (const type of ['email.opened', 'email.clicked', 'email.received', 'domain.updated']) assert.equal(normalizeDeliveryWebhook(rawEvent(type), id, 'qa', now), null);
  const legacy = JSON.parse(rawEvent().toString()); delete legacy.data.tags;
  const orphan = normalizeDeliveryWebhook(Buffer.from(JSON.stringify(legacy)), id, 'qa', now)!;
  assert.equal(orphan.outboxId, null); assert.equal(orphan.environment, null);
});

test('malformed delivery payloads cannot enter the receipt store', () => {
  for (const body of ['bad JSON', JSON.stringify({ type: 'email.delivered', data: {} })]) assert.throws(() => normalizeDeliveryWebhook(Buffer.from(body), id, 'qa', now), InvalidDeliveryWebhook);
  const bad = JSON.parse(rawEvent().toString()); bad.data.to.push('another@example.test');
  assert.throws(() => normalizeDeliveryWebhook(Buffer.from(JSON.stringify(bad)), id, 'qa', now), InvalidDeliveryWebhook);
});

test('delivery projection is idempotent and independent of arrival order', () => {
  const events = [
    { eventType: 'email.sent' as const, occurredAt: '2026-11-04T17:00:00.000Z' },
    { eventType: 'email.delivered' as const, occurredAt: '2026-11-04T17:01:00.000Z' },
    { eventType: 'email.delivery_delayed' as const, occurredAt: '2026-11-04T17:02:00.000Z' },
    { eventType: 'email.bounced' as const, occurredAt: '2026-11-04T17:03:00.000Z' },
    { eventType: 'email.complained' as const, occurredAt: '2026-11-04T17:04:00.000Z' },
  ];
  const expected = projectDeliveryEvents(events);
  assert.deepEqual(projectDeliveryEvents([...events].reverse()), expected);
  assert.deepEqual(projectDeliveryEvents([...events, ...events]), expected);
  assert.equal(expected.deliveryStatus, 'complained'); assert.equal(expected.deliveredAt, events[1].occurredAt);
  assert.equal(expected.bouncedAt, events[3].occurredAt); assert.equal(expected.complainedAt, events[4].occurredAt);
  assert.equal(projectDeliveryEvents(events.slice(0, 3)).deliveryStatus, 'delivered');
  assert.equal(projectDeliveryEvents([]).deliveryStatus, 'untracked');
});

test('all supported notification templates have HTML, text, existing CID logo and frozen routing tags', () => {
  for (const event of ['ticket_created', 'agent_replied', 'client_replied', 'invitation', 'password_reset', 'reminder', 'escalation', 'satisfaction_requested'] as const) {
    const payload = buildMailPayload({ id: outboxId, environment: 'qa', event, ticketId: 123, from: 'QA <mail@example.test>', to: 'client@example.test', url: 'https://daybook-qa.example.test/?ticket=123', metadata: { subject: 'Solicitud de acceso', status: 'open', priority: 'high', dueAt: now.toISOString() } });
    assert.match(payload.html!, /DAYBOOK/); assert.match(payload.html!, /cid:daybook-brand-v2/);
    assert.match(payload.html!, /width="48" height="48"/); assert.match(payload.text, /portal/);
    assert.match(payload.text, /#123/); assert.match(payload.html!, /Estado/);
    assert.match(payload.html!, /Asunto/); assert.match(payload.html!, /Solicitud de acceso/); assert.match(payload.text, /Asunto: Solicitud de acceso/);
    assert.deepEqual(payload.tags, [{ name: 'app', value: 'daybook_ticket' }, { name: 'environment', value: 'qa' }, { name: 'outbox_id', value: outboxId }]);
    assert.equal(payload.attachments!.length, 1);
    assert.deepEqual(Buffer.from(payload.attachments![0].content, 'base64'), readFileSync(new URL('../public/icons/daybook-192.png', import.meta.url)));
    assert.doesNotMatch(payload.html!, /<script|https?:[^"\s]+\.(?:png|jpg)|fonts\.google/i);
  }
});

test('ticket subject is escaped, while message excerpts, notes and files remain excluded', () => {
  assert.equal(escapeMailHtml('<img a="x">&\''), '&lt;img a=&quot;x&quot;&gt;&amp;&#39;');
  const subject = 'Acceso <script>alert("QA")</script> & oficina';
  const metadata = { subject, status: '<img onerror=bad>', priority: 'invalid-priority-secret', body: 'private-conversation-excerpt', note: 'private-internal-note', files: ['private-attachment-name.pdf'] };
  const payload = buildMailPayload({ id: randomUUID(), environment: 'qa', event: 'ticket_created', ticketId: 1, from: 'QA <mail@example.test>', to: 'client@example.test', url: 'https://qa.example.test/?x="<&', metadata });
  assert.match(payload.html!, /Acceso &lt;script&gt;alert\(&quot;QA&quot;\)&lt;\/script&gt; &amp; oficina/);
  assert.ok(payload.text.includes(`Asunto: ${subject}`));
  for (const content of [payload.html!, payload.text]) assert.doesNotMatch(content, /onerror|invalid-priority-secret|private-conversation-excerpt|private-internal-note|private-attachment-name/);
  assert.doesNotMatch(payload.html!, /<script>/);
  assert.match(payload.html!, /&quot;&lt;&amp;/);
  assert.equal(payload.attachments![0].filename, 'daybook.png');
});

test('reminder templates include only fixed server reasons and deduplicate repeated motives', () => {
  const safe = Object.values(REMINDER_REASON_LABELS);
  const metadata = { subject: 'Revisar servicio', reasons: [...safe, safe[0], '<script>unsafe-reason</script>', 'private-note-as-reason'] };
  const input = { id: outboxId, environment: 'qa' as const, ticketId: 12, from: 'QA <mail@example.test>', to: 'agent@example.test', url: 'https://qa.example.test/?ticket=12', metadata };
  const payload = buildMailPayload({ ...input, event: 'reminder' });
  for (const reason of safe) {
    assert.equal(payload.text.split(reason).length - 1, 1);
    assert.ok(payload.html!.includes(escapeMailHtml(reason)));
  }
  assert.match(payload.text, /Motivo:/);
  assert.doesNotMatch(payload.text + payload.html, /unsafe-reason|private-note-as-reason/);
  const ordinary = buildMailPayload({ ...input, event: 'ticket_created' });
  assert.doesNotMatch(ordinary.text, /Motivo:/);
});

test('legacy frozen payload validation retains all content and byte serialization', () => {
  const raw = '{ "from":"QA <mail@example.test>","to":["client@example.test"],"subject":"Old subject","text":"Old body\\n  exact","unknown":{"keep":true} }';
  const payload = readFrozenMailPayload(raw)!;
  assert.equal(payload.text, 'Old body\n  exact'); assert.equal(payload.html, undefined);
  assert.deepEqual(JSON.parse(raw), payload);
  for (const invalid of ['{}', 'null', '{"from":"x","to":[],"text":"x","subject":"x"}']) assert.equal(readFrozenMailPayload(invalid), null);
});
