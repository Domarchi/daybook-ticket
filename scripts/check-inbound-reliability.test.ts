import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Database } from '../db/database';
import { htmlToInboundText, normalizeInboundBody, unquotedInboundText } from '../lib/inbound-email-content';
import { downloadInboundAttachments } from '../lib/inbound-email-imports';
import {
  classifyInboundFailure,
  drainInboundMailJobs,
  inboundEnvelopeHash,
  publicInboundJob,
  type InboundJob,
} from '../lib/inbound-email-jobs';
import { InboundRejectError, InboundRetryError } from '../lib/inbound-email-errors';
import {
  inboundConfiguration,
  InvalidInboundEmail,
  makeInboundAddress,
  normalizeReceivedEmail,
  parseInboundRoute,
} from '../lib/inbound-email-validation';
import { ingestInboundEmail } from '../lib/inbound-email';
import { withoutQuotedDaybookLogos, DAYBOOK_MAIL_LOGO_BYTES } from '../lib/inbound-email-logo';
import { createResendWebhookHandlers } from '../lib/resend-webhook-handlers';
import { resolveInboundPrivateFile } from '../lib/inbound-email-storage';
import { readAttachmentBytes } from '../lib/attachments-storage';

const id = randomUUID(),
  fileId = randomUUID(),
  memberId = randomUUID();
const config = inboundConfiguration({
  DAYBOOK_INBOUND_ENABLED: 'true',
  DAYBOOK_INBOUND_DOMAIN: 'fictional.resend.app',
  DAYBOOK_INBOUND_TOKEN_SECRET: 'fictional-private-route-only-32-characters',
  RESEND_INBOUND_API_KEY: 'fictional-api-key',
  RESEND_INBOUND_WEBHOOK_SECRET: `whsec_${Buffer.from('fictional-webhook-signing-key-32').toString('base64')}`,
  DAYBOOK_NOTIFICATION_ENVIRONMENT: 'qa',
});
const address = makeInboundAddress(
  { kind: 'new', id: memberId, memberId, ownerId: 'fictional-owner', email: 'client@example.test' },
  config,
)!;
const envelope = {
  providerId: id,
  webhookId: 'msg_fictional',
  from: 'client@example.test',
  to: [address],
  subject: 'Fictional subject',
  createdAt: new Date().toISOString(),
};
const file = { id: fileId, name: 'request.txt', contentType: 'text/plain', size: 5, disposition: null };
const email = {
  id,
  from: envelope.from,
  to: envelope.to,
  subject: envelope.subject,
  text: 'New text',
  headers: {},
  authenticated: true,
  attachments: [file],
};
const metadata = {
  id: fileId,
  filename: file.name,
  content_type: file.contentType,
  size: 5,
  content_disposition: null,
  download_url: `https://cdn.resend.app/receiving/${id}/attachments/${fileId}?signature=fictional`,
};

test('plain and HTML reply cleanup handles multiline Gmail and Outlook without removing ordinary text/quotes', () => {
  assert.equal(
    unquotedInboundText(
      'New response\n\nOn Thursday, 5 Nov 2026,\nSupport <mail@example.test>\nwrote:\n> Old response',
    ),
    'New response',
  );
  assert.equal(
    unquotedInboundText(
      'Respuesta nueva\n\nEl jueves, 5 de noviembre de 2026,\nSoporte <mail@example.test> escribió:\nRespuesta antigua',
    ),
    'Respuesta nueva',
  );
  assert.equal(
    unquotedInboundText('New response\n\nFrom: Support\nSent: Thursday\nTo: Client\nSubject: Original\nOld body'),
    'New response',
  );
  assert.equal(
    unquotedInboundText('El cliente escribió:\nNecesito ayuda con la factura.'),
    'El cliente escribió:\nNecesito ayuda con la factura.',
  );
  assert.equal(
    normalizeInboundBody(
      null,
      '<p>Respuesta nueva</p><div class="gmail_quote gmail_quote_container">Viejo texto</div>',
    ),
    'Respuesta nueva',
  );
  assert.equal(normalizeInboundBody(null, '<p>New response</p><div id="divRplyFwdMsg">Old body</div>'), 'New response');
  assert.equal(
    normalizeInboundBody(null, '<p>My quote:</p><blockquote>literal example</blockquote>'),
    'My quote:\nliteral example',
  );
  assert.equal(normalizeInboundBody('plain wins', '<div class="gmail_quote">html quote</div>'), 'plain wins');
  assert.equal(
    htmlToInboundText('<head>hidden</head><p>Hello &amp; help</p><script>bad()</script><!-- hidden -->'),
    'Hello & help',
  );
  assert.equal(normalizeInboundBody(null, '<div '.repeat(100000)), '<div '.repeat(100000).trim());
});

test('provider-normalized body uses the multiline cleanup while preserving the exact envelope contract', () => {
  const normalized = normalizeReceivedEmail(
    {
      id,
      from: envelope.from,
      to: envelope.to,
      subject: envelope.subject,
      text: 'Nuevo\n\nEl jue, 5 nov 2026,\nSupport <a@example.test> escribió:\n> anterior',
      html: null,
      headers: {},
      attachments: [],
      authentication: { dmarc: 'pass' },
    },
    envelope,
  );
  assert.equal(normalized.text, 'Nuevo');
});

test('incoming files use authenticated fixed metadata, credential-free exact CDN paths and actual content validation', async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push(String(url));
    assert.equal(init?.redirect, 'error');
    if (String(url).startsWith('https://api.resend.com/')) {
      assert.equal(url, `https://api.resend.com/emails/receiving/${id}/attachments/${fileId}`);
      assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${config.apiKey}`);
      return Response.json(metadata);
    }
    assert.equal(url, metadata.download_url);
    assert.equal(init?.headers, undefined);
    return new Response('hello');
  };
  const result = await downloadInboundAttachments(email, config, fetcher);
  assert.equal(result.length, 1);
  assert.equal(result[0].bytes.toString(), 'hello');
  assert.equal(result[0].contentType, 'text/plain');
  assert.match(result[0].hash, /^[a-f0-9]{64}$/);
  assert.equal(calls.length, 2);
  await assert.rejects(
    downloadInboundAttachments(email, config, async url =>
      String(url).startsWith('https://api.resend.com/')
        ? Response.json(metadata)
        : new Response(Buffer.from([0, 1, 2, 3, 4])),
    ),
    error => error instanceof InboundRejectError && error.message === 'attachment_invalid',
  );
});

test('unsupported files, count/size excess, changed metadata and unsafe CDN URLs stop before storage', async () => {
  let calls = 0;
  const noNetwork: typeof fetch = async () => {
    calls++;
    throw new Error('Must not call network.');
  };
  for (const attachments of [
    [{ ...file, name: 'malware.exe' }],
    [{ ...file, size: 10485761 }],
    Array.from({ length: 6 }, () => file),
  ]) {
    await assert.rejects(downloadInboundAttachments({ ...email, attachments }, config, noNetwork), InboundRejectError);
  }
  assert.equal(calls, 0);
  let downloads = 0;
  for (const change of [
    { id: randomUUID() },
    { size: 6 },
    { content_type: 'application/pdf' },
    { filename: 'changed.txt' },
  ]) {
    await assert.rejects(
      downloadInboundAttachments(email, config, async url => {
        if (String(url).startsWith('https://api.resend.com/')) return Response.json({ ...metadata, ...change });
        downloads++;
        throw new Error('No download permitted.');
      }),
      InboundRejectError,
    );
  }
  await assert.rejects(
    downloadInboundAttachments(email, config, async url => {
      if (String(url).startsWith('https://api.resend.com/'))
        return Response.json({ ...metadata, download_url: 'https://attacker.test/private' });
      downloads++;
      throw new Error('No download permitted.');
    }),
    InvalidInboundEmail,
  );
  assert.equal(downloads, 0);
});

test('an exact quoted public logo is omitted independently of a genuine customer attachment', async () => {
  const logoId = randomUUID(),
    logo = readFileSync(new URL('../public/icons/daybook-192.png', import.meta.url));
  const mixed = {
    ...email,
    attachments: [
      file,
      {
        id: logoId,
        name: 'daybook.png',
        contentType: 'image/png',
        size: DAYBOOK_MAIL_LOGO_BYTES,
        disposition: 'inline',
      },
    ],
  };
  const result = await withoutQuotedDaybookLogos(mixed, config, async url => {
    if (String(url).startsWith('https://api.resend.com/'))
      return Response.json({
        id: logoId,
        filename: 'daybook.png',
        content_type: 'image/png',
        size: logo.length,
        content_disposition: 'inline',
        download_url: `https://cdn.resend.app/receiving/${id}/attachments/${logoId}?sig=fake`,
      });
    return new Response(logo);
  });
  assert.deepEqual(result.attachments, [file]);
});

test('job fingerprints ignore provider delivery-attempt IDs and public health never includes private envelope data', () => {
  assert.equal(
    inboundEnvelopeHash(envelope),
    inboundEnvelopeHash({ ...envelope, webhookId: 'different_svix_attempt', createdAt: new Date().toISOString() }),
  );
  assert.notEqual(inboundEnvelopeHash(envelope), inboundEnvelopeHash({ ...envelope, subject: 'Changed' }));
  const row = {
    ...envelope,
    ownerId: 'fictional-owner',
    memberId,
    environment: 'qa',
    envelopeJson: JSON.stringify(envelope),
    envelopeHash: 'privatehash',
    status: 'retry',
    attempts: 2,
    nextAttemptAt: null,
    lastAttemptAt: null,
    lastErrorCode: 'provider_unavailable',
    leaseToken: 'privatelease',
    leaseUntil: null,
    ticketId: null,
    messageId: null,
    manualRetries: 0,
    lastRetryKey: null,
    lastRetriedAt: null,
    updatedAt: envelope.createdAt,
  } as InboundJob;
  const publicValue = JSON.stringify(publicInboundJob(row));
  for (const privateValue of [address, envelope.from, envelope.subject, 'privatehash', 'privatelease'])
    assert.ok(!publicValue.includes(privateValue));
  assert.deepEqual(classifyInboundFailure(new Error('raw provider secret and private body')), {
    retryable: true,
    code: 'processing_unavailable',
  });
  assert.deepEqual(classifyInboundFailure(new InboundRetryError('storage_unavailable')), {
    retryable: true,
    code: 'storage_unavailable',
  });
  assert.deepEqual(classifyInboundFailure(new InboundRejectError('attachment_invalid')), {
    retryable: false,
    code: 'attachment_invalid',
  });
});

test('signed webhook acknowledges durable queueing before worker/provider processing', async () => {
  const order: string[] = [],
    pending: (() => Promise<void>)[] = [];
  const handlers = createResendWebhookHandlers({
    env: {
      DAYBOOK_INBOUND_ENABLED: 'true',
      DAYBOOK_INBOUND_DOMAIN: config.domain!,
      DAYBOOK_INBOUND_TOKEN_SECRET: config.tokenSecret,
      RESEND_INBOUND_API_KEY: config.apiKey,
      RESEND_INBOUND_WEBHOOK_SECRET: config.webhookSecret,
      DAYBOOK_NOTIFICATION_ENVIRONMENT: 'qa',
    },
    receive: async () => {
      order.push('durable enqueue');
      return { status: 'pending', ownerId: 'fictional-owner', reasonCode: null, ticketId: null, messageId: null };
    },
    after: task => pending.push(task),
    drainIncoming: async () => {
      order.push('worker');
    },
    dispatchNotifications: async () => {
      order.push('notifications');
    },
  });
  const raw = Buffer.from(
    JSON.stringify({
      type: 'email.received',
      created_at: envelope.createdAt,
      data: { email_id: id, from: envelope.from, to: envelope.to, subject: envelope.subject },
    }),
  );
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', Buffer.from(config.webhookSecret.slice(6), 'base64'))
    .update(`msg_fictional.${timestamp}.`)
    .update(raw)
    .digest('base64');
  const response = await handlers.inbound(
    new Request('https://qa.example.test/api/webhooks/resend/inbound', {
      method: 'POST',
      body: new Uint8Array(raw),
      headers: { 'svix-id': 'msg_fictional', 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(order, ['durable enqueue']);
  await pending[0]();
  assert.deepEqual(order, ['durable enqueue', 'worker', 'notifications']);
});

test('worker persists a bounded retry reason rather than provider exceptions or private content', async () => {
  let claimed = false;
  const updates: unknown[][] = [];
  const job = {
    ...envelope,
    ownerId: 'fictional-owner',
    memberId,
    environment: 'qa',
    envelopeJson: JSON.stringify(envelope),
    envelopeHash: inboundEnvelopeHash(envelope),
    status: 'processing',
    attempts: 1,
    nextAttemptAt: null,
    lastAttemptAt: null,
    lastErrorCode: null,
    leaseToken: 'ignored',
    leaseUntil: null,
    ticketId: null,
    messageId: null,
    manualRetries: 0,
    lastRetryKey: null,
    lastRetriedAt: null,
    updatedAt: envelope.createdAt,
  };
  const database = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              if (sql.includes('LEFT JOIN \"workspaceProfiles\"')) return { id: 'daybook' };
              if (!sql.includes('WITH candidate') || claimed) return null;
              claimed = true;
              return { ...job, leaseToken: values[3] };
            },
            async run() {
              updates.push(values);
              return { meta: { changes: 1 }, results: [] };
            },
            async all() {
              return { results: [] };
            },
          };
        },
      };
    },
  } as unknown as Database;
  const summary = await drainInboundMailJobs('fictional-owner', {
    database,
    config,
    maxJobs: 1,
    receive: async () => {
      throw new Error('private provider URL and body client@example.test');
    },
  });
  assert.equal(summary.retried, 1);
  const retry = updates.find(values => values[0] === 'retry')!;
  assert.equal(retry[1], 'processing_unavailable');
  assert.ok(Date.parse(String(retry[2])) > Date.now());
  assert.ok(!JSON.stringify(updates).includes('private provider'));
});

test('a crashed final attempt is failed and its unlinked reservations enter the guarded orphan cleanup path', async () => {
  let orphanMarked = false,
    repaired = false;
  const database = {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first() {
              return sql.includes('LEFT JOIN \"workspaceProfiles\"') ? { id: 'daybook' } : null;
            },
            async run() {
              return { meta: { changes: 1 }, results: [] };
            },
            async all() {
              if (sql.includes('WITH expired') && !repaired) {
                repaired = true;
                return { results: [{ providerId: id, memberId }] };
              }
              return { results: [] };
            },
          };
        },
      };
    },
    async transaction(work: (tx: unknown) => Promise<unknown>) {
      return work({
        async query(sql: string) {
          if (sql.startsWith('SELECT * FROM "inboundMailJobs"')) return { rows: [{ status: 'failed' }] };
          if (sql.startsWith('UPDATE attachments')) orphanMarked = true;
          return { rows: [] };
        },
      });
    },
  } as unknown as Database;
  const result = await drainInboundMailJobs('fictional-owner', {
    database,
    config,
    providerId: id,
    receive: async () => {
      assert.fail('An exhausted job must never fetch/process again automatically.');
    },
  });
  assert.equal(result.failed, 1);
  assert.equal(orphanMarked, true);
  assert.equal(result.attempted, 0);
});

test('private incoming-file reads resolve zero transfer size from metadata and still enforce exact streamed bytes', async () => {
  let metadataCalls = 0;
  const storage = {
    async read() {
      return resolveInboundPrivateFile(new Response('hello').body!, 0, async () => {
        metadataCalls++;
        return { size: 5 };
      });
    },
    async remove() {},
  };
  assert.deepEqual(await readAttachmentBytes(storage, 'fictional/private.bin', 5), Buffer.from('hello'));
  assert.equal(metadataCalls, 1);
  await assert.rejects(readAttachmentBytes(storage, 'fictional/private.bin', 4), /size mismatch/);
  const short = {
    ...storage,
    async read() {
      return resolveInboundPrivateFile(new Response('hi').body!, 0, async () => ({ size: 5 }));
    },
  };
  await assert.rejects(readAttachmentBytes(short, 'fictional/private.bin', 5), /size mismatch/);
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    resolveInboundPrivateFile(stream, 0, async () => ({ size: 10485761 })),
    /size invalid/,
  );
  assert.equal(cancelled, true);
});

test('the final ingestion fence checks the current time rather than the timestamp captured before retrieval', async () => {
  let checkedAt = '';
  const database = {
    async transaction(work: (tx: unknown) => Promise<unknown>) {
      return work({
        async query(sql: string, values?: unknown[]) {
          if (sql.includes('LEFT JOIN "workspaceProfiles"')) return { rows: [{ id: 'daybook', state: null }] };
          if (sql.includes('FROM "inboundMailJobs"')) checkedAt = String(values?.[3]);
          return { rows: [] };
        },
      });
    },
  } as unknown as Database;
  const oldStart = new Date(Date.now() - 3600000);
  const source = {
    id: memberId,
    ownerId: 'fictional-owner',
    organizationId: 'daybook',
    userId: 'fictional-user',
    name: 'Fictional client',
    email: envelope.from,
    role: 'client' as const,
    status: 'active' as const,
    hasAccount: true,
    isTest: true,
    customerCompanyId: null,
    companyAccess: 'own' as const,
    createdAt: oldStart.toISOString(),
    updatedAt: oldStart.toISOString(),
  };
  const actualStart = Date.now();
  await assert.rejects(
    ingestInboundEmail(
      database,
      envelope,
      email,
      parseInboundRoute(address, config)!,
      source,
      config,
      oldStart,
      undefined,
      { providerId: id, leaseToken: randomUUID() },
    ),
    error => error instanceof InboundRetryError && error.message === 'lease_lost',
  );
  assert.ok(Date.parse(checkedAt) >= actualStart && Date.parse(checkedAt) <= Date.now());
  assert.notEqual(checkedAt, oldStart.toISOString());
});
