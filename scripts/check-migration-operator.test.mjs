import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import {
  PINNED_MIGRATIONS, MigrationOperatorError, validateProductionConnectionTargets,
  loadPinnedMigrationArtifacts, validateMigrationJournal, createMigrationSavepointClient, runMigrationOperator,
} from './migrate-notifications-production.mjs';

const environment = {
  DATABASE_URL: 'postgresql://qa_fixture:fictional_password@ep-dawn-moon-bbwpjcrp-pooler.c-15.us-east-1.aws.neon.tech/daybook_ticket?sslmode=require',
  DIRECT_DATABASE_URL: 'postgresql://qa_fixture:fictional_password@ep-dawn-moon-bbwpjcrp.c-15.us-east-1.aws.neon.tech/daybook_ticket?sslmode=require&channel_binding=require',
};
const journal = PINNED_MIGRATIONS.map(item => ({ hash: item.hash, created_at: String(item.when) }));
const text = query => typeof query === 'string' ? query : query.text;

async function legacyMigrationFolder(t) {
  const source = await loadPinnedMigrationArtifacts();
  const directory = await mkdtemp(join(tmpdir(), 'daybook-legacy-migration-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'meta'));
  await writeFile(join(directory, 'meta/_journal.json'), source.journalText);
  for (const file of source.files) await writeFile(join(directory, `${file.tag}.sql`), file.content);
  return directory;
}

test('production operator pins direct/pooled hosts, database, TLS and URL override options', () => {
  assert.equal(validateProductionConnectionTargets(environment), environment.DIRECT_DATABASE_URL);
  for (const [key, value] of [
    ['DIRECT_DATABASE_URL', environment.DATABASE_URL],
    ['DATABASE_URL', environment.DIRECT_DATABASE_URL],
    ['DIRECT_DATABASE_URL', environment.DIRECT_DATABASE_URL.replace('ep-dawn-moon-bbwpjcrp.', 'other-branch.')],
    ['DIRECT_DATABASE_URL', environment.DIRECT_DATABASE_URL.replace('/daybook_ticket?', '/other_database?')],
    ['DIRECT_DATABASE_URL', environment.DIRECT_DATABASE_URL.replace('sslmode=require', 'sslmode=disable')],
    ['DIRECT_DATABASE_URL', `${environment.DIRECT_DATABASE_URL}&host=127.0.0.1`],
    ['DIRECT_DATABASE_URL', `${environment.DIRECT_DATABASE_URL}&options=-c%20search_path=evil`],
    ['DIRECT_DATABASE_URL', `${environment.DIRECT_DATABASE_URL}&sslmode=verify-full`],
    ['DIRECT_DATABASE_URL', `${environment.DIRECT_DATABASE_URL}#fragment`],
  ]) assert.throws(() => validateProductionConnectionTargets({ ...environment, [key]: value }), MigrationOperatorError);
});

test('source journal and all four SQL files match reviewed immutable hashes', async () => {
  const source = await loadPinnedMigrationArtifacts();
  assert.equal(source.files.length, 4);
  assert.equal(source.files[3].hash, 'c1b0dfca16966ae89e7cbe0828e43558828af532eea0abd0adfbb4ca7b5128c2');
  assert.equal(source.files[3].when, 1793801286130);
});

test('database journal permits only the exact known three or four migration records', () => {
  assert.equal(validateMigrationJournal(journal.slice(0, 3)), false);
  assert.equal(validateMigrationJournal(journal), true);
  for (const invalid of [[], journal.slice(0, 2), [...journal, journal[3]], [...journal].reverse(), journal.map((row, index) => index === 1 ? { ...row, hash: 'changed' } : row), journal.map((row, index) => index === 2 ? { ...row, created_at: '0' } : row)]) {
    assert.throws(() => validateMigrationJournal(invalid), MigrationOperatorError);
  }
});

test('actual installed Drizzle migrator uses one savepoint and cannot commit the outer transaction', async t => {
  const queries = [];
  const client = { query: async query => {
    const sql = text(query); queries.push(sql);
    return { rows: /select id, hash, created_at/.test(sql) ? [{ ...journal[2], id: 3 }] : [], rowCount: 0 };
  } };
  const adapter = createMigrationSavepointClient(client);
  await migrate(drizzle({ client: adapter.client, logger: false }), { migrationsFolder: await legacyMigrationFolder(t) });
  adapter.assertReleased();
  assert.equal(queries.filter(sql => /^SAVEPOINT /.test(sql)).length, 1);
  assert.equal(queries.filter(sql => /^RELEASE SAVEPOINT /.test(sql)).length, 1);
  assert.equal(queries.some(sql => /^\s*(begin|commit|rollback)\s*$/i.test(sql)), false);
  assert.equal(queries.some(sql => /CREATE TABLE "mailDeliveryEvents"/.test(sql)), true);
  assert.equal(queries.some(sql => /CREATE TABLE "tickets"/.test(sql)), false, 'Only 0003 is selected after the exact 0002 timestamp');
  assert.equal(queries.some(sql => /CREATE TABLE "servicePolicies"/.test(sql)), false, 'The historical operator never applies a later feature migration');
});

test('migration failure rolls back its savepoint without emitting an outer commit', async t => {
  const queries = [];
  const client = { query: async query => {
    const sql = text(query); queries.push(sql);
    if (/ALTER TABLE "mailOutbox" ADD COLUMN "readAt"/.test(sql)) throw new Error('fictitious-DDL-failure');
    return { rows: /select id, hash, created_at/.test(sql) ? [{ ...journal[2], id: 3 }] : [], rowCount: 0 };
  } };
  const adapter = createMigrationSavepointClient(client);
  await assert.rejects(migrate(drizzle({ client: adapter.client, logger: false }), { migrationsFolder: await legacyMigrationFolder(t) }), error => error.cause?.message === 'fictitious-DDL-failure');
  assert.ok(queries.some(sql => /^ROLLBACK TO SAVEPOINT /.test(sql)));
  assert.equal(queries.some(sql => /^\s*(begin|commit|rollback)\s*$/i.test(sql)), false);
  assert.throws(adapter.assertReleased, MigrationOperatorError);
});

test('savepoint adapter rejects nested, configured or late transaction controls', async () => {
  const adapter = createMigrationSavepointClient({ query: async () => ({ rows: [] }) });
  await assert.rejects(adapter.client.query('begin isolation level serializable'), MigrationOperatorError);
  await adapter.client.query('begin');
  await assert.rejects(adapter.client.query('begin'), MigrationOperatorError);
  await adapter.client.query('commit'); adapter.assertReleased();
  await assert.rejects(adapter.client.query('SELECT 1'), MigrationOperatorError);
});

test('operator rolls back a wrong database and keeps audit transaction read-only', async () => {
  for (const apply of [false, true]) {
    const queries = [];
    const client = { query: async query => {
      const sql = text(query); queries.push(sql);
      return { rows: /current_database/.test(sql) ? [{ name: 'wrong_database' }] : [] };
    } };
    await assert.rejects(runMigrationOperator(client, { apply }), error => error.operatorCode === 'unexpected_database');
    assert.equal(queries[0], apply ? 'BEGIN ISOLATION LEVEL READ COMMITTED' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    assert.equal(queries.at(-1), 'ROLLBACK');
    assert.equal(queries.some(sql => /^(CREATE|ALTER|INSERT|UPDATE|DELETE|COMMIT)/i.test(sql)), false);
  }
});
