/**
 * Where a `check-*-database` script may write. Two targets only:
 * - CI: a disposable Postgres service on this runner (`CI=true`, `DAYBOOK_DATABASE_CI=1`,
 *   127.0.0.1:5432, database and user `daybook_db_ci`). Nothing else is accepted in this mode.
 * - QA: the isolated Neon branch, guarded by each script exactly as before.
 * Real mail, inbound mail and push keys must be absent in both.
 */
import assert from 'node:assert/strict';

export const DATABASE_CHECK_CI_NAME = 'daybook_db_ci';

/** Run in this order by the CI job. The recovery drill has its own job (recovery-drill.yml). */
export const DATABASE_CHECKS = [
  'check-database.mjs',
  'check-test-data-database.mjs',
  'check-reminders-database.mjs',
  'check-service-policies-database.mjs',
  'check-automatic-assignment-database.mjs',
  'check-agent-metrics-database.mjs',
  'check-inbound-email-database.mjs',
  'check-inbound-reliability-database.mjs',
  'check-service-plus-automation-database.mjs',
  'check-service-plus-access-races-database.mjs',
  'check-ticket-search-database.mjs',
  'check-attachment-preview-database.mjs',
  'check-ticket-presence-database.mjs',
  'check-automatic-backup-database.mjs',
  'check-security-database.mjs',
  'check-collaboration-database.mjs',
  'check-collaboration-draft-locks-database.mjs',
  'check-work-organization-database.mjs',
  'check-service-context-database.mjs',
  'check-automation-database.mjs',
  'check-knowledge-database.mjs',
  'check-commercial-workspaces-database.mjs',
  'check-workspace-invitation-race-database.mjs',
  'check-push-registration-transition-database.mjs',
];

/** True when the script runs against the disposable CI database (and that database is verified). */
export function databaseCheckCi() {
  if (process.env.DAYBOOK_DATABASE_CI === undefined) return false;
  assert.equal(process.env.CI, 'true', 'DAYBOOK_DATABASE_CI solo vale dentro del CI.');
  assert.equal(process.env.DAYBOOK_DATABASE_CI, '1');
  assert.ok(!process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, 'El modo CI no comparte variables con QA.');
  const url = new URL(process.env.DATABASE_URL || '');
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'El modo CI solo usa una base local.');
  assert.equal(url.port, '5432');
  assert.equal(url.pathname, `/${DATABASE_CHECK_CI_NAME}`);
  assert.equal(url.username, DATABASE_CHECK_CI_NAME);
  assert.notEqual(process.env.VERCEL_ENV, 'production');
  for (const name of [
    'RESEND_API_KEY',
    'RESEND_INBOUND_API_KEY',
    'DAYBOOK_EMAIL_FROM',
    'VAPID_PRIVATE_KEY',
    'DAYBOOK_BLOB_PRODUCTION_READ_WRITE_TOKEN',
    'DAYBOOK_BLOB_QA_READ_WRITE_TOKEN',
    'ANTHROPIC_API_KEY',
  ])
    assert.ok(!process.env[name], `${name} debe estar vacío en el CI de base de datos.`);
  return true;
}
