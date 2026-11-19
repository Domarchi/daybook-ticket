import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { feedTag, feedUnchanged, feedVersion } from '../lib/ticket-feed-version';

const base = {
  viewer: ['m1', 'agent', 'active', '', 'own'],
  data: {
    tickets: '12,2026-11-19T10:00:00.000Z,40,1',
    members: '5,2026-11-18T09:00:00.000Z',
    companies: '2,2026-11-17T09:00:00.000Z',
    requirements: '1,2026-11-18T12:00:00.000Z',
    alertsActivatedAt: '2026-11-01T00:00:00.000Z',
    alerts: '3,2026-11-19T09:00:00.000Z,1,2026-11-19T09:30:00.000Z',
  },
  hour: '2026-11-19T10',
};

test('the same state gives the same short tag, whatever the key order', () => {
  const tag = feedVersion(base);
  assert.match(tag, /^[A-Za-z0-9_-]{27}$/);
  const reversed = Object.fromEntries(Object.entries(base.data).reverse());
  assert.equal(feedVersion({ ...base, data: reversed }), tag);
});

test('any change the feed or its panels show gives a new tag', () => {
  const tag = feedVersion(base);
  const changed = (data: Partial<typeof base.data>) => feedVersion({ ...base, data: { ...base.data, ...data } });
  assert.notEqual(changed({ tickets: '12,2026-11-19T10:00:00.000Z,41,1' }), tag, 'a version bump');
  assert.notEqual(changed({ tickets: '12,2026-11-19T10:00:00.000Z,40,2' }), tag, 'a ticket became overdue');
  assert.notEqual(changed({ tickets: '11,2026-11-19T10:00:00.000Z,40,1' }), tag, 'a ticket left the view');
  assert.notEqual(changed({ alerts: '3,2026-11-19T09:00:00.000Z,0,2026-11-19T10:01:00.000Z' }), tag, 'an alert read');
  assert.notEqual(changed({ members: '5,2026-11-19T10:02:00.000Z' }), tag, 'a renamed person');
  assert.notEqual(changed({ requirements: '1,2026-11-19T10:03:00.000Z' }), tag, 'a requirement moved');
  assert.notEqual(changed({ companies: '3,2026-11-19T10:03:00.000Z' }), tag, 'a new company');
  assert.notEqual(changed({ tickets: null as unknown as string }), tag, 'nothing visible any more');
});

test('another person, role or visibility never shares a tag, and time alone renews it every hour', () => {
  const tag = feedVersion(base);
  assert.notEqual(feedVersion({ ...base, viewer: ['m2', 'agent', 'active', '', 'own'] }), tag);
  assert.notEqual(feedVersion({ ...base, viewer: ['m1', 'admin', 'active', '', 'own'] }), tag);
  assert.notEqual(feedVersion({ ...base, viewer: ['m1', 'client', 'active', 'c1', 'manager'] }), tag);
  assert.notEqual(feedVersion({ ...base, hour: '2026-11-19T11' }), tag);
});

test('If-None-Match is compared weakly, as HTTP says', () => {
  const tag = feedTag('abc');
  assert.equal(tag, 'W/"abc"');
  assert.equal(feedUnchanged('W/"abc"', tag), true);
  assert.equal(feedUnchanged('"abc"', tag), true);
  assert.equal(feedUnchanged('W/"x", W/"abc"', tag), true);
  assert.equal(feedUnchanged('*', tag), true);
  assert.equal(feedUnchanged(null, tag), false);
  assert.equal(feedUnchanged('', tag), false);
  assert.equal(feedUnchanged('W/"abd"', tag), false);
});

test('the route computes the tag before reading, and the browser sends it back', () => {
  const route = readFileSync('app/api/tickets/updates/route.ts', 'utf8');
  assert.ok(route.indexOf('getTicketFeedVersion') < route.indexOf('getTicketFeed(access)'));
  assert.match(route, /status: 304/);
  assert.match(route, /'Cache-Control': 'no-store'/);
  const hook = readFileSync('hooks/use-workspace.ts', 'utf8');
  assert.match(hook, /'If-None-Match': sentTag/);
  assert.match(hook, /response\.status === 304/);
  // A full workspace read forgets the tag; only a feed applied on top of it can be confirmed later.
  assert.match(hook, /feedTag\.current = nextTag;/);
});
