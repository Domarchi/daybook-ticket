import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
const pushApiFixtures = process.argv.slice(2).includes('--push-api-fixtures');
assert.ok(process.argv.slice(2).every(arg => arg === '--push-api-fixtures'), 'Unknown QA launcher option.');
process.loadEnvFile('.env.test.local');
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE,'1');
assert.equal(new URL(process.env.DATABASE_URL).hostname,'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
assert.equal(process.env.DAYBOOK_SITE_URL,'http://127.0.0.1:5173');
assert.ok(!process.env.RESEND_API_KEY,'QA cannot send real mail.');
assert.ok(!process.env.DAYBOOK_EMAIL_FROM,'QA cannot configure a real sender.');
if (pushApiFixtures) {
  // Explicit local test window only. Read these keys from the guarded QA file,
  // never from inherited production credentials. The regression injects its sender.
  const qa = parseEnv(readFileSync('.env.test.local', 'utf8'));
  assert.ok(qa.VAPID_PUBLIC_KEY && qa.VAPID_PRIVATE_KEY && qa.VAPID_SUBJECT, 'Missing isolated QA VAPID keys.');
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM "pushSubscriptions" WHERE active=true')).rows[0].n, 0, 'Push fixture mode requires zero active devices.');
  } finally { await pool.end(); }
  for (const key of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) process.env[key] = qa[key];
} else process.env.VAPID_PRIVATE_KEY='';
process.argv=[process.argv[0],'next','dev','--webpack','--hostname','127.0.0.1','--port','5173'];
await import('next/dist/bin/next');
