import test from 'node:test';
import assert from 'node:assert/strict';
import { DESK_VIEWS, SETTINGS_SECTIONS, deskQuery, isDeskView, isSettingsSection, leaveTicket, navigateDesk, parseDeskLocation, parseTicketId } from '../lib/desk-url';

const company = 'af1aba5f-a6ba-4a09-98f1-fc39ccf1d172';
const params = (query: string) => new URLSearchParams(query);

test('the URL decides the view and the open ticket', () => {
  assert.deepEqual(parseDeskLocation(params('')), { view: 'inbox', ticketId: null, companyId: null, section: 'general' });
  assert.deepEqual(parseDeskLocation(params('view=overview')), { view: 'overview', ticketId: null, companyId: null, section: 'general' });
  assert.deepEqual(parseDeskLocation(params('ticket=12')), { view: 'inbox', ticketId: 12, companyId: null, section: 'general' });
  assert.deepEqual(parseDeskLocation(params(`view=service&company=${company.toUpperCase()}`)), { view: 'service', ticketId: null, companyId: company, section: 'general' });
});

test('the older service-context link still opens the service view', () => {
  assert.equal(parseDeskLocation(params('serviceContext=1')).view, 'service');
  assert.equal(parseDeskLocation(params(`serviceContext=1&company=${company}`)).companyId, company);
  assert.equal(parseDeskLocation(params('serviceContext=0')).view, 'inbox');
});

test('unknown views, bad ticket numbers and bad company ids fall back safely', () => {
  assert.equal(parseDeskLocation(params('view=../../etc')).view, 'inbox');
  assert.equal(parseDeskLocation(params('view=__proto__')).view, 'inbox');
  for (const bad of ['0', '-3', '1.5', 'abc', '', '9007199254740992', '12abc', ' 12']) assert.equal(parseTicketId(bad), null, bad);
  assert.equal(parseTicketId('007'), 7);
  assert.equal(parseDeskLocation(params('view=service&company=not-a-uuid')).companyId, null);
});

test('every view survives a round trip and the inbox is the bare URL', () => {
  for (const view of DESK_VIEWS) {
    assert.ok(isDeskView(view));
    assert.equal(parseDeskLocation(params(deskQuery({ view }))).view, view);
  }
  assert.equal(deskQuery({ view: 'inbox' }), '');
  assert.equal(deskQuery({}), '');
  assert.equal(deskQuery({ view: 'security' }), '?view=security');
  assert.equal(deskQuery({ ticketId: 5, view: 'overview' }), '?ticket=5');
  assert.equal(deskQuery({ view: 'service', companyId: company }), `?view=service&company=${company}`);
  assert.equal(deskQuery({ view: 'contacts', companyId: company }), '?view=contacts');
  assert.equal(deskQuery({ view: 'service', companyId: 'nope' }), '?view=service');
});

const ignoredByNext: string[] = [];
type FakeHistory = { entries: { state: unknown; url: string }[]; index: number; state: unknown };
function fakeBrowser(start: string, state: unknown = null) {
  const history: FakeHistory = { entries: [{ state, url: start }], index: 0, state };
  const location = { pathname: start.split('?')[0], search: start.includes('?') ? `?${start.split('?')[1]}` : '' };
  const sync = () => { const url = history.entries[history.index].url; location.pathname = url.split('?')[0]; location.search = url.includes('?') ? `?${url.split('?')[1]}` : ''; history.state = history.entries[history.index].state; };
  const api = {
    get state() { return history.state; },
    pushState(next: unknown, _title: string, url: string) { history.entries.splice(history.index + 1); history.entries.push({ state: next, url }); history.index++; sync(); },
    // Next.js ignores a call whose state already carries its internals (`__NA`): the URL changes but
    // `useSearchParams` does not. The fake reports that so the test can catch it.
    replaceState(next: unknown, _title: string, url: string) {
      if ((next as { __NA?: boolean } | null)?.__NA) ignoredByNext.push(url);
      history.entries[history.index] = { state: next, url }; sync();
    },
    back() { if (history.index > 0) { history.index--; sync(); } },
  };
  (globalThis as unknown as { window: unknown }).window = { location, history: api };
  return { history, location };
}

test('navigating pushes real history entries and skips repeats', () => {
  const { history, location } = fakeBrowser('/');
  navigateDesk({ view: 'overview' });
  navigateDesk({ view: 'overview' });
  navigateDesk({ ticketId: 9 });
  assert.equal(history.entries.length, 3);
  assert.equal(`${location.pathname}${location.search}`, '/?ticket=9');
  assert.equal(history.entries[1].url, '/?view=overview');
});

test('a workspace path is preserved when the view changes', () => {
  const { location } = fakeBrowser('/w/alpha');
  navigateDesk({ view: 'security' });
  assert.equal(`${location.pathname}${location.search}`, '/w/alpha?view=security');
  navigateDesk({ view: 'inbox' });
  assert.equal(`${location.pathname}${location.search}`, '/w/alpha');
});

test('leaving a ticket opened from the list goes back; a shared link goes to the inbox in place', () => {
  const opened = fakeBrowser('/');
  navigateDesk({ ticketId: 4 });
  leaveTicket();
  assert.equal(opened.history.index, 0);
  assert.equal(opened.location.search, '');

  const shared = fakeBrowser('/?ticket=4', { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: [] });
  leaveTicket();
  assert.equal(shared.history.entries.length, 1, 'no extra entry and no trip out of the app');
  assert.equal(shared.location.search, '');
  assert.deepEqual(ignoredByNext, [], 'Next.js internal state must not be passed back to replaceState');
});

test('replacing keeps the in-app marker without copying anything else', () => {
  const { history } = fakeBrowser('/?ticket=4', { deskNav: true, __NA: true });
  navigateDesk({ view: 'overview' }, 'replace');
  assert.deepEqual(history.entries[0].state, { deskNav: true });
  assert.deepEqual(ignoredByNext, []);
});

test('with no window the helpers do nothing', () => {
  delete (globalThis as { window?: unknown }).window;
  assert.doesNotThrow(() => { navigateDesk({ view: 'team' }); leaveTicket(); });
});

test('a settings section lives in the URL and only counts for the settings view', () => {
  assert.equal(parseDeskLocation(params('view=settings')).section, 'general');
  assert.equal(parseDeskLocation(params('view=settings&section=mail')).section, 'mail');
  assert.equal(parseDeskLocation(params('view=settings&section=nope')).section, 'general');
  assert.equal(parseDeskLocation(params('view=team&section=mail')).section, 'general', 'ignored outside Configuración');
  assert.equal(parseDeskLocation(params('section=backups')).section, 'general');
  assert.equal(deskQuery({ view: 'settings' }), '?view=settings');
  assert.equal(deskQuery({ view: 'settings', section: 'general' }), '?view=settings');
  assert.equal(deskQuery({ view: 'settings', section: 'backups' }), '?view=settings&section=backups');
  assert.equal(deskQuery({ view: 'team', section: 'mail' }), '?view=team');
  assert.equal(deskQuery({ ticketId: 3, view: 'settings', section: 'mail' }), '?ticket=3');
  for (const section of SETTINGS_SECTIONS) assert.equal(parseDeskLocation(params(deskQuery({ view: 'settings', section }).slice(1))).section, section);
  assert.equal(isSettingsSection('mail'), true);
  assert.equal(isSettingsSection('__proto__'), false);
});
