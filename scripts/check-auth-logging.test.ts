import assert from 'node:assert/strict';
import test from 'node:test';
import { createLogger } from 'better-auth';
import { safeAuthLogger } from '../lib/auth-logging';

test('Better Auth errors and warnings retain severity without SQL, tokens or error payloads', t => {
  const errors = t.mock.method(console, 'error', () => undefined);
  const warnings = t.mock.method(console, 'warn', () => undefined);
  const other = t.mock.method(console, 'log', () => undefined);
  const fakeSecret = 'QA_ONLY_SESSION_TOKEN_SENTINEL';
  const query = 'SELECT * FROM "authSession" WHERE token=$1';
  const failure = Object.assign(new Error(`Failed query: ${query}; params: ${fakeSecret}`), {
    query,
    params: [fakeSecret],
    cause: new Error(`connection timeout ${fakeSecret}`),
  });
  const logger = createLogger(safeAuthLogger);
  logger.error(`Adapter failed ${fakeSecret}`, failure, { token: fakeSecret });
  logger.warn(`Missing IP ${fakeSecret}`, failure);
  logger.info(fakeSecret, failure);
  logger.debug(fakeSecret, failure);
  logger.success(fakeSecret, failure);

  assert.equal(logger.level, 'warn');
  assert.deepEqual(
    errors.mock.calls.map(call => call.arguments),
    [['Daybook Ticket authentication error']],
  );
  assert.deepEqual(
    warnings.mock.calls.map(call => call.arguments),
    [['Daybook Ticket authentication warning']],
  );
  assert.equal(other.mock.calls.length, 0, 'The existing warning threshold remains in effect.');
  const output = JSON.stringify([...errors.mock.calls, ...warnings.mock.calls].map(call => call.arguments));
  for (const privateValue of [fakeSecret, query, 'params', 'connection timeout', 'Adapter failed', 'Error:', 'stack'])
    assert.ok(!output.includes(privateValue));
});

test('the safe callback never reads or serializes provider-controlled error properties', t => {
  const errors = t.mock.method(console, 'error', () => undefined);
  let inspected = false;
  const payload = Object.defineProperties(
    {},
    Object.fromEntries(
      ['message', 'stack', 'cause', 'query', 'params', 'toJSON'].map(name => [
        name,
        {
          get() {
            inspected = true;
            throw new Error('Provider payload must remain unread.');
          },
        },
      ]),
    ),
  );
  assert.doesNotThrow(() => safeAuthLogger.log!('error', 'Untrusted external message', payload));
  assert.equal(inspected, false);
  assert.deepEqual(errors.mock.calls[0].arguments, ['Daybook Ticket authentication error']);
});
