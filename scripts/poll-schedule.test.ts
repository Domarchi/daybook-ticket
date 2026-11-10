import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTIVE_POLL_MS,
  DEEP_IDLE_AFTER_MS,
  DEEP_IDLE_POLL_MS,
  HIDDEN_POLL_MS,
  IDLE_AFTER_MS,
  IDLE_POLL_MS,
  MAX_POLL_DELAY_MS,
  SUSPEND_HIDDEN_AFTER_MS,
  pollDelay,
  type PollState,
} from '../lib/poll-schedule';

const base: PollState = { hidden: false, sinceInteractionMs: 0, hiddenForMs: 0, failures: 0 };

test('an active visible tab keeps the original five second cadence', () => {
  assert.equal(pollDelay(base), ACTIVE_POLL_MS);
  assert.equal(pollDelay({ ...base, sinceInteractionMs: IDLE_AFTER_MS - 1 }), ACTIVE_POLL_MS);
});

test('a visible tab slows down after two minutes and again after ten without interaction', () => {
  assert.equal(pollDelay({ ...base, sinceInteractionMs: IDLE_AFTER_MS }), IDLE_POLL_MS);
  assert.equal(pollDelay({ ...base, sinceInteractionMs: DEEP_IDLE_AFTER_MS - 1 }), IDLE_POLL_MS);
  assert.equal(pollDelay({ ...base, sinceInteractionMs: DEEP_IDLE_AFTER_MS }), DEEP_IDLE_POLL_MS);
  // A visible tab is never suspended: a wall monitor must keep showing new tickets.
  assert.equal(pollDelay({ ...base, sinceInteractionMs: 24 * 60 * 60_000 }), DEEP_IDLE_POLL_MS);
});

test('a hidden tab polls at the hidden cadence and stops after an hour', () => {
  assert.equal(pollDelay({ ...base, hidden: true, hiddenForMs: 0 }), HIDDEN_POLL_MS);
  assert.equal(pollDelay({ ...base, hidden: true, hiddenForMs: SUSPEND_HIDDEN_AFTER_MS - 1 }), HIDDEN_POLL_MS);
  assert.equal(pollDelay({ ...base, hidden: true, hiddenForMs: SUSPEND_HIDDEN_AFTER_MS }), null);
});

test('hidden time is ignored while the tab is visible', () => {
  assert.equal(pollDelay({ ...base, hidden: false, hiddenForMs: SUSPEND_HIDDEN_AFTER_MS * 2 }), ACTIVE_POLL_MS);
});

test('failures back off exponentially up to three doublings and the global cap', () => {
  assert.equal(pollDelay({ ...base, failures: 1 }), ACTIVE_POLL_MS * 2);
  assert.equal(pollDelay({ ...base, failures: 3 }), ACTIVE_POLL_MS * 8);
  assert.equal(pollDelay({ ...base, failures: 99 }), ACTIVE_POLL_MS * 8);
  assert.equal(pollDelay({ ...base, hidden: true, failures: 3 }), Math.min(HIDDEN_POLL_MS * 8, MAX_POLL_DELAY_MS));
  assert.equal(pollDelay({ ...base, sinceInteractionMs: DEEP_IDLE_AFTER_MS, failures: 3 }), MAX_POLL_DELAY_MS);
});

test('invalid failure counts cannot produce a negative or fractional delay', () => {
  assert.equal(pollDelay({ ...base, failures: -4 }), ACTIVE_POLL_MS);
  assert.equal(pollDelay({ ...base, failures: 1.9 }), ACTIVE_POLL_MS * 2);
});
