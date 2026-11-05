/** Preloaded by the serial QA harness only. Preserve finally cleanup on timeout. */
import assert from 'node:assert/strict';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
assert.equal(process.env.DAYBOOK_SITE_URL, 'http://127.0.0.1:5175');
const timeoutMs = 300_000, cleanupMs = 60_000;
const nativeFetch = globalThis.fetch;
const deadline = new AbortController();
let expired = false;
function expire() {
  if (expired) return;
  expired = true; process.exitCode = 124;
  console.error('QA_HTTP_DEADLINE: cancelling requests; fixture cleanup has a 60-second grace period.');
  deadline.abort(new DOMException('QA HTTP child exceeded its five-minute deadline.', 'AbortError'));
  setTimeout(() => { console.error('QA_HTTP_CLEANUP_DEADLINE: review this run before continuing QA.'); process.exit(124); }, cleanupMs).unref();
}
setTimeout(expire, timeoutMs).unref();
process.once('SIGTERM', expire);
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.origin !== 'http://127.0.0.1:5175') return Promise.reject(new Error('QA HTTP regressions only allow the approved local origin.'));
  const closingSession = url.pathname === '/api/auth/sign-out';
  const supplied = init?.signal ?? (input instanceof Request ? input.signal : null);
  const signals = [AbortSignal.timeout(45_000), ...(supplied ? [supplied] : []), ...(!closingSession ? [deadline.signal] : [])];
  return nativeFetch(input, { ...init, signal: AbortSignal.any(signals) });
};
