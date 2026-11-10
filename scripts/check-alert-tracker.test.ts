import assert from 'node:assert/strict';
import test from 'node:test';
import { TicketAlertTracker } from '../lib/alert-tracker';
import { deliverAlertOnce, type AlertDeliveryDependencies } from '../lib/alert-delivery';
import type { TicketAlert } from '../lib/types';

function alert(
  id: string,
  event: TicketAlert['event'] = 'ticket_created',
  createdAt = '2026-11-03T20:00:00.000Z',
): TicketAlert {
  return { id, event, ticketId: 1, subject: 'Ticket de prueba', createdAt, readAt: null, historical: false };
}

test('initial history stays silent, including an empty first snapshot', () => {
  const tracker = new TicketAlertTracker();
  assert.deepEqual(tracker.receive('owner:owner', [alert('history')]), []);
  assert.deepEqual(tracker.receive('owner:owner', [alert('history')]), []);

  const emptyTracker = new TicketAlertTracker();
  assert.deepEqual(emptyTracker.receive('client:client', []), []);
  assert.deepEqual(
    emptyTracker.receive('client:client', [alert('first', 'agent_replied')]).map(item => item.id),
    ['first'],
  );
});

test('new tickets and messages are emitted once in chronological order', () => {
  const tracker = new TicketAlertTracker();
  tracker.receive('owner:owner', [alert('old')]);
  const newest = alert('newest', 'client_replied', '2026-11-03T20:02:00.000Z');
  const ticket = alert('ticket', 'ticket_created', '2026-11-03T20:01:00.000Z');
  const reply = alert('reply', 'agent_replied', '2026-11-03T20:01:30.000Z');

  assert.deepEqual(tracker.receive('owner:owner', [newest, alert('old'), reply, ticket]), [ticket, reply, newest]);
  assert.deepEqual(tracker.receive('owner:owner', [ticket, reply, newest, alert('old')]), []);
});

test('equal timestamps are ordered by ID and duplicate IDs appear once', () => {
  const tracker = new TicketAlertTracker();
  tracker.receive('owner:owner', []);
  const laterId = alert('b'),
    earlierId = alert('a');
  const input = [laterId, earlierId, { ...earlierId }];
  const original = [...input];

  assert.deepEqual(tracker.receive('owner:owner', input), [earlierId, laterId]);
  assert.deepEqual(input, original, 'Sorting must not mutate the server feed.');
  assert.deepEqual(tracker.receive('owner:owner', input), []);
});

test('feed removal and reappearance do not replay a previously seen event', () => {
  const tracker = new TicketAlertTracker();
  tracker.receive('owner:owner', [alert('baseline')]);
  assert.deepEqual(
    tracker.receive('owner:owner', [alert('new')]).map(item => item.id),
    ['new'],
  );
  assert.deepEqual(tracker.receive('owner:owner', []), []);
  assert.deepEqual(tracker.receive('owner:owner', [alert('new'), alert('baseline')]), []);
});

test('changing account or role establishes a new silent baseline', () => {
  const tracker = new TicketAlertTracker();
  tracker.receive('a:owner', []);
  tracker.receive('a:owner', [alert('a-message')]);

  assert.deepEqual(tracker.receive('b:client', [alert('b-history')]), []);
  assert.deepEqual(
    tracker.receive('b:client', [alert('b-new', 'agent_replied')]).map(item => item.id),
    ['b-new'],
  );
  assert.deepEqual(tracker.receive('b:agent', [alert('staff-history')]), []);
  assert.deepEqual(
    tracker.receive('b:agent', [alert('staff-new', 'client_replied')]).map(item => item.id),
    ['staff-new'],
  );
});

test('logout ignores supplied data and re-entry does not announce offline history', () => {
  const tracker = new TicketAlertTracker();
  tracker.receive('a:owner', [alert('old')]);
  assert.deepEqual(tracker.receive(null, [alert('untrusted-while-signed-out')]), []);
  assert.deepEqual(tracker.receive(null, []), []);
  assert.deepEqual(tracker.receive('a:owner', [alert('while-away'), alert('old')]), []);
  assert.deepEqual(
    tracker.receive('a:owner', [alert('new-arrival')]).map(item => item.id),
    ['new-arrival'],
  );
});

test('chronological ordering respects ISO timestamps with different offsets', () => {
  const tracker = new TicketAlertTracker();
  tracker.receive('a:owner', []);
  const early = alert('early', 'ticket_created', '2026-11-03T17:00:00.000-03:00');
  const late = alert('late', 'client_replied', '2026-11-03T20:01:00.000Z');
  assert.deepEqual(tracker.receive('a:owner', [late, early]), [early, late]);
});

function deliveryEnvironment() {
  const values = new Map<string, string>();
  const tails = new Map<string, Promise<void>>();
  const dependencies: AlertDeliveryDependencies = {
    storage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    },
    withLock: async (name, action) => {
      const next = (tails.get(name) || Promise.resolve()).then(action);
      tails.set(
        name,
        next.catch(() => {}),
      );
      await next;
    },
  };
  return { values, dependencies };
}

test('audible delivery claims the same events only once, including concurrent tabs', async () => {
  const { dependencies } = deliveryEnvironment();
  let delivered = 0;
  const run = () =>
    deliverAlertOnce(
      'dedup:owner',
      'sound',
      ['one', 'two'],
      () => true,
      () => {
        delivered++;
      },
      dependencies,
    );
  await Promise.all([run(), run()]);
  await run();
  assert.equal(delivered, 1);
  await deliverAlertOnce(
    'dedup:owner',
    'sound',
    ['two', 'three'],
    () => true,
    () => {
      delivered++;
    },
    dependencies,
  );
  assert.equal(delivered, 2);
});

test('different delivery channels and accounts have separate claims', async () => {
  const { dependencies } = deliveryEnvironment();
  let delivered = 0;
  const send = (viewer: string, channel: 'sound' | 'desktop') =>
    deliverAlertOnce(
      viewer,
      channel,
      ['same-id'],
      () => true,
      () => {
        delivered++;
      },
      dependencies,
    );
  await send('channels-a:owner', 'sound');
  await send('channels-a:owner', 'desktop');
  await send('channels-b:client', 'sound');
  assert.equal(delivered, 3);
});

test('an ineligible or failed delivery does not consume the event', async () => {
  const { dependencies, values } = deliveryEnvironment();
  let delivered = 0;
  await deliverAlertOnce(
    'eligibility:owner',
    'sound',
    ['new'],
    () => false,
    () => {
      delivered++;
    },
    dependencies,
  );
  assert.equal(values.size, 0);
  await deliverAlertOnce(
    'eligibility:owner',
    'sound',
    ['new'],
    () => true,
    () => {
      throw new Error('Audio is suspended');
    },
    dependencies,
  );
  assert.equal(values.size, 0);
  await deliverAlertOnce(
    'eligibility:owner',
    'sound',
    ['new'],
    () => true,
    () => {
      delivered++;
    },
    dependencies,
  );
  assert.equal(delivered, 1);
});

test('eligibility is evaluated after acquiring the lock', async () => {
  const { dependencies, values } = deliveryEnvironment();
  let eligible = true,
    delivered = 0;
  const delivery = deliverAlertOnce(
    'late-mute:owner',
    'sound',
    ['new'],
    () => eligible,
    () => {
      delivered++;
    },
    dependencies,
  );
  eligible = false;
  await delivery;
  assert.equal(delivered, 0);
  assert.equal(values.size, 0);
});

test('stored claims contain only bounded event IDs', async () => {
  const { dependencies, values } = deliveryEnvironment();
  const ids = Array.from({ length: 250 }, (_, index) => `event-${index}`);
  await deliverAlertOnce(
    'bounded:owner',
    'desktop',
    ids,
    () => true,
    () => {},
    dependencies,
  );
  assert.equal(values.size, 1);
  assert.deepEqual(JSON.parse([...values.values()][0]), ids.slice(-200));
});

test('blocked storage and locks degrade safely to one delivery in this tab', async () => {
  const dependencies: AlertDeliveryDependencies = {
    storage: {
      getItem: () => {
        throw new Error('Storage unavailable');
      },
      setItem: () => {
        throw new Error('Storage unavailable');
      },
    },
    withLock: async () => {
      throw new Error('Locks unavailable');
    },
  };
  let delivered = 0;
  const run = () =>
    deliverAlertOnce(
      'restricted:client',
      'sound',
      ['new'],
      () => true,
      () => {
        delivered++;
      },
      dependencies,
    );
  await run();
  await run();
  assert.equal(delivered, 1);
});
