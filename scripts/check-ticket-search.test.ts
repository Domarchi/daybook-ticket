import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeTicketCursor,
  encodeTicketCursor,
  literalSearchPattern,
  parseTicketSearch,
} from '../lib/ticket-search-query';

test('search defaults to a bounded page and validates every supported filter', () => {
  assert.deepEqual(parseTicketSearch(new URLSearchParams()), {
    q: '',
    queue: 'all',
    priority: 'all',
    department: 'all',
    company: 'all',
    agent: 'all',
    limit: 50,
    cursor: null,
  });
  const query = parseTicketSearch(
    new URLSearchParams({
      q: '  conexión  ',
      queue: 'unassigned',
      priority: 'urgent',
      company: 'company-a',
      agent: 'none',
      department: 'Soporte',
      limit: '100',
    }),
  );
  assert.equal(query.q, 'conexión');
  assert.equal(query.limit, 100);
  assert.equal(query.queue, 'unassigned');
  assert.equal(query.agent, 'none');
  for (const limit of ['0', '-1', '101', '1.5', 'NaN', '1e2', ''])
    assert.throws(() => parseTicketSearch(new URLSearchParams({ limit })));
  for (const queue of ['notes', 'mine OR true', ''])
    assert.throws(() => parseTicketSearch(new URLSearchParams({ queue })));
  assert.throws(() => parseTicketSearch(new URLSearchParams({ q: 'a'.repeat(201) })));
  assert.throws(() => parseTicketSearch(new URLSearchParams({ department: 'x\u0000y' })));
});

test('keyset cursor preserves ordering fields and rejects malformed boundaries', () => {
  const boundary = { at: '2026-11-05T10:00:00.000Z', id: 543 };
  assert.deepEqual(decodeTicketCursor(encodeTicketCursor(boundary)), boundary);
  assert.equal(decodeTicketCursor(null), null);
  for (const input of [
    '=',
    'x'.repeat(257),
    Buffer.from('{"at":"invalid","id":1}').toString('base64url'),
    Buffer.from('{"at":"2026-11-05T00:00:00Z","id":-1}').toString('base64url'),
  ])
    assert.throws(() => decodeTicketCursor(input));
});

test('percent, underscore, backslash and SQL fragments remain literal search text', () => {
  assert.equal(literalSearchPattern('50%_off\\sample'), '%50\\%\\_off\\\\sample%');
  assert.equal(literalSearchPattern("' OR 1=1 --"), "%' OR 1=1 --%");
});
