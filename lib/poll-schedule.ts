/**
 * Adaptive cadence for the automatic workspace refresh.
 *
 * The interval stays at 5 s while someone is working, because the open ticket's
 * conversation depends on it. Idle or hidden tabs poll less often, and a tab
 * hidden for a long time stops entirely (it resumes as soon as it is shown
 * again). A forgotten tab therefore cannot keep the database awake forever.
 */
export const ACTIVE_POLL_MS = 5_000;
export const IDLE_POLL_MS = 15_000;
export const DEEP_IDLE_POLL_MS = 30_000;
export const HIDDEN_POLL_MS = 30_000;
export const IDLE_AFTER_MS = 2 * 60_000;
export const DEEP_IDLE_AFTER_MS = 10 * 60_000;
/** A tab hidden for longer than this stops polling until it becomes visible. */
export const SUSPEND_HIDDEN_AFTER_MS = 60 * 60_000;
export const MAX_POLL_DELAY_MS = 120_000;

export interface PollState {
  hidden: boolean;
  /** Milliseconds since the last click, key press, touch or scroll. */
  sinceInteractionMs: number;
  /** Milliseconds the tab has been hidden; ignored while visible. */
  hiddenForMs: number;
  /** Consecutive failed reads, used for exponential backoff. */
  failures: number;
}

/** Delay before the next read, or null when polling should pause. */
export function pollDelay(state: PollState): number | null {
  let base: number;
  if (state.hidden) {
    if (state.hiddenForMs >= SUSPEND_HIDDEN_AFTER_MS) return null;
    base = HIDDEN_POLL_MS;
  } else if (state.sinceInteractionMs >= DEEP_IDLE_AFTER_MS) base = DEEP_IDLE_POLL_MS;
  else if (state.sinceInteractionMs >= IDLE_AFTER_MS) base = IDLE_POLL_MS;
  else base = ACTIVE_POLL_MS;
  const failures = Math.max(0, Math.min(Math.floor(state.failures), 3));
  return Math.min(base * 2 ** failures, MAX_POLL_DELAY_MS);
}
