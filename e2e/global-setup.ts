import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import {
  assertDisposableDatabase,
  DATABASE_URL,
  BASE_URL,
  OWNER_EMAIL,
  OWNER_NAME,
  RUN_FILE,
  STATE_DIR,
  type RunState,
} from './support/env';

/**
 * Starts every run from an empty database: wipe the disposable schema, apply the real migrations, and reserve the
 * owner workspace exactly as an operator would. The first test then activates it through the real invitation link.
 */
export default async function globalSetup() {
  assertDisposableDatabase(DATABASE_URL);
  rmSync(STATE_DIR, { recursive: true, force: true });
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });

  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
  } finally {
    await pool.end();
  }

  const env = { ...process.env, DIRECT_DATABASE_URL: DATABASE_URL, DATABASE_URL };
  execFileSync(process.execPath, ['scripts/migrate.mjs'], { env, stdio: 'inherit' });

  const invitationFile = resolve(STATE_DIR, 'invitation.json');
  execFileSync(process.execPath, ['scripts/provision-owner.mjs', '--output', invitationFile], {
    env: { ...env, DAYBOOK_SITE_URL: BASE_URL, DAYBOOK_OWNER_EMAIL: OWNER_EMAIL, DAYBOOK_OWNER_NAME: OWNER_NAME },
    stdio: 'inherit',
  });
  const { invitationUrl } = JSON.parse(readFileSync(invitationFile, 'utf8')) as { invitationUrl: string };
  rmSync(invitationFile);

  const state: RunState = { invitationUrl, password: `E2e-${randomBytes(12).toString('hex')}` };
  writeFileSync(RUN_FILE, JSON.stringify(state), { mode: 0o600 });
}
