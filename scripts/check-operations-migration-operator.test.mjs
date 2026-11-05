import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OPERATIONS_PINNED_MIGRATIONS, OPERATIONS_CONFIRM_TARGET, MigrationOperatorError,
  validateProductionConnectionTargets, validateOperationsCliArguments, loadOperationsMigrationArtifacts,
  validateOperationsMigrationJournal, runOperationsMigrationOperator, operationsFailureReport,
} from './migrate-operations-production.mjs';

const environment = {
  DATABASE_URL: 'postgresql://fictional_operator:fictional_password@ep-dawn-moon-bbwpjcrp-pooler.c-15.us-east-1.aws.neon.tech/daybook_ticket?sslmode=require',
  DIRECT_DATABASE_URL: 'postgresql://fictional_operator:fictional_password@ep-dawn-moon-bbwpjcrp.c-15.us-east-1.aws.neon.tech/daybook_ticket?sslmode=require&channel_binding=require',
  DAYBOOK_PRODUCTION_MIGRATION_CONFIRM_TARGET: OPERATIONS_CONFIRM_TARGET,
  DAYBOOK_PRODUCTION_MIGRATION_ALLOW_APPLY: '0004',
};
const expectedJournal = OPERATIONS_PINNED_MIGRATIONS.map((item, index) => ({ id: index + 1, hash: item.hash, created_at: String(item.when) }));
const hash = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const queryText = query => typeof query === 'string' ? query : query.text;

function column(table, name, position, type = 'text', nullable = false, defaultValue = null) {
  return { table_name: table, column_name: name, position, data_type: type, not_null: !nullable, column_default: defaultValue };
}

/** No connection is created by this fixture. The ACTUAL installed Drizzle
 * migrator emits its real statements against this small transactional client.
 * It models catalog/data/journal changes and rolls them back at savepoints and
 * the outer transaction; it does not claim to validate PostgreSQL DDL syntax.
 */
class FixtureClient {
  constructor(options = {}) {
    this.options = options;
    this.queries = [];
    this.commits = 0;
    this.state = {
      journal: clone(expectedJournal.slice(0, 4)),
      tables: {
        members: {
          columns: [column('members', 'id', 1), column('members', 'passwordHash', 2), column('members', 'status', 3)],
          rows: [{ id: 'fictional-owner', passwordHash: 'FICTIONAL_PRIVATE_PASSWORD_HASH', status: 'active' }],
        },
        sessions: {
          columns: [column('sessions', 'id', 1), column('sessions', 'token', 2)],
          rows: [{ id: 'fictional-session', token: 'FICTIONAL_PRIVATE_SESSION_TOKEN' }],
        },
        settings: {
          columns: [column('settings', 'ownerId', 1), column('settings', 'data', 2)],
          rows: [{ ownerId: 'fictional-owner', data: '{"brandName":"Daybook","slaHours":{"normal":24}}' }],
        },
        tickets: {
          columns: [column('tickets', 'id', 1, 'integer'), column('tickets', 'subject', 2), column('tickets', 'dueAt', 3)],
          rows: [{ id: 1, subject: 'FICTIONAL_PRIVATE_TICKET_TEXT', dueAt: '2026-11-05T15:00:00.000Z' }],
        },
        'unknown"table': {
          columns: [column('unknown"table', 'strange"column', 1)], rows: [{ 'strange"column': 'preserve unknown data too' }],
        },
      },
    };
    this.initial = clone(this.state);
  }
  catalog() {
    return Object.keys(this.state.tables).sort(compare).flatMap(name => this.state.tables[name].columns);
  }
  async query(input, values = []) {
    const sql = queryText(input), trimmed = sql.trim();
    this.queries.push({ sql, values });
    if (this.options.fail?.(sql)) throw Object.assign(new Error('Fictitious database error; no network call'), { code: '55P03' });
    const result = rows => ({ rows, rowCount: rows.length });
    if (/^BEGIN ISOLATION LEVEL /.test(trimmed)) {
      assert.equal(this.outerSnapshot, undefined, 'The migrator must never issue a second outer BEGIN');
      this.outerSnapshot = clone(this.state);
      this.options.onBegin?.();
      return result([]);
    }
    if (/^SET LOCAL /.test(trimmed)) return result([]);
    if (/current_database\(\)/.test(sql)) return result([{ name: this.options.database || 'daybook_ticket', version: '170005' }]);
    if (/pg_try_advisory_xact_lock/.test(sql)) return result([{ locked: this.options.locked ?? true }]);
    if (/^SELECT hash, created_at FROM drizzle\.__drizzle_migrations/.test(trimmed)) return result(clone(this.state.journal));
    if (/format_type\(a.atttypid/.test(sql)) return result(clone(this.catalog()));
    if (/^LOCK TABLE /.test(trimmed)) {
      if (trimmed.startsWith('LOCK TABLE public.')) this.options.afterTableLock?.(this.state);
      return result([]);
    }
    if (/all_fingerprints/.test(sql)) {
      const fingerprints = [...sql.matchAll(/jsonb_build_array\((.*?)\)::text[\s\S]*?FROM public\."((?:""|[^"])*)"/g)].map(match => {
        const names = [...match[1].matchAll(/"((?:""|[^"])*)"/g)].map(item => item[1].replaceAll('""', '"'));
        const table = match[2].replaceAll('""', '"');
        const rowHashes = this.state.tables[table].rows.map(row => hash(JSON.stringify(names.map(name => row[name] ?? null)))).sort(compare);
        return { table, columns: names.length, rows: String(rowHashes.length), sha256: hash(rowHashes.join('')) };
      }).sort((a, b) => compare(a.table, b.table));
      assert.deepEqual(fingerprints.map(item => item.table), values, 'Every bound table label has one fingerprint, including unknown tables');
      return result(fingerprints);
    }
    if (/^CREATE SCHEMA IF NOT EXISTS "drizzle"/.test(trimmed) || /^CREATE TABLE IF NOT EXISTS "drizzle"\./.test(trimmed)) return result([]);
    if (/^select id, hash, created_at from "drizzle"\./.test(trimmed)) return result([clone(this.state.journal.at(-1))]);
    if (/^SAVEPOINT /.test(trimmed)) { this.savepointSnapshot = clone(this.state); return result([]); }
    if (/^ROLLBACK TO SAVEPOINT /.test(trimmed)) { this.state = clone(this.savepointSnapshot); return result([]); }
    if (/^RELEASE SAVEPOINT /.test(trimmed)) {
      this.savepointSnapshot = undefined;
      if (!this.injectedAfterMigration && this.state.journal.length === 5) {
        this.options.afterMigration?.(this.state); this.injectedAfterMigration = true;
      }
      return result([]);
    }
    const newTable = trimmed.match(/^CREATE TABLE "([^"]+)" \(/);
    if (newTable) {
      const name = newTable[1];
      assert.equal(this.state.tables[name], undefined, 'Already-applied migrations must not recreate their tables');
      const definitions = [...sql.matchAll(/^\s*"([^"]+)" (text|integer|boolean)([^\n]*)/gm)];
      this.state.tables[name] = { rows: [], columns: definitions.map((match, index) => {
        const defaultValue = match[3].match(/DEFAULT (true|false|\d+)/)?.[1] ?? null;
        return column(name, match[1], index + 1, match[2], !match[3].includes('NOT NULL'), defaultValue);
      }) };
      return result([]);
    }
    const addedColumn = trimmed.match(/^ALTER TABLE "tickets" ADD COLUMN "([^"]+)" text/);
    if (addedColumn) {
      const table = this.state.tables.tickets;
      table.columns.push(column('tickets', addedColumn[1], table.columns.length + 1, 'text', true));
      table.rows.forEach(row => { row[addedColumn[1]] = null; });
      return result([]);
    }
    if (/^ALTER TABLE ".+" ADD CONSTRAINT /.test(trimmed) || /^CREATE (?:UNIQUE )?INDEX /.test(trimmed)) return result([]);
    if (/^insert into "drizzle"\."__drizzle_migrations"/.test(trimmed)) {
      this.state.journal.push({ id: this.state.journal.length + 1, hash: values[0], created_at: String(values[1]) });
      return result([]);
    }
    if (/AS ticketsWithSlaCycle/.test(sql)) return result([{
      policies: String(this.state.tables.servicePolicies.rows.length), rules: String(this.state.tables.assignmentRules.rows.length),
      availability: String(this.state.tables.agentAvailability.rows.length), outcomes: String(this.state.tables.ticketSlaOutcomes.rows.length),
      ticketsWithSlaCycle: String(this.state.tables.tickets.rows.filter(row => row.slaStartedAt != null || row.slaPolicySnapshot != null).length),
    }]);
    if (trimmed === 'COMMIT') {
      assert.ok(this.outerSnapshot, 'A real outer transaction must exist');
      this.commits++; this.outerSnapshot = undefined; return result([]);
    }
    if (trimmed === 'ROLLBACK') {
      assert.ok(this.outerSnapshot, 'The outer transaction must exist before rollback');
      this.state = clone(this.outerSnapshot); this.outerSnapshot = undefined; return result([]);
    }
    throw new Error(`Unexpected fixture SQL: ${sql}`);
  }
}

async function artifactFolder(t, transform = () => undefined) {
  const source = await loadOperationsMigrationArtifacts();
  transform(source);
  const directory = await mkdtemp(join(tmpdir(), 'daybook-operations-operator-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'meta'));
  await writeFile(join(directory, 'meta/_journal.json'), source.journalText);
  for (const file of source.files) await writeFile(join(directory, `${file.tag}.sql`), file.content);
  return directory;
}

test('0004 publication requires an exact mode, exact target confirmation and its own apply token', () => {
  assert.equal(validateOperationsCliArguments(['--audit'], {}), 'audit');
  assert.equal(validateOperationsCliArguments(['--dry-run'], { DAYBOOK_PRODUCTION_MIGRATION_CONFIRM_TARGET: OPERATIONS_CONFIRM_TARGET }), 'dry-run');
  assert.equal(validateOperationsCliArguments(['--apply'], environment), 'apply');
  for (const args of [[], ['--apply', '--audit'], ['--apply=1'], ['--audit', 'DATABASE_URL=secret']]) assert.throws(() => validateOperationsCliArguments(args, environment), MigrationOperatorError);
  assert.throws(() => validateOperationsCliArguments(['--dry-run'], {}), error => error.operatorCode === 'exact_target_confirmation_required');
  for (const token of [undefined, '', '0003', 'true']) assert.throws(() => validateOperationsCliArguments(['--apply'], { ...environment, DAYBOOK_PRODUCTION_MIGRATION_ALLOW_APPLY: token }), MigrationOperatorError);
  for (const target of [undefined, OPERATIONS_CONFIRM_TARGET.replace('0004', '0003'), OPERATIONS_CONFIRM_TARGET.replace('daybook_ticket', 'other_database')]) assert.throws(() => validateOperationsCliArguments(['--apply'], { ...environment, DAYBOOK_PRODUCTION_MIGRATION_CONFIRM_TARGET: target }), MigrationOperatorError);
});

test('0004 production CLI reuses strict direct/pooled host, database, TLS and connection-option guards', () => {
  assert.equal(validateProductionConnectionTargets(environment), environment.DIRECT_DATABASE_URL);
  for (const direct of [environment.DATABASE_URL, environment.DIRECT_DATABASE_URL.replace('ep-dawn-moon-bbwpjcrp.', 'ep-falling-water-bbfa4ijl.'),
    environment.DIRECT_DATABASE_URL.replace('/daybook_ticket?', '/other_database?'), environment.DIRECT_DATABASE_URL.replace('sslmode=require', 'sslmode=disable'),
    `${environment.DIRECT_DATABASE_URL}&host=localhost`, `${environment.DIRECT_DATABASE_URL}&dbname=other`, `${environment.DIRECT_DATABASE_URL}&options=-c%20search_path=evil`, `${environment.DIRECT_DATABASE_URL}#fragment`]) {
    assert.throws(() => validateProductionConnectionTargets({ ...environment, DIRECT_DATABASE_URL: direct }), MigrationOperatorError);
  }
});

test('all five reviewed SQL files have immutable hashes and future source migrations are excluded', async t => {
  const source = await loadOperationsMigrationArtifacts();
  assert.equal(source.files.length, 5);
  assert.equal(source.files[4].hash, '9342a5088781d12820d8905085c86e8f56c5f157bad2565058cd956b06975763');
  assert.ok(source.files.every((file, index) => hash(file.content) === OPERATIONS_PINNED_MIGRATIONS[index].hash));
  const directory = await artifactFolder(t, artifacts => {
    const journal = JSON.parse(artifacts.journalText);
    journal.entries.push({ idx: 5, version: '7', when: 1793834997002, tag: '0005_unreviewed', breakpoints: true });
    artifacts.journalText = JSON.stringify(journal);
  });
  const frozen = await loadOperationsMigrationArtifacts(directory);
  assert.equal(JSON.parse(frozen.journalText).entries.length, 5);
  assert.equal(frozen.files.length, 5);
});

test('tampered SQL or source-journal metadata fails before any database action', async t => {
  for (const index of [0, 4]) {
    const folder = await artifactFolder(t, source => { source.files[index].content = Buffer.from('SELECT 1;'); });
    await assert.rejects(loadOperationsMigrationArtifacts(folder), error => error.operatorCode === 'migration_source_hash_mismatch');
  }
  const folder = await artifactFolder(t, source => {
    const journal = JSON.parse(source.journalText); journal.entries[4].when++; source.journalText = JSON.stringify(journal);
  });
  await assert.rejects(loadOperationsMigrationArtifacts(folder), error => error.operatorCode === 'unexpected_source_journal');
  const client = new FixtureClient(), source = await loadOperationsMigrationArtifacts();
  source.files[4].content.fill(0);
  await assert.rejects(runOperationsMigrationOperator(client, { mode: 'apply', artifacts: source }), error => error.operatorCode === 'migration_source_hash_mismatch');
  assert.equal(client.queries.length, 0);
});

test('only exact pre-0004 or already-0004 database journals are accepted', () => {
  assert.equal(validateOperationsMigrationJournal(expectedJournal.slice(0, 4)), false);
  assert.equal(validateOperationsMigrationJournal(expectedJournal), true);
  for (const rows of [[], expectedJournal.slice(0, 3), [...expectedJournal, expectedJournal[4]], [...expectedJournal].reverse(), expectedJournal.map((row, index) => index === 1 ? { ...row, hash: 'unknown' } : row), expectedJournal.map((row, index) => index === 4 ? { ...row, created_at: '0' } : row)]) assert.throws(() => validateOperationsMigrationJournal(rows), MigrationOperatorError);
});

test('audit uses one repeatable-read read-only snapshot, aggregate-only reports and no locks/DDL', async () => {
  const client = new FixtureClient();
  const report = await runOperationsMigrationOperator(client);
  assert.equal(report.mode, 'audit'); assert.equal(report.migration, '0004_pending'); assert.equal(report.committed, false); assert.equal(report.operations, null);
  assert.equal(client.queries[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(client.queries.at(-1).sql, 'ROLLBACK'); assert.equal(client.commits, 0); assert.deepEqual(client.state, client.initial);
  assert.equal(client.queries.some(({ sql }) => /^\s*(LOCK|CREATE|ALTER|INSERT|UPDATE|DELETE|COMMIT)\b/i.test(sql)), false);
  assert.equal(client.queries.some(({ sql }) => /pg_try_advisory_xact_lock/.test(sql)), false);
  assert.ok(report.fingerprints.some(row => row.table === 'unknown"table' && row.columns === 1));
  assert.equal(/FICTIONAL_PRIVATE|fictional_password/.test(JSON.stringify(report)), false);
});

test('dry-run drives the installed migrator through a savepoint and rolls back all schema/journal changes', async () => {
  const client = new FixtureClient();
  const report = await runOperationsMigrationOperator(client, { mode: 'dry-run' });
  assert.equal(report.migration, '0004_would_apply'); assert.equal(report.committed, false); assert.equal(report.originalColumnsUnchanged, true);
  assert.equal(client.queries.filter(({ sql }) => /^BEGIN /.test(sql)).length, 1);
  assert.equal(client.queries.filter(({ sql }) => /^SAVEPOINT /.test(sql)).length, 1);
  assert.equal(client.queries.filter(({ sql }) => /^RELEASE SAVEPOINT /.test(sql)).length, 1);
  assert.equal(client.queries.at(-1).sql, 'ROLLBACK'); assert.equal(client.commits, 0); assert.deepEqual(client.state, client.initial);
  assert.equal(client.queries.some(({ sql }) => /CREATE TABLE "servicePolicies"/.test(sql)), true);
  assert.equal(client.queries.some(({ sql }) => /CREATE TABLE "tickets"|CREATE TABLE "mailDeliveryEvents"/.test(sql)), false, '0000–0003 cannot be replayed');
  const inserts = client.queries.filter(({ sql }) => /^\s*insert into\b/i.test(sql));
  assert.equal(inserts.length, 1); assert.match(inserts[0].sql, /"drizzle"\."__drizzle_migrations"/);
  assert.equal(inserts[0].values[0], OPERATIONS_PINNED_MIGRATIONS[4].hash);
});

test('apply commits once only after all original column fingerprints and zero backfill are verified', async () => {
  const client = new FixtureClient();
  const report = await runOperationsMigrationOperator(client, { mode: 'apply' });
  assert.equal(report.migration, '0004_applied'); assert.equal(report.committed, true); assert.equal(report.preservedTables, 5); assert.equal(report.preservedRows, '5');
  assert.equal(client.commits, 1); assert.equal(client.queries.at(-1).sql, 'COMMIT'); assert.equal(client.state.journal.length, 5);
  assert.deepEqual(report.operations, { policies: '0', rules: '0', availability: '0', outcomes: '0', ticketsWithSlaCycle: '0' });
  assert.equal(client.state.tables.tickets.rows[0].dueAt, client.initial.tables.tickets.rows[0].dueAt);
  assert.equal(client.state.tables.members.rows[0].passwordHash, client.initial.tables.members.rows[0].passwordHash);
  assert.equal(client.state.tables.sessions.rows[0].token, client.initial.tables.sessions.rows[0].token);
  assert.deepEqual(client.state.tables.settings, client.initial.tables.settings);
  const queries = client.queries.map(({ sql }) => sql), fingerprintQueries = queries.filter(sql => /all_fingerprints/.test(sql));
  assert.equal(fingerprintQueries.length, 2); assert.ok(fingerprintQueries.every(sql => /"passwordHash"/.test(sql) && /"token"/.test(sql) && /"strange""column"/.test(sql)));
  assert.ok(fingerprintQueries.every(sql => !sql.includes('slaPolicySnapshot') && !sql.includes('slaStartedAt')), 'Compare the exact original columns, not new nullable fields');
  assert.ok(queries.indexOf('LOCK TABLE drizzle.__drizzle_migrations IN SHARE ROW EXCLUSIVE MODE') < queries.findIndex(sql => /^CREATE SCHEMA /.test(sql)));
  assert.equal(/FICTIONAL_PRIVATE|fictional_password/.test(JSON.stringify(report)), false);
});

test('already-applied audit/apply preserves existing configuration and cycle data without rerunning the migrator', async () => {
  const client = new FixtureClient();
  await runOperationsMigrationOperator(client, { mode: 'apply' });
  client.state.tables.servicePolicies.rows.push({ id: 'existing-policy', calendarJson: '{"mode":"business"}' });
  client.state.tables.assignmentRules.rows.push({ id: 'existing-rule', enabled: true });
  client.state.tables.agentAvailability.rows.push({ memberId: 'fictional-owner', available: false });
  client.state.tables.ticketSlaOutcomes.rows.push({ id: 'existing-resolution', dueAt: '2026-11-05T15:00:00Z' });
  client.state.tables.tickets.rows[0].slaStartedAt = '2026-11-04T15:00:00.000Z';
  client.state.tables.tickets.rows[0].slaPolicySnapshot = '{"version":1}';
  const preserved = clone(client.state);
  for (const mode of ['audit', 'dry-run', 'apply']) {
    client.queries = [];
    const report = await runOperationsMigrationOperator(client, { mode });
    assert.equal(report.operations.policies, '1'); assert.equal(report.operations.ticketsWithSlaCycle, '1'); assert.deepEqual(client.state, preserved);
    assert.ok(report.migration.startsWith('0004_already_applied'));
    assert.equal(client.queries.some(({ sql }) => /^\s*(CREATE|ALTER|INSERT|UPDATE|DELETE|SAVEPOINT)\b/i.test(sql)), false);
  }
});

test('artifact bytes are copied before awaits so a concurrent caller cannot change executed SQL', async () => {
  const source = await loadOperationsMigrationArtifacts();
  const client = new FixtureClient({ onBegin: () => source.files[4].content.fill(0) });
  const report = await runOperationsMigrationOperator(client, { mode: 'dry-run', artifacts: source });
  assert.equal(report.migration, '0004_would_apply'); assert.deepEqual(client.state, client.initial);
});

test('wrong database, migration contention and lock timeout roll back without committing', async () => {
  for (const [options, expectedCode] of [
    [{ database: 'wrong_database' }, 'unexpected_database'],
    [{ locked: false }, 'another_migration_operator_is_running'],
    [{ fail: sql => sql.startsWith('LOCK TABLE public.') }, '55P03'],
  ]) {
    const client = new FixtureClient(options);
    await assert.rejects(runOperationsMigrationOperator(client, { mode: 'apply' }), error => (error.operatorCode || error.code) === expectedCode);
    assert.equal(client.queries.at(-1).sql, 'ROLLBACK'); assert.equal(client.commits, 0); assert.deepEqual(client.state, client.initial);
  }
});

test('partial operations schema or unknown journal cannot run any migration DDL', async () => {
  for (const change of [
    state => { state.journal[0].hash = 'unreviewed'; },
    state => { state.tables.servicePolicies = { rows: [], columns: [column('servicePolicies', 'id', 1)] }; },
    state => { state.tables.tickets.columns.push(column('tickets', 'slaStartedAt', 4, 'text', true)); },
  ]) {
    const client = new FixtureClient(); change(client.state); const before = clone(client.state);
    await assert.rejects(runOperationsMigrationOperator(client, { mode: 'apply' }), MigrationOperatorError);
    assert.equal(client.queries.some(({ sql }) => /^\s*(CREATE|ALTER|INSERT)\b/i.test(sql)), false);
    assert.equal(client.commits, 0); assert.deepEqual(client.state, before);
  }
});

test('DDL failure rolls back both the migrator savepoint and outer transaction', async () => {
  const client = new FixtureClient({ fail: sql => /ALTER TABLE "tickets" ADD COLUMN "slaStartedAt"/.test(sql) });
  await assert.rejects(runOperationsMigrationOperator(client, { mode: 'apply' }), error => error.cause?.code === '55P03');
  assert.ok(client.queries.some(({ sql }) => /^ROLLBACK TO SAVEPOINT /.test(sql)));
  assert.equal(client.queries.at(-1).sql, 'ROLLBACK'); assert.equal(client.commits, 0); assert.deepEqual(client.state, client.initial);
});

test('changed private data, old column definitions, extra tables, journal drift or any backfill aborts before commit', async () => {
  const cases = [
    [state => { state.tables.members.rows[0].passwordHash = 'changed-private-data'; }, 'original_data_preservation_failed'],
    [state => { state.tables.settings.rows[0].data = '{"brandName":"changed"}'; }, 'original_data_preservation_failed'],
    [state => { state.tables.tickets.rows[0].dueAt = '2027-01-01T00:00:00.000Z'; }, 'original_data_preservation_failed'],
    [state => { state.tables.sessions.columns[1].data_type = 'integer'; }, 'existing_column_definition_changed'],
    [state => { state.tables.unexpected = { rows: [], columns: [column('unexpected', 'id', 1)] }; }, 'unexpected_public_schema_change'],
    [state => { state.journal[4].hash = 'changed'; }, 'unexpected_database_journal'],
    [state => { state.tables.servicePolicies.rows.push({ id: 'invented-policy' }); }, 'unexpected_operations_backfill'],
    [state => { state.tables.assignmentRules.rows.push({ id: 'invented-rule' }); }, 'unexpected_operations_backfill'],
    [state => { state.tables.agentAvailability.rows.push({ memberId: 'invented-availability' }); }, 'unexpected_operations_backfill'],
    [state => { state.tables.ticketSlaOutcomes.rows.push({ id: 'invented-resolution' }); }, 'unexpected_operations_backfill'],
    [state => { state.tables.tickets.rows[0].slaStartedAt = '2026-11-04T15:00:00.000Z'; }, 'unexpected_operations_backfill'],
    [state => { state.tables.tickets.rows[0].slaPolicySnapshot = '{}'; }, 'unexpected_operations_backfill'],
  ];
  for (const [afterMigration, code] of cases) {
    const client = new FixtureClient({ afterMigration });
    await assert.rejects(runOperationsMigrationOperator(client, { mode: 'apply' }), error => error.operatorCode === code, code);
    assert.equal(client.commits, 0); assert.equal(client.queries.at(-1).sql, 'ROLLBACK'); assert.deepEqual(client.state, client.initial);
  }
});

test('catalog changes while acquiring table locks abort before hashing or migration', async () => {
  const client = new FixtureClient({ afterTableLock: state => { state.tables.members.columns[1].column_default = "'changed'::text"; } });
  await assert.rejects(runOperationsMigrationOperator(client, { mode: 'apply' }), error => error.operatorCode === 'public_schema_changed_during_locking');
  assert.equal(client.queries.some(({ sql }) => /all_fingerprints|CREATE TABLE/.test(sql)), false);
  assert.equal(client.commits, 0); assert.deepEqual(client.state, client.initial);
});

test('failure reports emit only safe operator or SQLSTATE codes and never exception details', () => {
  for (const error of [new Error('postgresql://user:PRIVATE_PASSWORD@host/private'), { message: 'PRIVATE_PASSWORD', detail: 'PRIVATE_TICKET_TEXT', code: 'bad connection PRIVATE_PASSWORD' }, { operatorCode: 'postgresql://user:PRIVATE_PASSWORD@host' }, { operatorCode: 'fictional_private_password' }]) assert.deepEqual(operationsFailureReport(error), { result: 'FAIL', code: 'operator_failed' });
  assert.deepEqual(operationsFailureReport(new MigrationOperatorError('original_data_preservation_failed')), { result: 'FAIL', code: 'original_data_preservation_failed' });
  assert.deepEqual(operationsFailureReport({ cause: { code: '55P03', detail: 'PRIVATE_PASSWORD' } }), { result: 'FAIL', code: '55P03' });
});
