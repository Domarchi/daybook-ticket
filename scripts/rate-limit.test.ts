import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import type { Database } from '../db/database';
import { consumeRateLimit, rateLimitKey, RATE_RULES, type RateRule } from '../lib/rate-limit';

const rule: RateRule = { bucket: 'b', max: 2, windowMs: 1000, message: 'despacio' };

function fakeDatabase(counts: number[] | Error) {
  const calls: unknown[][] = [];
  const database = { prepare: () => ({ bind: (...values: unknown[]) => ({ first: async () => {
    calls.push(values);
    if (counts instanceof Error) throw counts;
    return { count: counts.shift() };
  } }) }) } as unknown as Database;
  return { database, calls };
}

test('keys are scoped by action and user', () => {
  assert.equal(rateLimitKey(rule, 'u1'), 'daybook-rate:b:u1');
  assert.notEqual(rateLimitKey(RATE_RULES.ticketSearch, 'u1'), rateLimitKey(RATE_RULES.report, 'u1'));
});

test('allows up to the limit, then answers 429 with the rule message', async () => {
  const { database, calls } = fakeDatabase([1, 2, 3]);
  await consumeRateLimit({ userId: 'u1' }, rule, database, 500);
  await consumeRateLimit({ userId: 'u1' }, rule, database, 501);
  await assert.rejects(() => consumeRateLimit({ userId: 'u1' }, rule, database, 502), (error: { status?: number; message: string }) => error.status === 429 && error.message === 'despacio');
  assert.deepEqual(calls[0], ['daybook-rate:b:u1', 500, 1000]);
});

test('a failing limiter never blocks the request', async t => {
  const warnings = t.mock.method(console, 'warn', () => undefined);
  const { database } = fakeDatabase(new Error('db down'));
  await consumeRateLimit({ userId: 'u1' }, rule, database);
  assert.equal(JSON.parse(String(warnings.mock.calls[0].arguments[0])).event, 'rate_limit_unavailable');
});

test('every limit is generous enough for a person and bounded for a script', () => {
  for (const [name, entry] of Object.entries(RATE_RULES)) {
    assert.ok(entry.max >= 10 && entry.max <= 200, `${name} max`);
    assert.ok(entry.windowMs >= 60_000, `${name} window`);
    assert.ok(entry.message.length > 10);
  }
});

test('the expensive routes actually consume their limit after authenticating', () => {
  const root = join(import.meta.dirname, '..', 'app', 'api');
  const wired: Array<[string, string]> = [
    ['tickets/search/route.ts', 'ticketSearch'], ['tickets/route.ts', 'ticketCreate'],
    ['attachments/reserve/route.ts', 'attachmentReserve'], ['attachments/upload/route.ts', 'attachmentUpload'],
    ['reports/monthly/route.ts', 'report'],
  ];
  for (const [file, ruleName] of wired) {
    const source = readFileSync(join(root, file), 'utf8');
    const limit = source.indexOf(`RATE_RULES.${ruleName}`), guard = source.search(/requireAccess\(|requireKnowledgeAccess\(/);
    assert.ok(limit > guard && guard >= 0, `${file} must limit after the access guard`);
  }
});
