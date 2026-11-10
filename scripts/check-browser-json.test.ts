import assert from 'node:assert/strict';
import test from 'node:test';
import { readDaybookJson, BrowserJsonError, isJsonObject } from '../lib/browser-json';
import { knowledgeRequest } from '../lib/knowledge-request';
import { KnowledgeDraftStore } from '../lib/knowledge-drafts';
import { DraftOperations } from '../lib/draft-operations';
const contract = {
  mutation: true,
  validate: (value: unknown): value is { ok: true } => isJsonObject(value) && value.ok === true,
};
test('an interrupted successful JSON body never confirms a mutation or clears its draft/operation ID', async () => {
  const store = new KnowledgeDraftStore(null),
    draft = { baseVersion: 0, title: 'Guía privada', category: 'QA', body: 'Texto conservado', changeNote: '' },
    operations = new DraftOperations(null, () => 'stable-fictional-operation');
  store.write('member', 0, draft);
  const operationId = operations.forPayload('member:new', draft);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"ok":'));
      controller.error(new TypeError('PRIVATE_NETWORK_DETAIL'));
    },
  });
  await assert.rejects(
    readDaybookJson(new Response(body, { status: 200 }), contract),
    error =>
      error instanceof BrowserJsonError &&
      error.status === 200 &&
      /No se pudo confirmar/.test(error.message) &&
      !error.message.includes('PRIVATE'),
  );
  assert.deepEqual(store.read('member', 0, { ...draft, body: '' }), draft);
  assert.equal(operations.forPayload('member:new', draft), operationId);
});
test('malformed or empty successes reject while a validated DTO confirms exactly once', async () => {
  for (const body of ['', 'not-json', '{}', 'null', '[]', '{"ok":false}', '{"error":"false-success"}'])
    await assert.rejects(readDaybookJson(new Response(body, { status: 200 }), contract), BrowserJsonError);
  await assert.rejects(readDaybookJson(new Response(null, { status: 204 }), contract), BrowserJsonError);
  assert.deepEqual(await readDaybookJson(new Response('{"ok":true}', { status: 200 }), contract), { ok: true });
});
test('HTTP errors without JSON are translated and 428 preserves verification metadata', async () => {
  await assert.rejects(
    readDaybookJson(new Response('<html>PRIVATE_SERVER_DETAIL</html>', { status: 502 }), contract),
    error =>
      error instanceof BrowserJsonError &&
      error.status === 502 &&
      error.payload === null &&
      /No se pudo completar/.test(error.message) &&
      !error.message.includes('PRIVATE'),
  );
  const payload = { error: 'Verifica tu acceso', reauthenticationRequired: true };
  await assert.rejects(readDaybookJson(new Response(JSON.stringify(payload), { status: 428 }), contract), error => {
    assert.ok(error instanceof BrowserJsonError);
    assert.equal(error.status, 428);
    assert.deepEqual(error.payload, payload);
    return true;
  });
});
test('knowledge transport rejects a malformed article success without retrying and respects workspace paths', async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('{"article":{"id":1}}', { status: 200 });
  };
  try {
    await assert.rejects(
      knowledgeRequest('member', '/api/knowledge', 'POST', { operationId: 'unchanged' }),
      BrowserJsonError,
    );
    assert.equal(calls, 1);
    globalThis.fetch = async () => {
      calls++;
      return new Response('{"items":[],"nextCursor":null}', { status: 200 });
    };
    assert.deepEqual(await knowledgeRequest('member', '/api/workspaces/workspace/knowledge'), {
      items: [],
      nextCursor: null,
    });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = previous;
  }
});
