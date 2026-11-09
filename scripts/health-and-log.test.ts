import assert from 'node:assert/strict';
import test from 'node:test';
import { appVersion, checkHealth, resetHealthCacheForTests } from '../lib/health';
import { describeError, logEvent } from '../lib/log';
import { handle } from '../lib/server';

test('shallow health never calls the database', async () => {
  resetHealthCacheForTests();
  let calls = 0;
  const result = await checkHealth({ deep: false, probe: async () => { calls += 1; }, version: 'abc' });
  assert.deepEqual(result, { status: 'ok', version: 'abc' });
  assert.equal(calls, 0);
});

test('deep health reports the database, caches for 10 s and recovers', async () => {
  resetHealthCacheForTests();
  let calls = 0;
  let fail = true;
  const probe = async () => { calls += 1; if (fail) throw new Error('down'); };
  assert.deepEqual(await checkHealth({ deep: true, probe, now: 1000, version: 'v' }), { status: 'degraded', version: 'v', database: 'unreachable' });
  fail = false;
  assert.equal((await checkHealth({ deep: true, probe, now: 5000, version: 'v' })).status, 'degraded', 'cached result inside the window');
  assert.equal(calls, 1);
  assert.deepEqual(await checkHealth({ deep: true, probe, now: 11_001, version: 'v' }), { status: 'ok', version: 'v', database: 'ok' });
  assert.equal(calls, 2);
});

test('deep health times out a hanging database', async () => {
  resetHealthCacheForTests();
  const started = Date.now();
  const result = await checkHealth({ deep: true, probe: () => new Promise(() => undefined), now: 1, version: 'v' });
  assert.equal(result.status, 'degraded');
  assert.ok(Date.now() - started < 5000);
});

test('appVersion prefers the deployment commit and is truncated', () => {
  assert.equal(appVersion({ VERCEL_GIT_COMMIT_SHA: 'f9770c9aaaaaaaaaaaaa' }), 'f9770c9aaaaa');
  assert.equal(appVersion({}), 'unknown');
});

test('describeError drops statements and parameters but keeps the pg code', () => {
  const failed = Object.assign(new Error('Failed query: SELECT * FROM users WHERE email=$1\nparams: a@b.c'), { code: '23505' });
  const fields = describeError(failed);
  assert.deepEqual(fields, { errorName: 'Error', errorCode: '23505' });
  assert.deepEqual(describeError(new Error('boom\nsecond line with detail')), { errorName: 'Error', errorMessage: 'boom' });
  assert.deepEqual(describeError('text'), { errorName: 'string' });
});

test('logEvent writes one JSON line per event', t => {
  const errors = t.mock.method(console, 'error', () => undefined);
  logEvent('error', 'x', { requestId: 'r1', n: 2 });
  const line = JSON.parse(String(errors.mock.calls[0].arguments[0]));
  assert.equal(line.level, 'error'); assert.equal(line.event, 'x'); assert.equal(line.requestId, 'r1'); assert.equal(line.n, 2);
  assert.ok(!Number.isNaN(Date.parse(line.at)));
});

test('handle() turns unexpected errors into a 500 with a request id, without leaking the message', async t => {
  const errors = t.mock.method(console, 'error', () => undefined);
  const secret = 'SELECT secret FROM t WHERE token=$1; params: TOKEN123';
  const response = await handle(async () => { throw new Error(`Failed query: ${secret}`); });
  assert.equal(response.status, 500);
  const body = await response.json() as { error: string; requestId: string };
  assert.match(body.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(response.headers.get('x-request-id'), body.requestId);
  assert.ok(!JSON.stringify(body).includes('TOKEN123'));
  assert.ok(!String(errors.mock.calls[0].arguments[0]).includes('TOKEN123'));
});
