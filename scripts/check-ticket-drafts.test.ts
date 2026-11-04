import assert from 'node:assert/strict';
import test from 'node:test';
import { draftMessage, TicketDraftStore, ticketDraftKey, type DraftScope } from '../lib/ticket-drafts';
import { visibleTicketSelection } from '../lib/ticket-selection';

const owner: DraftScope = { memberId: 'member-owner', role: 'owner', ticketId: 10 };
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test('an internal note remains private after leaving and reopening its ticket', () => {
  const browser = storage();
  let store = new TicketDraftStore(browser);
  store.selectKind(owner, 'note');
  store.edit(owner, 'Private diagnosis; never send to the customer');
  store = new TicketDraftStore(browser); // New editor/page, same browser session.
  assert.deepEqual(draftMessage(store.read(owner)), { kind: 'note', body: 'Private diagnosis; never send to the customer' });
  const publicMessage = draftMessage(store.selectKind(owner, 'reply'));
  assert.deepEqual(publicMessage, { kind: 'reply', body: '' }, 'Selecting public reply must not inherit private text.');
});

test('public replies and internal notes retain independent text and send only their selected audience', () => {
  const store = new TicketDraftStore(storage());
  store.edit(owner, 'Public update');
  store.selectKind(owner, 'note');
  store.edit(owner, 'Internal follow-up');
  assert.deepEqual(draftMessage(store.selectKind(owner, 'reply')), { kind: 'reply', body: 'Public update' });
  store.complete(owner, { kind: 'reply', body: 'Public update' });
  assert.deepEqual(draftMessage(store.selectKind(owner, 'note')), { kind: 'note', body: 'Internal follow-up' });
  store.complete(owner, { kind: 'note', body: 'Internal follow-up' });
  assert.equal(store.read(owner).note, '');
});

test('drafts never cross account, ticket or role boundaries', () => {
  const store = new TicketDraftStore(storage());
  store.selectKind(owner, 'note');
  store.edit(owner, 'Private owner draft');
  for (const scope of [
    { ...owner, memberId: 'member-mario' },
    { ...owner, ticketId: 11 },
    { ...owner, role: 'client' },
    { ...owner, role: 'agent' },
  ]) assert.deepEqual(draftMessage(store.read(scope)), { kind: 'reply', body: '' });
  assert.equal(store.read(owner).note, 'Private owner draft');
});

test('legacy drafts with unknown audience recover as internal notes and migrate without duplication', () => {
  const browser = storage();
  const legacyKey = 'vexor.draft.v1.owner@example.test.10';
  browser.setItem(legacyKey, 'Legacy text with unknown audience');
  const store = new TicketDraftStore(browser);
  const recovered = store.read(owner, 'owner@example.test');
  assert.equal(recovered.recoveredLegacy, true);
  assert.deepEqual(draftMessage(recovered), { kind: 'note', body: 'Legacy text with unknown audience' });
  assert.equal(browser.getItem(legacyKey), null);
  assert.equal(new TicketDraftStore(browser).read(owner).note, recovered.note);
  assert.equal(store.selectKind(owner, 'reply').reply, '');
});

test('legacy text is not deleted when its safe migration cannot be persisted', () => {
  const browser = storage();
  const legacyKey = 'vexor.draft.v1.owner@example.test.10';
  browser.setItem(legacyKey, 'Keep me');
  const store = new TicketDraftStore({ ...browser, setItem: () => { throw new Error('Quota exceeded'); } });
  assert.deepEqual(draftMessage(store.read(owner, 'owner@example.test')), { kind: 'note', body: 'Keep me' });
  assert.equal(browser.getItem(legacyKey), 'Keep me');
  assert.equal(store.persistent, false);
  store.edit(owner, 'Keep this newer edit in memory');
  assert.equal(store.read(owner).note, 'Keep this newer edit in memory');
});

test('clients restore only public reply drafts and never consume legacy staff drafts', () => {
  const browser = storage();
  const client = { ...owner, role: 'client' };
  browser.setItem('vexor.draft.v1.owner@example.test.10', 'Old staff note');
  const store = new TicketDraftStore(browser);
  assert.equal(store.read(client, 'owner@example.test').reply, '');
  store.edit(client, 'Customer additional details');
  assert.deepEqual(draftMessage(new TicketDraftStore(browser).read(client)), { kind: 'reply', body: 'Customer additional details' });
  assert.equal(store.selectKind(client, 'note').kind, 'reply');
  browser.setItem(ticketDraftKey(client), JSON.stringify({ kind: 'note', reply: 'Public only', note: 'Private', recoveredLegacy: true }));
  assert.deepEqual(new TicketDraftStore(browser).read(client), { kind: 'reply', reply: 'Public only', note: '', recoveredLegacy: false });
});

test('saving one draft never removes the other or an edit made while the save was pending', () => {
  const store = new TicketDraftStore(storage());
  store.edit(owner, 'Original reply');
  const sent = draftMessage(store.read(owner));
  store.edit(owner, 'Newer reply');
  store.complete(owner, sent);
  assert.equal(store.read(owner).reply, 'Newer reply');
  store.selectKind(owner, 'note');
  store.edit(owner, 'Other audience');
  store.complete(owner, { kind: 'reply', body: 'Newer reply' });
  assert.deepEqual(draftMessage(store.read(owner)), { kind: 'note', body: 'Other audience' });
});

test('unavailable storage retains navigation drafts in this page without pretending persistence', () => {
  const store = new TicketDraftStore(null);
  store.edit(owner, 'Keep while navigating');
  store.read({ ...owner, ticketId: 11 });
  assert.equal(store.read(owner).reply, 'Keep while navigating');
  assert.equal(store.persistent, false);
});

test('bulk resolution targets and count contain only visible selected tickets after filtering or refresh', () => {
  const selected = [10, 11, 12, 12];
  const visible = [{ id: 11 }, { id: 12 }, { id: 15 }];
  const targets = visibleTicketSelection(selected, visible);
  assert.deepEqual(targets, [11, 12]);
  assert.equal(targets.length, 2);
  assert.deepEqual(visibleTicketSelection(selected, [{ id: 12 }]), [12], 'A refresh removing ticket 11 must also remove it from action targets.');
  assert.deepEqual(visibleTicketSelection(selected, []), []);
  assert.deepEqual(selected, [10, 11, 12, 12], 'Reconciliation must not mutate React state.');
});
