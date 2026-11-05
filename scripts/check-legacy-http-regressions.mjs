/** SERIAL legacy HTTP regression coordinator. Obtain the shared QA lease first.
 * Uses only .env.test.local, the fixed QA host and the already running local server.
 * No fixture is retained; each child is responsible for its own finally cleanup.
 * The local server must start with DAYBOOK_NOTIFICATION_JOB_ENABLED=true so the
 * authenticated manual notification tick can run; remote schedules stay disabled
 * and all email/push provider keys remain absent. No .env file change is needed.
 * DAYBOOK_NOTIFICATION_JOB_ENABLED=true node --env-file=.env.test.local --import tsx scripts/check-legacy-http-regressions.mjs
 * Optional: --from <allowed-script.mjs> resumes at a previously failed child.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const directory = fileURLToPath(new URL('../', import.meta.url));
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
assert.equal(new URL(process.env.DATABASE_URL).hostname, 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
assert.equal(process.env.DAYBOOK_QA_DATABASE_HOST, 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/daybook_ticket');
assert.equal(process.env.DAYBOOK_SITE_URL, 'http://127.0.0.1:5175');
assert.notEqual(process.env.VERCEL_ENV, 'production');
for (const name of ['RESEND_API_KEY', 'RESEND_INBOUND_API_KEY', 'DAYBOOK_EMAIL_FROM', 'VAPID_PRIVATE_KEY', 'DAYBOOK_BLOB_PRODUCTION_READ_WRITE_TOKEN']) assert.ok(!process.env[name], `${name} must be absent.`);

const batch = ['check-access.mjs', 'check-operations-http.mjs', 'check-legacy-sla-http.mjs', 'check-notifications-http.mjs', 'check-team-release.mjs', 'check-notification-responsibles.mjs'];
const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === '--from' && batch.includes(args[1]), 'Only the reviewed batch or an allowed resume point may be selected.');
const selected = args.length ? batch.slice(batch.indexOf(args[1])) : batch;
const logs = resolve(directory, 'work/REGRESSION_HTTP_SERVICE_PLUS_2026-11-05');
await mkdir(logs, { recursive: true, mode: 0o700 }); await chmod(logs, 0o700);
const report = { startedAt: new Date().toISOString(), origin: process.env.DAYBOOK_SITE_URL, completed: false, results: [] };
const attempt = Date.now();
for (const script of selected) {
  console.log(`RUN HTTP regression: ${script}`);
  const started = Date.now();
  const childArgs = ['--env-file=.env.test.local', '--import', 'tsx', '--import', './scripts/qa-http-deadline.mjs', `scripts/${script}`, ...(script === 'check-access.mjs' ? [process.env.DAYBOOK_SITE_URL] : [])];
  // Child cancels requests at 5 minutes, allowing finally cleanup. Hard-stop only
  // after its one-minute cleanup budget and a final 15-second process grace.
  const result = spawnSync(process.execPath, childArgs, { cwd: directory, env: { ...process.env, DAYBOOK_SITE_URL: 'http://127.0.0.1:5175' }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 375_000, killSignal: 'SIGKILL' });
  const log = resolve(logs, `${script}.${attempt}.log`);
  await writeFile(log, `${result.stdout || ''}\n${result.stderr || ''}`, { mode: 0o600 }); await chmod(log, 0o600);
  const summary = (result.stdout || '').split('\n').filter(line => /^(PASS|QA |Daybook|\{)/.test(line));
  report.results.push({ script, exitCode: result.status ?? 1, timedOut: result.status === 124 || result.error?.code === 'ETIMEDOUT' || (result.stderr || '').includes('QA_HTTP_DEADLINE:'), seconds: Math.round((Date.now() - started) / 100) / 10, log, summary });
  console.log(`${result.status === 0 ? 'PASS' : 'FAIL'} HTTP regression: ${script}`);
  if (result.status !== 0) { process.exitCode = 1; break; }
}
report.completed = report.results.length === selected.length && report.results.every(result => result.exitCode === 0);
const reportPath = resolve(logs, `RESULT.${attempt}.json`);
await writeFile(reportPath, JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 }); await chmod(reportPath, 0o600);
console.log(`Private HTTP regression report: ${reportPath}`);
