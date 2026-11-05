import test from 'node:test';
import assert from 'node:assert/strict';
import { activeEscalationReasons, DEFAULT_ESCALATION_POLICY, escalationRecipients, escalationStageKey } from '../lib/escalation-policy';
const policy = { ...DEFAULT_ESCALATION_POLICY, enabled: true, activatedAt: '2026-11-05T00:00:00.000Z' };
const clock = { status: 'open', dueAt: '2026-11-05T12:00:00.000Z', unansweredSince: '2026-11-05T08:00:00.000Z', unansweredMessageId: 7 };
test('escalation honors configured thresholds, grouped conditions and genuine public response reset', () => {
  assert.deepEqual(activeEscalationReasons(clock, policy, new Date('2026-11-05T11:59:59Z')), []);
  assert.deepEqual(activeEscalationReasons(clock, policy, new Date('2026-11-05T12:00:00Z')), ['unanswered']);
  assert.deepEqual(activeEscalationReasons(clock, policy, new Date('2026-11-05T13:00:00Z')), ['unanswered', 'overdue']);
  assert.deepEqual(activeEscalationReasons({ ...clock, unansweredSince: null, unansweredMessageId: null }, policy, new Date('2026-11-05T13:00:00Z')), ['overdue']);
  assert.deepEqual(activeEscalationReasons({ ...clock, status: 'resolved' }, policy, new Date('2026-11-05T13:00:00Z')), []);
  assert.deepEqual(activeEscalationReasons(clock, DEFAULT_ESCALATION_POLICY, new Date('2026-11-05T13:00:00Z')), []);
});
test('escalation reaches only another configured active staff account', () => {
  const staff = [
    { id: 'a', role: 'owner', status: 'active', userId: 'one' },
    { id: 'b', role: 'admin', status: 'active', userId: 'two' },
    { id: 'c', role: 'client', status: 'active', userId: 'three' },
    { id: 'd', role: 'agent', status: 'revoked', userId: 'four' },
    { id: 'e', role: 'agent', status: 'invited', userId: null },
  ];
  assert.deepEqual(escalationRecipients(staff, 'a', ['a', 'b', 'c', 'd', 'e', 'b']), ['b']);
  assert.deepEqual(escalationRecipients(staff, null, ['a', 'b']), ['a', 'b']);
});
test('stage idempotency does not change when due dates or assignment change, unanswered episodes do', () => {
  const input = { activationAt: policy.activatedAt!, cycleMessageId: 7, reason: 'overdue' as const, unansweredMessageId: 8, recipientMemberId: 'b' };
  assert.equal(escalationStageKey(input), escalationStageKey({ ...input, unansweredMessageId: 9 }));
  assert.notEqual(escalationStageKey({ ...input, reason: 'unanswered' }), escalationStageKey({ ...input, reason: 'unanswered', unansweredMessageId: 9 }));
});
