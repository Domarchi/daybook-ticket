import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../public/push-sw.js', import.meta.url), 'utf8');
const origin = 'https://daybook-ticket.example';
const receipt = { title: 'Daybook Ticket', body: 'Nuevo mensaje en el ticket #12.', tag: 'daybook-event-event-a', url: '/?ticket=12' };
const payload = { subscriptionId: 'subscription-a', eventId: 'event-a' };

function worker({ response = receipt, status = 200, failFetch = false, failShow = false, visible = false } = {}) {
  const listeners = new Map(), calls = { fetch: [], shown: [], opened: [], closed: 0, claimed: 0, skipped: 0 };
  const behavior = { response, status, failFetch, failShow, visible };
  const context = vm.createContext({ URL, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      calls.fetch.push({ url, options });
      if (behavior.failFetch) throw new Error('offline');
      return { ok: behavior.status >= 200 && behavior.status < 300, json: async () => behavior.response };
    },
    self: {
      location: { origin },
      addEventListener: (type, action) => listeners.set(type, action),
      skipWaiting: async () => { calls.skipped += 1; },
      clients: {
        claim: async () => { calls.claimed += 1; },
        matchAll: async () => behavior.visible ? [{ visibilityState: 'visible', url: `${origin}/` }] : [],
        openWindow: async url => { calls.opened.push(url); },
      },
      registration: { showNotification: async (title, options) => {
        if (behavior.failShow) throw new Error('permission changed');
        calls.shown.push({ title, options });
      } },
    },
  });
  vm.runInContext(source, context, { filename: 'push-sw.js' });
  async function emit(type, fields = {}) {
    let completion = Promise.resolve();
    listeners.get(type)?.({ ...fields, waitUntil(value) { completion = value; } });
    await completion;
  }
  return { calls, behavior, listeners, emit, push: data => emit('push', { data: { json: () => data } }) };
}

test('background delivery validates the live session with credentials and uses only the server receipt', async () => {
  const app = worker();
  await app.push({ ...payload, title: 'untrusted title', body: 'private message body', url: 'https://external.example' });
  assert.equal(app.calls.fetch.length, 1);
  const request = app.calls.fetch[0];
  assert.equal(request.url, '/api/push/receipt');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.credentials, 'include');
  assert.equal(request.options.cache, 'no-store');
  assert.deepEqual(JSON.parse(request.options.body), payload);
  assert.equal(app.calls.shown.length, 1);
  assert.equal(app.calls.shown[0].title, receipt.title);
  assert.equal(app.calls.shown[0].options.body, receipt.body);
  assert.equal(app.calls.shown[0].options.data.url, `${origin}/?ticket=12`);
  assert.notEqual(app.calls.shown[0].options.silent, true, 'Closed-page alerts must permit the operating system sound.');
});

test('expired, logged-out, changed-account, or revoked-session receipts do not show an app notification', async () => {
  for (const status of [401, 403, 404, 500]) {
    const app = worker({ status });
    await app.push(payload);
    assert.equal(app.calls.shown.length, 0, `HTTP ${status}`);
    app.behavior.status = 200;
    await app.push(payload);
    assert.equal(app.calls.shown.length, 1, 'Denied attempts are not marked as delivered.');
  }
  const offline = worker({ failFetch: true });
  await offline.push(payload);
  assert.equal(offline.calls.shown.length, 0);
});

test('visible desk avoids a second system sound while the in-app chime handles the alert', async () => {
  const app = worker({ visible: true });
  await app.push(payload);
  assert.equal(app.calls.shown.length, 1);
  assert.equal(app.calls.shown[0].options.silent, true);
});

test('simultaneous duplicate push events display once, while different events and explicit tests still display', async () => {
  const app = worker();
  await Promise.all([app.push(payload), app.push(payload), app.push(payload)]);
  assert.equal(app.calls.shown.length, 1);
  assert.equal(app.calls.fetch.length, 1);
  await app.push({ ...payload, eventId: 'event-b' });
  await app.push({ subscriptionId: payload.subscriptionId, test: true });
  await app.push({ subscriptionId: payload.subscriptionId, test: true });
  assert.equal(app.calls.shown.length, 4);
});

test('a showNotification failure leaves the event available for retry', async () => {
  const app = worker({ failShow: true });
  await app.push(payload);
  assert.equal(app.calls.shown.length, 0);
  app.behavior.failShow = false;
  await app.push(payload);
  assert.equal(app.calls.shown.length, 1);
});

test('malformed payloads and unsafe notification URLs never open or display arbitrary pages', async () => {
  const app = worker();
  for (const malformed of [null, {}, { eventId: 'a' }, { subscriptionId: 'a' }, { subscriptionId: 'a', eventId: 1 }, { subscriptionId: 'x'.repeat(101), test: true }]) await app.push(malformed);
  assert.equal(app.calls.fetch.length, 0);
  for (const url of ['https://external.example/', '//external.example/', 'javascript:alert(1)', '/login?invite=token', '/?ticket=0', '/?ticket=-1', '/?ticket=12&extra=1', '/?ticket=12#fragment']) {
    const unsafe = worker({ response: { ...receipt, url } });
    await unsafe.push(payload);
    assert.equal(unsafe.calls.shown.length, 0, url);
    await unsafe.emit('notificationclick', { notification: { data: { url }, close: () => { unsafe.calls.closed += 1; } } });
    assert.equal(unsafe.calls.opened.length, 0, url);
  }
});

test('a safe notification click opens a fresh tab, preserving any existing draft', async () => {
  const app = worker();
  await app.emit('notificationclick', { notification: { data: { url: `${origin}/?ticket=12` }, close: () => { app.calls.closed += 1; } } });
  assert.deepEqual(app.calls.opened, [`${origin}/?ticket=12`]);
  assert.equal(app.calls.closed, 1);
});

test('the worker activates without installing an offline cache or intercepting application requests', async () => {
  const app = worker();
  await app.emit('install'); await app.emit('activate');
  assert.equal(app.calls.skipped, 1); assert.equal(app.calls.claimed, 1);
  assert.equal(app.listeners.has('fetch'), false);
  assert.equal(app.calls.fetch.length, 0);
});
