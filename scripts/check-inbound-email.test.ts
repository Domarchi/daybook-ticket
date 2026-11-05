import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildMailPayload, readFrozenMailPayload } from '../lib/mail-templates';
import { retrieveInboundEmail } from '../lib/inbound-email';
import {
  InvalidInboundEmail, htmlToInboundText, inboundConfiguration, inboundPayloadHash, inboundRejection,
  makeInboundAddress, normalizeInboundWebhook, normalizeReceivedEmail, parseInboundRoute, unquotedInboundText, validInboundRoute,
} from '../lib/inbound-email-validation';
import { InvalidDeliveryWebhook, verifyDeliverySignature } from '../lib/mail-delivery-validation';
import { withoutQuotedDaybookLogos, DAYBOOK_MAIL_LOGO_BYTES } from '../lib/inbound-email-logo';

const now = new Date('2026-11-05T12:00:00.000Z');
const memberId = '11111111-1111-4111-8111-111111111111';
const outboxId = '22222222-2222-4222-8222-222222222222';
const providerId = '33333333-3333-4333-8333-333333333333';
const scope = { id: memberId, kind: 'new' as const, ownerId: 'qa-owner', memberId, email: 'client@example.test' };
const config = inboundConfiguration({ DAYBOOK_INBOUND_ENABLED: 'true', DAYBOOK_INBOUND_DOMAIN: 'fictional.resend.app', DAYBOOK_INBOUND_TOKEN_SECRET: 'fictional-token-secret-only-qa-32bytes', RESEND_INBOUND_API_KEY: 'fictional-not-valid-key', RESEND_INBOUND_WEBHOOK_SECRET: `whsec_${Buffer.from('fictional-inbound-webhook-32bytes').toString('base64')}`, DAYBOOK_NOTIFICATION_ENVIRONMENT: 'qa' });
const address = makeInboundAddress(scope, config)!;
function rawEvent() { return Buffer.from(JSON.stringify({ type: 'email.received', created_at: now.toISOString(), data: { email_id: providerId, from: 'QA client <client@example.test>', to: [address], subject: 'Solicitud de prueba #9999' } })); }
function envelope() { return normalizeInboundWebhook(rawEvent(), 'msg_qa_inbound', now)!; }
function providerEmail() { return { id: providerId, from: 'QA client <client@example.test>', to: [address], subject: 'Solicitud de prueba #9999', text: 'Necesito ayuda con el acceso.\n\nOn Tue, QA wrote:\n> Old quoted text', html: null, headers: { 'auto-submitted': 'no' }, authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' }, attachments: [] }; }

test('inbound is opt-in and requires independent complete configuration', () => {
  assert.equal(inboundConfiguration({}).enabled, false);
  assert.equal(inboundConfiguration({ DAYBOOK_INBOUND_ENABLED: 'true', DAYBOOK_INBOUND_DOMAIN: 'https://unsafe.example.test', DAYBOOK_INBOUND_TOKEN_SECRET: 'short' }).enabled, false);
  assert.equal(makeInboundAddress(scope, { ...config, enabled: false }), null);
  assert.equal(makeInboundAddress({ ...scope, id: 'not-a-member-id' }, config), null);
  assert.equal(config.enabled, true);
});

test('new and reply capabilities are bounded and bound to account, email, owner, kind and environment', () => {
  assert.ok(address.split('@')[0].length <= 64);
  const route = parseInboundRoute(address, config)!;
  assert.equal(route.id, memberId); assert.equal(route.kind, 'new'); assert.equal(validInboundRoute(route, scope, config), true);
  for (const changed of [{ ...scope, memberId: outboxId }, { ...scope, ownerId: 'foreign-owner' }, { ...scope, email: 'other@example.test' }]) assert.equal(validInboundRoute(route, changed, config), false);
  for (const changed of [{ ...config, environment: 'production' as const }, { ...config, domain: 'other.resend.app' }, { ...config, tokenSecret: 'another-fictional-token-secret-32bytes' }]) assert.equal(validInboundRoute(route, scope, changed), false);
  assert.equal(parseInboundRoute(address.replace('@fictional.resend.app', '@foreign.example.test'), config), null);
  assert.equal(parseInboundRoute('support+9999@fictional.resend.app', config), null, 'A subject/ticket-number address is never an authorization capability.');
  const reply = makeInboundAddress({ ...scope, id: outboxId, kind: 'reply' }, config)!;
  assert.equal(parseInboundRoute(reply, config)!.kind, 'reply');
  assert.equal(validInboundRoute({ ...route, kind: 'reply' }, scope, config), false);
});

test('the receiving webhook authenticates exact signed bytes and rejects tampering', () => {
  const raw = rawEvent(), timestamp = String(now.getTime() / 1000), id = 'msg_qa_inbound';
  const signature = createHmac('sha256', Buffer.from(config.webhookSecret.slice(6), 'base64')).update(`${id}.${timestamp}.`).update(raw).digest('base64');
  const headers = new Headers({ 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` });
  assert.equal(verifyDeliverySignature(raw, headers, config.webhookSecret, now.getTime()), id);
  assert.throws(() => verifyDeliverySignature(Buffer.concat([raw, Buffer.from(' ')]), headers, config.webhookSecret, now.getTime()), InvalidDeliveryWebhook);
  assert.throws(() => verifyDeliverySignature(raw, new Headers(), config.webhookSecret, now.getTime()), InvalidDeliveryWebhook);
  assert.equal(normalizeInboundWebhook(Buffer.from('{"type":"email.delivered"}'), id, now), null);
  assert.throws(() => normalizeInboundWebhook(Buffer.from('{bad-json'), id, now), InvalidInboundEmail);
});

test('the authenticated provider response must match the signed envelope exactly', () => {
  const input = envelope();
  const email = normalizeReceivedEmail(providerEmail(), input);
  assert.equal(email.from, scope.email); assert.equal(email.text, 'Necesito ayuda con el acceso.');
  assert.equal(inboundRejection(email), null);
  for (const change of [{ id: outboxId }, { from: 'spoof@example.test' }, { to: ['foreign@example.test'] }, { subject: 'Different provider payload' }]) assert.throws(() => normalizeReceivedEmail({ ...providerEmail(), ...change }, input), InvalidInboundEmail);
  assert.notEqual(inboundPayloadHash(email), inboundPayloadHash({ ...email, text: 'Changed content' }));
  assert.equal(inboundPayloadHash(email), inboundPayloadHash({ ...email, headers: { ...email.headers } }));
});

test('a forged Authentication-Results header cannot replace the receiving server DMARC verdict', () => {
  for (const authentication of [null, { spf: 'pass', dkim: 'pass', dmarc: 'fail' }, { dmarc: 'gray' }, { spf: 'pass', dkim: 'gray', dmarc: 'gray' }, { spf: 'pass', dkim: 'fail', dmarc: 'gray' }, { dmarc: 'unknown' }]) {
    const email = normalizeReceivedEmail({ ...providerEmail(), authentication, headers: { 'Authentication-Results': 'forged; dmarc=pass; dkim=pass' } }, envelope());
    assert.equal(inboundRejection(email), 'authentication_required');
  }
  const alignedDkim = normalizeReceivedEmail({ ...providerEmail(), authentication: { spf: 'pass', dkim: 'pass', dmarc: 'gray' } }, envelope());
  assert.equal(inboundRejection(alignedDkim), null, 'A receiving-server aligned DKIM pass permits a DMARC p=none policy, while the opaque capability and exact From checks remain required.');
});

test('auto-replies, reports, empty content and incoming files are explicitly rejected', () => {
  const email = normalizeReceivedEmail(providerEmail(), envelope());
  const automaticHeaders: Record<string, string>[] = [{ 'auto-submitted': 'auto-replied' }, { precedence: 'bulk' }, { 'list-id': 'list.example.test' }, { 'content-type': 'multipart/report' }, { 'return-path': '<>' }];
  for (const headers of automaticHeaders) assert.equal(inboundRejection({ ...email, headers }), 'automatic_message');
  assert.equal(inboundRejection({ ...email, text: '' }), 'empty_message');
  assert.equal(inboundRejection({ ...email, attachments: [{ id: outboxId, name: 'qa.txt', contentType: 'text/plain', size: 10 }] }), 'attachments_use_portal');
});

test('HTML-only mail becomes inert plain text, quoted content is removed and sizes are enforced', () => {
  assert.equal(htmlToInboundText('<head><style>bad</style></head><div>Hola &amp; ayuda</div><script>alert(1)</script><p>&#x1f44b;</p>'), 'Hola & ayuda\n👋');
  assert.equal(unquotedInboundText('Texto nuevo\n\nEl martes, QA escribió:\nTexto antiguo'), 'Texto nuevo');
  const email = normalizeReceivedEmail({ ...providerEmail(), text: null, html: '<p>Hola</p><p>Texto &lt;script&gt; como texto.</p>' }, envelope());
  assert.equal(email.text, 'Hola\nTexto <script> como texto.');
  assert.throws(() => normalizeReceivedEmail({ ...providerEmail(), text: 'a'.repeat(20001) }, envelope()), InvalidInboundEmail);
});

test('provider retrieval uses only the fixed endpoint, no redirects and bounded response bytes', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++; assert.equal(url, `https://api.resend.com/emails/receiving/${providerId}?html_format=cid`);
    assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store');
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${config.apiKey}`);
    return Response.json(providerEmail());
  };
  assert.deepEqual(await retrieveInboundEmail(providerId, config, fetcher), providerEmail());
  await assert.rejects(retrieveInboundEmail('../foreign-url', config, fetcher), InvalidInboundEmail); assert.equal(calls, 1);
  await assert.rejects(retrieveInboundEmail(providerId, config, async () => new Response('x', { headers: { 'Content-Length': '999999999' } })), InvalidInboundEmail);
  await assert.rejects(retrieveInboundEmail(providerId, config, async () => new Response(Buffer.alloc(2 * 1024 * 1024 + 1), { headers: { 'Content-Length': '1' } })), InvalidInboundEmail);
});

test('only the byte-identical inline Daybook logo may be omitted from quoted email replies', async () => {
  const email = { ...normalizeReceivedEmail(providerEmail(), envelope()), attachments: [{ id: outboxId, name: 'daybook.png', contentType: 'image/png', size: DAYBOOK_MAIL_LOGO_BYTES, disposition: 'inline' }] };
  const logo = readFileSync(new URL('../public/icons/daybook-192.png', import.meta.url));
  const download = `https://inbound-cdn.resend.com/${providerId}/attachments/${outboxId}?signature=fictional`;
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++; assert.equal(init?.redirect, 'error');
    if (String(url).startsWith('https://api.resend.com/')) return Response.json({ id: outboxId, filename: 'daybook.png', size: logo.length, content_type: 'image/png', content_disposition: 'inline', download_url: download });
    assert.equal(url, download); assert.equal(init?.headers, undefined, 'Do not send the provider API credential to the CDN.'); return new Response(logo);
  };
  assert.deepEqual((await withoutQuotedDaybookLogos(email, config, fetcher)).attachments, []); assert.equal(calls, 2);
  const changed: typeof fetch = async (url, init) => String(url).startsWith('https://api.resend.com/') ? fetcher(url, init) : new Response(Buffer.alloc(logo.length));
  assert.equal((await withoutQuotedDaybookLogos(email, config, changed)).attachments.length, 1, 'Same filename/MIME/length does not authorize discarding a user file.');
  let unexpected = false;
  const noNetwork: typeof fetch = async () => { unexpected = true; throw new Error('Unexpected file fetch'); };
  assert.equal((await withoutQuotedDaybookLogos({ ...email, attachments: [{ ...email.attachments[0], disposition: 'attachment' }] }, config, noNetwork)).attachments.length, 1); assert.equal(unexpected, false);
  const unsafe: typeof fetch = async () => Response.json({ id: outboxId, filename: 'daybook.png', size: logo.length, content_type: 'image/png', content_disposition: 'inline', download_url: 'http://127.0.0.1/private' });
  await assert.rejects(withoutQuotedDaybookLogos(email, config, unsafe), InvalidInboundEmail);
});

test('only new reply-capable payloads change footer; already frozen payload bytes retain their content', () => {
  const input = { id: outboxId, environment: 'qa' as const, event: 'agent_replied' as const, ticketId: 6, from: 'mail@example.test', to: scope.email, url: 'https://qa.example.test/?ticket=6' };
  const legacy = buildMailPayload(input), reply = buildMailPayload({ ...input, replyTo: makeInboundAddress({ ...scope, id: outboxId, kind: 'reply' }, config)! });
  assert.equal(legacy.reply_to, undefined); assert.match(legacy.text, /no se incorporan/);
  assert.match(reply.reply_to!, /^r-/); assert.match(reply.text, /Puedes responder a este correo/); assert.doesNotMatch(reply.text, /no se incorporan/);
  const frozen = JSON.stringify(legacy);
  assert.deepEqual(readFrozenMailPayload(frozen), legacy); assert.equal(JSON.stringify(readFrozenMailPayload(frozen)), frozen);
  assert.equal(buildMailPayload({ ...input, replyTo: 'bad\r\nBcc:private@example.test' }).reply_to, undefined);
  for (const event of ['escalation', 'satisfaction_requested'] as const) {
    const payload = buildMailPayload({ ...input, event }); assert.ok(payload.html?.includes('DAYBOOK')); assert.match(payload.text, /#6/);
  }
});

test('the HTTP receiver rejects unsigned requests and ignores foreign mail before any database or provider access', async () => {
  const keys = ['DAYBOOK_INBOUND_ENABLED', 'DAYBOOK_INBOUND_WEBHOOK_MODE', 'DAYBOOK_INBOUND_DOMAIN', 'DAYBOOK_INBOUND_TOKEN_SECRET', 'RESEND_INBOUND_API_KEY', 'RESEND_INBOUND_WEBHOOK_SECRET', 'DAYBOOK_NOTIFICATION_ENVIRONMENT', 'DATABASE_URL'] as const;
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, { DAYBOOK_INBOUND_ENABLED: 'true', DAYBOOK_INBOUND_DOMAIN: config.domain, DAYBOOK_INBOUND_TOKEN_SECRET: config.tokenSecret,
      RESEND_INBOUND_API_KEY: config.apiKey, RESEND_INBOUND_WEBHOOK_SECRET: config.webhookSecret, DAYBOOK_NOTIFICATION_ENVIRONMENT: 'qa' });
    delete process.env.DAYBOOK_INBOUND_WEBHOOK_MODE;
    delete process.env.DATABASE_URL;
    const { POST } = await import('../app/api/webhooks/resend/inbound/route');
    assert.equal((await POST(new Request('https://qa.example.test/api/webhooks/resend/inbound', { method: 'POST', body: rawEvent() }))).status, 400);
    const timestamp = String(Math.floor(Date.now() / 1000)), id = 'msg_foreign_qa';
    const raw = Buffer.from(JSON.stringify({ type: 'email.received', created_at: new Date().toISOString(), data: { email_id: providerId, from: 'client@example.test', to: ['foreign@unrelated.resend.app'], subject: 'Foreign' } }));
    const signature = createHmac('sha256', Buffer.from(config.webhookSecret.slice(6), 'base64')).update(`${id}.${timestamp}.`).update(raw).digest('base64');
    const foreign = await POST(new Request('https://qa.example.test/api/webhooks/resend/inbound', { method: 'POST', body: raw, headers: { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` } }));
    assert.equal(foreign.status, 200); assert.deepEqual(await foreign.json(), { received: true });
    process.env.DAYBOOK_INBOUND_ENABLED = 'false';
    assert.equal((await POST(new Request('https://qa.example.test/api/webhooks/resend/inbound', { method: 'POST', body: rawEvent() }))).status, 503);
  } finally {
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
});
