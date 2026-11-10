import assert from 'node:assert/strict';
import test from 'node:test';
import { mutationOriginAllowed } from '../lib/request-origin';

const site = 'https://daybook-ticket.vercel.app';
const headers = (values: Record<string, string>) => new Headers(values);

test('a mutation from the configured origin is allowed', () => {
  assert.equal(mutationOriginAllowed(headers({ origin: site }), site), true);
  assert.equal(mutationOriginAllowed(headers({ origin: site, 'sec-fetch-site': 'same-origin' }), site), true);
});

test('another origin, a sibling subdomain or the literal null origin is rejected', () => {
  assert.equal(mutationOriginAllowed(headers({ origin: 'https://evil.example' }), site), false);
  assert.equal(mutationOriginAllowed(headers({ origin: 'https://other.vercel.app' }), site), false);
  assert.equal(mutationOriginAllowed(headers({ origin: 'null' }), site), false);
});

test('Origin wins over Sec-Fetch-Site when both are present', () => {
  assert.equal(
    mutationOriginAllowed(headers({ origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' }), site),
    false,
  );
});

test('without Origin a browser that reports a cross-site or same-site request is rejected', () => {
  assert.equal(mutationOriginAllowed(headers({ 'sec-fetch-site': 'cross-site' }), site), false);
  assert.equal(mutationOriginAllowed(headers({ 'sec-fetch-site': 'same-site' }), site), false);
});

test('without Origin a same-origin or user-initiated browser request is allowed', () => {
  assert.equal(mutationOriginAllowed(headers({ 'sec-fetch-site': 'same-origin' }), site), true);
  assert.equal(mutationOriginAllowed(headers({ 'sec-fetch-site': 'none' }), site), true);
});

test('non-browser clients with no metadata keep working', () => {
  assert.equal(mutationOriginAllowed(headers({}), site), true);
});
