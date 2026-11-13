import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { DATABASE_CHECKS, databaseCheckCi } from './database-check-target.mjs';

const local = 'postgresql://daybook_db_ci:x@127.0.0.1:5432/daybook_db_ci?sslmode=disable';

function withEnv(values: Record<string, string | undefined>, work: () => void) {
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    work();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const ciEnv = {
  CI: 'true',
  DAYBOOK_DATABASE_CI: '1',
  DATABASE_URL: local,
  DAYBOOK_QA_ALLOW_TEST_DATABASE: undefined,
  RESEND_API_KEY: undefined,
  RESEND_INBOUND_API_KEY: undefined,
  DAYBOOK_EMAIL_FROM: undefined,
  VAPID_PRIVATE_KEY: undefined,
  DAYBOOK_BLOB_PRODUCTION_READ_WRITE_TOKEN: undefined,
  DAYBOOK_BLOB_QA_READ_WRITE_TOKEN: undefined,
  ANTHROPIC_API_KEY: undefined,
  VERCEL_ENV: undefined,
};

test('every database check runs in the CI job (the recovery drill has its own)', async () => {
  const scripts = (await readdir('scripts'))
    .filter(name => /^check-.*database\.mjs$/.test(name) && name !== 'check-backup-recovery-database.mjs')
    .sort();
  assert.deepEqual([...DATABASE_CHECKS].sort(), scripts);
  for (const name of DATABASE_CHECKS) {
    const source = await readFile(`scripts/${name}`, 'utf8');
    assert.match(source, /const databaseCi = databaseCheckCi\(\);/, `${name} uses the shared CI guard`);
  }
});

test('without the CI flag the QA guards of each script stay in charge', () => {
  withEnv({ DAYBOOK_DATABASE_CI: undefined }, () => assert.equal(databaseCheckCi(), false));
});

test('the CI mode accepts only the local disposable database', () => {
  withEnv(ciEnv, () => assert.equal(databaseCheckCi(), true));
  for (const DATABASE_URL of [
    'postgresql://daybook_db_ci:x@db.example.test:5432/daybook_db_ci',
    'postgresql://daybook_db_ci:x@127.0.0.1:5433/daybook_db_ci',
    'postgresql://daybook_db_ci:x@127.0.0.1:5432/daybook_ticket',
    'postgresql://neondb_owner:x@127.0.0.1:5432/daybook_db_ci',
    'mysql://daybook_db_ci:x@127.0.0.1:5432/daybook_db_ci',
  ])
    withEnv({ ...ciEnv, DATABASE_URL }, () => assert.throws(() => databaseCheckCi()));
});

test('the CI mode refuses QA variables, delivery keys and production', () => {
  for (const extra of [
    { CI: undefined },
    { DAYBOOK_DATABASE_CI: 'true' },
    { DAYBOOK_QA_ALLOW_TEST_DATABASE: '1' },
    { RESEND_API_KEY: 're_fictional' },
    { DAYBOOK_EMAIL_FROM: 'QA <qa@example.test>' },
    { VAPID_PRIVATE_KEY: 'fictional' },
    { DAYBOOK_BLOB_QA_READ_WRITE_TOKEN: 'fictional' },
    { ANTHROPIC_API_KEY: 'fictional' },
    { VERCEL_ENV: 'production' },
  ])
    withEnv({ ...ciEnv, ...extra }, () => assert.throws(() => databaseCheckCi()));
});
