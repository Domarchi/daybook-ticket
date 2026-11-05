import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database } from '../db/database';
import type { AccessContext, MemberRecord } from '../lib/access';
import { heartbeatTicketPresence, readTicketPresence, releaseTicketPresence } from '../lib/ticket-presence';
import { readPublicTicketProgress } from '../lib/ticket-presence-progress';
import { PRESENCE_TTL_MS, currentPresenceActivity, presenceShouldRun, publicTicketProgress, visiblePresence, type PresenceRow } from '../lib/ticket-presence-model';
import { presenceInputSchema } from '../lib/ticket-presence-validation';

const now = new Date('2026-11-05T12:00:00.000Z');
const memberId = '11111111-1111-4111-8111-111111111111', peerId = '22222222-2222-4222-8222-222222222222';
const tabId = '33333333-3333-4333-8333-333333333333';
const member: MemberRecord = { id: memberId, ownerId: 'fixture-owner', organizationId: 'fixture-org', userId: 'fixture-user',
  name: 'QA Staff', email: 'staff@example.test', role: 'agent' as const, status: 'active' as const,
  hasAccount: true, customerCompanyId: null, companyAccess: 'own' as const, createdAt: now.toISOString(), updatedAt: now.toISOString() };
const access: AccessContext = { ownerId: member.ownerId, organizationId: member.organizationId, userId: member.userId!, member, role: member.role };
const ticket = { id: 7, ownerId: member.ownerId, requesterMemberId: peerId, customerCompanyId: null,
  assigneeMemberId: memberId, status: 'open' as const, createdAt: now.toISOString(), dueAt: '2026-11-06T12:00:00.000Z' };
const peer: PresenceRow = { memberId: peerId, name: 'QA Peer', activity: 'reply', updatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + PRESENCE_TTL_MS).toISOString() };

function fixture(options: { fresh?: MemberRecord | null; currentTicket?: typeof ticket | null; tabs?: number } = {}) {
  const calls: { sql: string; values: unknown[] }[] = [];
  let transactions = 0;
  const database = { transaction: async (work: (client: unknown) => Promise<unknown>) => {
    transactions++;
    return work({ query: async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      if (sql.includes('SELECT * FROM members')) return { rows: options.fresh === null ? [] : [options.fresh || member] };
      if (sql.includes('SELECT * FROM tickets')) return { rows: options.currentTicket === null ? [] : [options.currentTicket || ticket] };
      if (sql.includes('count(DISTINCT')) return { rows: [{ total: options.tabs || 0, known: false }] };
      if (sql.includes('SELECT p."memberId"')) return { rows: [peer] };
      if (sql.includes('SELECT name FROM members')) return { rows: [{ name: 'Current public name' }] };
      if (sql.includes('min("createdAt")')) return { rows: [{ firstResponseAt: '2026-11-05T12:01:00.000Z' }] };
      if (sql.includes('SELECT "authorRole" FROM messages')) return { rows: [{ authorRole: 'client' }] };
      return { rows: [], rowCount: 1 };
    } });
  } } as unknown as Database;
  return { database, calls, transactions: () => transactions };
}

test('presence input accepts only tab UUID/activity, never draft text or an authentication token', () => {
  assert.deepEqual(presenceInputSchema.parse({ tabId, activity: 'note' }), { tabId, activity: 'note' });
  for (const input of [{ tabId: 'session-token', activity: 'viewing' }, { tabId, activity: 'sending' }, { tabId, activity: 'reply', body: 'private draft' }, { tabId, activity: 'reply', memberId: peerId }]) {
    assert.equal(presenceInputSchema.safeParse(input).success, false);
  }
});

test('expired, future and own presence is omitted; tabs are deduplicated without leaking tab IDs', () => {
  const result = visiblePresence([peer, { ...peer, activity: 'note', updatedAt: '2026-11-05T11:59:59.000Z' },
    { ...peer, memberId, name: 'Self' }, { ...peer, memberId: 'expired', expiresAt: now.toISOString() },
    { ...peer, memberId: 'future', updatedAt: '2026-11-06T12:00:00.000Z' }, { ...peer, memberId: 'invalid', expiresAt: 'invalid' }], memberId, now);
  assert.deepEqual(result, [{ memberId: peerId, name: peer.name, activity: 'reply', updatedAt: now.toISOString() }]);
  assert.equal(JSON.stringify(result).includes('expiresAt'), false);
});

test('hidden and idle tabs stop work; typing expires before the viewing lease and wins across active tabs', () => {
  const instant = now.getTime();
  assert.equal(presenceShouldRun(false, instant, instant), false);
  assert.equal(presenceShouldRun(true, instant, instant + 119999), true);
  assert.equal(presenceShouldRun(true, instant, instant + 120000), false);
  assert.equal(currentPresenceActivity('note', instant, instant + 10000), 'note');
  assert.equal(currentPresenceActivity('note', instant, instant + 10001), 'viewing');
  const otherTab = { ...peer, activity: 'viewing' as const, updatedAt: new Date(instant + 1000).toISOString() };
  assert.equal(visiblePresence([otherTab, peer], memberId, new Date(instant + 2000))[0].activity, 'reply');
  assert.equal(visiblePresence([peer], memberId, new Date(instant + 11000))[0].activity, 'viewing');
});

test('heartbeat binds server identity, fixed expiry and tab; release cannot remove another person/tab', async () => {
  const f = fixture();
  assert.equal((await heartbeatTicketPresence(f.database, access, 7, { tabId, activity: 'note' }, now)).people.length, 1);
  const insert = f.calls.find(call => call.sql.startsWith('INSERT INTO "ticketPresence"'))!;
  assert.deepEqual(insert.values, [member.ownerId, 7, memberId, tabId, 'note', now.toISOString(), '2026-11-05T12:00:45.000Z']);
  await releaseTicketPresence(f.database, access, 7, tabId);
  const release = f.calls.find(call => call.sql.startsWith('DELETE FROM "ticketPresence" WHERE "ownerId"'))!;
  assert.deepEqual(release.values, [member.ownerId, 7, memberId, tabId]);
  assert.equal(f.calls.some(call => call.sql.includes("m.role IN ('owner','admin','agent')") && call.sql.includes("m.status='active'")), true);
});

test('clients, revoked membership, changed staff role and foreign tickets cannot read or refresh presence', async () => {
  const client = { ...access, role: 'client' as const, member: { ...member, role: 'client' as const } };
  const blocked = fixture();
  await assert.rejects(readTicketPresence(blocked.database, client, 7, now), error => (error as { status?: number }).status === 403);
  assert.equal(blocked.transactions(), 0);
  for (const options of [{ fresh: null }, { fresh: { ...member, role: 'client' as const } }, { currentTicket: { ...ticket, ownerId: 'foreign-owner' } }]) {
    const f = fixture(options);
    await assert.rejects(heartbeatTicketPresence(f.database, access, 7, { tabId, activity: 'reply' }, now));
    assert.equal(f.calls.some(call => call.sql.includes('INSERT INTO "ticketPresence"')), false);
    assert.equal(f.calls.some(call => call.sql.includes('SELECT p."memberId"')), false);
  }
});

test('active tab count is bounded before inserting new presence', async () => {
  const f = fixture({ tabs: 8 });
  await assert.rejects(heartbeatTicketPresence(f.database, access, 7, { tabId, activity: 'viewing' }, now), error => (error as { status?: number }).status === 429);
  assert.equal(f.calls.some(call => call.sql.startsWith('INSERT INTO "ticketPresence"')), false);
});

test('public progress uses actual active assignee name and public aggregates only', async () => {
  const f = fixture();
  const progress = await readPublicTicketProgress(f.database, access, 7);
  assert.equal(progress.responsibleName, 'Current public name');
  assert.equal(progress.firstResponseAt, '2026-11-05T12:01:00.000Z');
  assert.match(progress.nextStep, /revisará tu último mensaje/);
  assert.equal(f.calls.some(call => call.sql.includes("kind<>'note'")), true);
  assert.equal(f.calls.some(call => call.sql.includes("kind='reply'")), true);
  assert.deepEqual(Object.keys(progress).sort(), ['ticketId', 'status', 'responsibleName', 'receivedAt', 'firstResponseAt', 'resolvedAt', 'deadlineAt', 'nextStep'].sort());
  const foreign = fixture({ currentTicket: { ...ticket, ownerId: 'foreign' } });
  await assert.rejects(readPublicTicketProgress(foreign.database, access, 7));
  assert.equal(foreign.calls.some(call => call.sql.includes('SELECT name FROM members')), false);
});

test('resolved progress removes deadline, pending makes no request-for-information claim', () => {
  const input = { ticket, responsibleName: null, firstResponseAt: null, resolvedAt: null, lastPublicAuthorRole: 'client' };
  const resolved = publicTicketProgress({ ...input, ticket: { ...ticket, status: 'resolved' } });
  assert.equal(resolved.deadlineAt, null); assert.equal(resolved.resolvedAt, null); assert.match(resolved.nextStep, /retomarlo/);
  const pending = publicTicketProgress({ ...input, ticket: { ...ticket, status: 'pending' } });
  assert.match(pending.nextStep, /seguimiento/); assert.doesNotMatch(pending.nextStep, /esperamos tu/);
});
