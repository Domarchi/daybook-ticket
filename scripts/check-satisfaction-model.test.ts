import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canSubmitSatisfaction,
  satisfactionDraftFor,
  satisfactionIsEnabled,
  satisfactionScoreLabel,
} from '../lib/satisfaction-model';
const allowed = {
  viewerRole: 'client',
  viewerMemberId: 'client',
  requesterMemberId: 'client',
  invitationRequesterId: 'client',
  status: 'resolved',
  latestResolutionKey: 'resolution-one',
  resolutionKey: 'resolution-one',
  submittedAt: null,
};
test('only the current requester can rate the latest genuinely resolved cycle once', () => {
  assert.equal(canSubmitSatisfaction(allowed), true);
  for (const change of [
    { viewerRole: 'owner' },
    { viewerMemberId: 'manager' },
    { requesterMemberId: 'other' },
    { status: 'open' },
    { status: 'pending' },
    { latestResolutionKey: 'resolution-two' },
    { latestResolutionKey: null },
    { submittedAt: '2026-11-05T10:00:00Z' },
  ])
    assert.equal(canSubmitSatisfaction({ ...allowed, ...change }), false);
});
test('score labels explain the complete 1–5 scale', () => {
  assert.equal(satisfactionScoreLabel(1), 'Muy insatisfecho');
  assert.equal(satisfactionScoreLabel(5), 'Muy satisfecho');
  assert.equal(satisfactionScoreLabel(0), 'Sin calificación');
});
test('survey drafts survive unrelated ticket versions but never carry into a new resolution cycle', () => {
  const draft = { surveyId: 'resolution-one', score: 4, comment: 'Borrador conservado' };
  assert.strictEqual(satisfactionDraftFor(draft, 'resolution-one'), draft);
  assert.deepEqual(satisfactionDraftFor(draft, 'resolution-two'), {
    surveyId: 'resolution-two',
    score: 0,
    comment: '',
  });
  assert.deepEqual(satisfactionDraftFor(null, 'resolution-one'), { surveyId: 'resolution-one', score: 0, comment: '' });
});
test('the independent satisfaction kill switch is opt-out and does not depend on mail configuration', () => {
  assert.equal(satisfactionIsEnabled(), true);
  assert.equal(satisfactionIsEnabled('true'), true);
  assert.equal(satisfactionIsEnabled('false'), false);
  assert.equal(satisfactionIsEnabled(' FALSE '), false);
});
