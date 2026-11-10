import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeAlertCursor, markAlertsSchema, parseAlertsQuery } from '../lib/alerts-query';
import { isUnreadAlert, matchesAlertsViewer, mergeAlertPages } from '../lib/alerts-state';
import { TicketAlertTracker } from '../lib/alert-tracker';
import type { TicketAlert } from '../lib/types';

const item = (id: string, patch: Partial<TicketAlert> = {}): TicketAlert => ({
  id,
  event: 'ticket_created',
  ticketId: 1,
  subject: 'Ficticio',
  createdAt: '2026-11-04T15:00:00.000Z',
  readAt: null,
  historical: false,
  ...patch,
});

test('keyset cursor preserves the ID tie-breaker and validates untrusted input', () => {
  const cursor = { createdAt: '2026-11-04T15:00:00.000Z', id: '6ce7a8f9-82d6-4366-82ab-e4f132189138' };
  assert.deepEqual(
    parseAlertsQuery(new URLSearchParams({ cursor: encodeAlertCursor(cursor), filter: 'unread', limit: '50' })),
    { cursor, filter: 'unread', limit: 50 },
  );
  assert.throws(() => parseAlertsQuery(new URLSearchParams({ cursor: 'invalid' })));
  assert.throws(() => parseAlertsQuery(new URLSearchParams({ limit: '51' })));
  assert.throws(() => parseAlertsQuery(new URLSearchParams({ filter: 'other-account' })));
});

test('read operations reject cross-account selectors and ambiguous instructions', () => {
  assert.deepEqual(markAlertsSchema.parse({ all: true }), { all: true });
  assert.throws(() => markAlertsSchema.parse({ all: true, recipientMemberId: 'someone-else' }));
  assert.throws(() => markAlertsSchema.parse({ all: true, ids: ['6ce7a8f9-82d6-4366-82ab-e4f132189138'] }));
  assert.throws(() => markAlertsSchema.parse({ ids: [] }));
});

test('read actions require the expected session member, including when another tab changed accounts', () => {
  assert.equal(matchesAlertsViewer('member-a', 'member-a'), true);
  assert.equal(matchesAlertsViewer(null, 'member-a'), false);
  assert.equal(matchesAlertsViewer('member-a', 'member-b'), false);
});

test('imported history has an unknown read state and never increases unread', () => {
  assert.equal(isUnreadAlert(item('history', { historical: true })), false);
  assert.equal(isUnreadAlert(item('new')), true);
  assert.equal(isUnreadAlert(item('read', { readAt: '2026-11-04T15:10:00.000Z' })), false);
});

test('late poll and overlapping pages cannot undo acknowledged reading or duplicate events', () => {
  const read = item('one', { readAt: '2026-11-04T15:10:00.000Z' });
  assert.deepEqual(mergeAlertPages([read], [item('one')]), [read]);
  assert.deepEqual(mergeAlertPages([item('one')], [read, item('two')], true), [read, item('two')]);
  assert.deepEqual(
    mergeAlertPages([read, item('gone')], [item('one')]),
    [read],
    'A refreshed authorized page removes unavailable items.',
  );
});

test('historical, previously read and paginated history never replay chimes', () => {
  const tracker = new TicketAlertTracker();
  tracker.receive('account:agent', []);
  const history = item('history', { historical: true });
  const read = item('read', { readAt: '2026-11-04T15:10:00.000Z' });
  assert.deepEqual(tracker.receive('account:agent', [history, read]), []);
  assert.deepEqual(
    tracker.receive('account:agent', [history, read, item('fresh', { event: 'reminder' })]).map(alert => alert.id),
    ['fresh'],
  );
  assert.deepEqual(tracker.receive('different:agent', [item('fresh')]), []);
});

test('a saved read arriving before an old workspace poll suppresses its chime', () => {
  const tracker = new TicketAlertTracker();
  tracker.receive('account:agent', []);
  tracker.acknowledge(['already-read']);
  assert.deepEqual(
    tracker.receive('account:agent', [item('already-read'), item('new')]).map(alert => alert.id),
    ['new'],
  );
});
