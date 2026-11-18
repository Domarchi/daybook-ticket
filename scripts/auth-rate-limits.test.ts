import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

/** Per-IP limits (Better Auth keys them by client IP and path): an office behind one public address shares them. */
test('sign-in limits allow an office behind one IP, while reset and re-checks stay strict', () => {
  const source = readFileSync('lib/daybook-auth.ts', 'utf8');
  const rule = (path: string) => {
    const match = new RegExp(`'${path.replace(/[/*]/g, '\\$&')}': \\{ window: (\\d+), max: (\\d+) \\}`).exec(source);
    assert.ok(match, path);
    return { window: Number(match[1]), max: Number(match[2]) };
  };
  assert.deepEqual(rule('/sign-in/email'), { window: 60, max: 60 });
  assert.deepEqual(rule('/sign-up/email'), { window: 60, max: 60 });
  assert.deepEqual(rule('/two-factor/*'), { window: 60, max: 30 });
  assert.deepEqual(rule('/request-password-reset'), { window: 300, max: 3 });
  assert.deepEqual(rule('/verify-password'), { window: 60, max: 5 });
  assert.match(source, /minPasswordLength: 12/, 'the higher limit relies on long passwords');
  assert.match(source, /rateLimit: \{\s*enabled: true,\s*storage: 'database'/, 'shared across instances');
  assert.match(source, /ipAddressHeaders: \['x-vercel-forwarded-for'\]/, 'the IP comes from Vercel only');
});
