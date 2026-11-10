import test from 'node:test';
import assert from 'node:assert/strict';
import { readDaybookJson, BrowserJsonError } from '../lib/browser-json';
import { domainResponseValidator, validDomainResponse } from '../lib/domain-response';
import { DraftOperations } from '../lib/draft-operations';

test('successful but incomplete ticket responses retain the exact uncertain receipt for retry', async () => {
  let ids = 0;
  const operations = new DraftOperations(null, () => `receipt-${++ids}`),
    scope = 'fictional-account.ticket-6.reply';
  const payload = { body: 'Exact fixture reply', kind: 'reply', replyToMessageId: 29, attachmentIds: ['fixture-file'] },
    operationId = operations.forPayload(scope, payload);
  for (const json of ['{', '{}', 'null', '{"message":{"id":14}}']) {
    await assert.rejects(
      readDaybookJson(new Response(json, { status: 201, headers: { 'Content-Type': 'application/json' } }), {
        mutation: true,
        validate: domainResponseValidator('/api/tickets/6/messages', 'POST'),
      }),
      BrowserJsonError,
    );
    assert.equal(
      operations.forPayload(scope, {
        attachmentIds: ['fixture-file'],
        replyToMessageId: 29,
        kind: 'reply',
        body: 'Exact fixture reply',
      }),
      operationId,
    );
  }
  const receipt = { message: { id: 14, ticketId: 6, body: payload.body, kind: 'reply' } };
  assert.deepEqual(
    await readDaybookJson(Response.json(receipt, { status: 201 }), {
      mutation: true,
      validate: domainResponseValidator('/api/tickets/6/messages', 'POST'),
    }),
    receipt,
  );
  assert.equal(ids, 1);
});

test('mutation contracts accept real zero-change receipts and reject unrelated success objects', () => {
  assert.equal(
    validDomainResponse('/api/tickets/6/task-templates', 'POST', {
      created: 0,
      templateId: 'template-fixture',
      templateVersion: 2,
    }),
    true,
  );
  assert.equal(validDomainResponse('/api/tickets/6/relations', 'PATCH', { ok: true }), true);
  assert.equal(
    validDomainResponse('/api/tickets/6/organization', 'PATCH', { organization: { version: 0, values: {}, tags: [] } }),
    true,
  );
  assert.equal(
    validDomainResponse('/api/automation/simulate', 'POST', {
      matches: false,
      ticket: { id: 6 },
      simulationProof: null,
    }),
    true,
  );
  assert.equal(
    validDomainResponse('/api/workspaces/alpha/tickets/6/task-templates', 'POST', {
      created: 0,
      templateId: 'fixture',
      templateVersion: 0,
    }),
    true,
  );
  for (const path of [
    '/api/tickets',
    '/api/tickets/6/messages',
    '/api/organization/catalog',
    '/api/tickets/6/organization',
    '/api/tickets/6/tasks',
    '/api/service-context',
    '/api/automation/rules',
    '/api/task-templates',
  ]) {
    assert.equal(validDomainResponse(path, 'POST', {}), false, path);
    assert.equal(validDomainResponse(path, 'POST', { ok: true }), false, path);
  }
});

test('reauthentication failures keep their status and redirect payload without confirming a mutation', async () => {
  const payload = { error: 'Verifica tu identidad', redirectTo: '/w/alpha/security' };
  await assert.rejects(
    readDaybookJson(Response.json(payload, { status: 428 }), {
      mutation: true,
      validate: domainResponseValidator('/api/tickets/6/messages', 'POST'),
    }),
    error =>
      error instanceof BrowserJsonError &&
      error.status === 428 &&
      error.payload !== null &&
      (error.payload as typeof payload).redirectTo === payload.redirectTo,
  );
});
