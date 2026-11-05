import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchingAssignmentRule, publicAssignmentRule, selectAutomaticAssignee,
  type AssignmentRule, type AssignmentCandidate,
} from '../lib/automatic-assignment';

const ticket = { customerCompanyId: 'company-a', department: 'Soporte' };
function rule(changes: Partial<AssignmentRule> = {}): AssignmentRule {
  return { id: 'rule-a', name: 'Reparto QA', customerCompanyId: null, department: null,
    enabled: true, position: 10, agentMemberIds: ['a', 'b'], version: 0,
    createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z', ...changes };
}
function agent(id: string, changes: Partial<AssignmentCandidate> = {}): AssignmentCandidate {
  return { id, name: id.toUpperCase(), role: 'agent', status: 'active', hasAccount: true,
    available: true, capacity: 20, openTickets: 0, lastAssignedAt: null, ...changes };
}

test('automatic routing is inactive without an explicitly enabled matching rule', () => {
  const pool = [agent('a'), agent('b')];
  assert.equal(selectAutomaticAssignee([], pool, ticket), null);
  assert.equal(selectAutomaticAssignee([rule({ enabled: false })], pool, ticket), null);
  assert.equal(selectAutomaticAssignee([rule({ customerCompanyId: 'company-b' })], pool, ticket), null);
  assert.equal(selectAutomaticAssignee([rule({ department: 'Ventas' })], pool, ticket), null);
  assert.equal(selectAutomaticAssignee([rule({ customerCompanyId: 'company-a', department: 'Soporte' })], pool, ticket)?.id, 'a');
});

test('explicit rule order and stable id decide the first match without modifying inputs', () => {
  const rules = [rule({ id: 'z', position: 2 }), rule({ id: 'b', position: 1 }), rule({ id: 'a', position: 1 })];
  const snapshot = structuredClone(rules);
  assert.equal(matchingAssignmentRule(rules, ticket)?.id, 'a');
  assert.deepEqual(rules, snapshot);
});

test('first matching rule never falls through when its agents are unavailable or full', () => {
  const first = rule({ agentMemberIds: ['a'], position: 1 });
  const fallback = rule({ id: 'fallback', agentMemberIds: ['b'], position: 2 });
  assert.equal(selectAutomaticAssignee([fallback, first], [agent('a', { available: false }), agent('b')], ticket), null);
  assert.equal(selectAutomaticAssignee([first, fallback], [agent('a', { capacity: 1, openTickets: 1 }), agent('b')], ticket), null);
});

test('only the selected active staff pool can receive automatic assignments', () => {
  const invalid = [
    { role: 'client' }, { role: 'unexpected' }, { status: 'invited' }, { status: 'revoked' },
    { hasAccount: false }, { available: false },
  ];
  for (const changes of invalid) {
    const result = selectAutomaticAssignee([rule()], [agent('a', changes), agent('b'), agent('outside')], ticket);
    assert.equal(result?.id, 'b', JSON.stringify(changes));
  }
  assert.equal(selectAutomaticAssignee([rule({ agentMemberIds: ['missing'] })], [agent('a')], ticket), null);
  assert.equal(selectAutomaticAssignee([rule({ agentMemberIds: [] })], [agent('a')], ticket), null);
});

test('lowest current load wins before recency, retaining stable rule identity', () => {
  const result = selectAutomaticAssignee([rule()], [
    agent('a', { openTickets: 2, lastAssignedAt: null }),
    agent('b', { openTickets: 1, lastAssignedAt: '2026-11-04T12:00:00Z' }),
  ], ticket);
  assert.deepEqual(result, { id: 'b', name: 'B', ruleId: 'rule-a' });
});

test('capacity is a strict upper bound for automatic routing and malformed loads fail closed', () => {
  for (const changes of [
    { capacity: 0 }, { capacity: -1 }, { capacity: 1.5 }, { openTickets: -1 },
    { openTickets: Number.NaN }, { openTickets: 0.5 }, { capacity: 2, openTickets: 2 },
    { capacity: 2, openTickets: 3 },
  ]) assert.equal(selectAutomaticAssignee([rule()], [agent('a', changes), agent('b')], ticket)?.id, 'b');
  assert.equal(selectAutomaticAssignee([rule()], [agent('a', { capacity: 1, openTickets: 0 })], ticket)?.id, 'a');
});

test('equal load prefers least recently automatically assigned, then stable member id', () => {
  assert.equal(selectAutomaticAssignee([rule()], [
    agent('b', { lastAssignedAt: null }), agent('a', { lastAssignedAt: '2026-11-04T10:00:00Z' }),
  ], ticket)?.id, 'b');
  assert.equal(selectAutomaticAssignee([rule()], [
    agent('a', { lastAssignedAt: '2026-11-04T11:00:00Z' }), agent('b', { lastAssignedAt: '2026-11-04T10:00:00Z' }),
  ], ticket)?.id, 'b');
  assert.equal(selectAutomaticAssignee([rule()], [agent('b'), agent('a')], ticket)?.id, 'a');
  assert.equal(selectAutomaticAssignee([rule()], [agent('b', { lastAssignedAt: 'invalid' }), agent('a')], ticket)?.id, 'a');
});

test('selection preserves candidate records and never uses names to identify a person', () => {
  const candidates = [agent('b', { name: 'Nombre igual' }), agent('a', { name: 'Nombre igual' })];
  const before = structuredClone(candidates);
  assert.equal(selectAutomaticAssignee([rule()], candidates, ticket)?.id, 'a');
  assert.deepEqual(candidates, before);
});

test('malformed persisted agent JSON cannot expand a rule pool', () => {
  const { agentMemberIds: _ids, ...base } = rule();
  void _ids;
  for (const json of ['invalid', '{}', 'null', '["a",42]']) {
    const parsed = publicAssignmentRule({ ...base, agentMemberIdsJson: json });
    assert.deepEqual(parsed.agentMemberIds, []);
    assert.equal(selectAutomaticAssignee([parsed], [agent('a')], ticket), null);
  }
  assert.deepEqual(publicAssignmentRule({ ...base, agentMemberIdsJson: '["a","a","b"]' }).agentMemberIds, ['a', 'b']);
});
