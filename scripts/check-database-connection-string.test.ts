import assert from 'node:assert/strict';
import test from 'node:test';
import { explicitSslMode } from '../db/connection-string';

const base = 'postgresql://user:p%40ss@ep-example-pooler.c-1.us-east-1.aws.neon.tech/db';

test('require, prefer and verify-ca become the explicit verify-full they already behaved as', () => {
  for (const mode of ['require', 'prefer', 'verify-ca']) {
    assert.equal(explicitSslMode(`${base}?sslmode=${mode}`), `${base}?sslmode=verify-full`);
  }
});

test('only sslmode changes: credentials, host, database and other parameters are preserved', () => {
  assert.equal(
    explicitSslMode(`${base}?sslmode=require&channel_binding=require`),
    `${base}?sslmode=verify-full&channel_binding=require`,
  );
  assert.equal(
    explicitSslMode(`${base}?channel_binding=require&sslmode=require`),
    `${base}?channel_binding=require&sslmode=verify-full`,
  );
});

test('verify-full, a missing sslmode, libpq compatibility and lookalikes are left untouched', () => {
  assert.equal(explicitSslMode(`${base}?sslmode=verify-full`), `${base}?sslmode=verify-full`);
  assert.equal(explicitSslMode(base), base);
  assert.equal(
    explicitSslMode(`${base}?uselibpqcompat=true&sslmode=require`),
    `${base}?uselibpqcompat=true&sslmode=require`,
  );
  assert.equal(explicitSslMode(`${base}?sslmode=disable`), `${base}?sslmode=disable`);
  assert.equal(explicitSslMode(`${base}?xsslmode=require`), `${base}?xsslmode=require`);
  assert.equal(explicitSslMode(`${base}?sslmode=required`), `${base}?sslmode=required`);
});
