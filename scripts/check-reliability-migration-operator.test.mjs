import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RELIABILITY_PINNED_MIGRATIONS,
  RELIABILITY_CONFIRM_TARGET,
  MigrationOperatorError,
  validateProductionConnectionTargets,
  validateReliabilityProductionTargets,
  validateReliabilityCliArguments,
  loadReliabilityMigrationArtifacts,
  validateReliabilityMigrationJournal,
  runReliabilityMigrationOperator,
  reliabilityFailureReport,
} from './migrate-reliability-production.mjs';

const environment = {
  DATABASE_URL:
    'postgresql://fictional_operator:fictional_password@ep-dawn-moon-bbwpjcrp-pooler.c-15.us-east-1.aws.neon.tech/daybook_ticket?sslmode=require',
  DIRECT_DATABASE_URL:
    'postgresql://fictional_operator:fictional_password@ep-dawn-moon-bbwpjcrp.c-15.us-east-1.aws.neon.tech/daybook_ticket?sslmode=require&channel_binding=require',
  DAYBOOK_PRODUCTION_MIGRATION_CONFIRM_TARGET: RELIABILITY_CONFIRM_TARGET,
  DAYBOOK_PRODUCTION_MIGRATION_ALLOW_APPLY: '0006',
};
const expectedJournal = RELIABILITY_PINNED_MIGRATIONS.map((item, index) => ({
  id: index + 1,
  hash: item.hash,
  created_at: String(item.when),
}));
const hash = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const queryText = query => (typeof query === 'string' ? query : query.text);

function column(table, name, position, type = 'text', nullable = false, defaultValue = null) {
  return {
    table_name: table,
    column_name: name,
    position,
    data_type: type,
    not_null: !nullable,
    column_default: defaultValue,
  };
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
      journal: clone(expectedJournal.slice(0, 6)),
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
          columns: [
            column('tickets', 'id', 1, 'integer'),
            column('tickets', 'subject', 2),
            column('tickets', 'dueAt', 3),
          ],
          rows: [{ id: 1, subject: 'FICTIONAL_PRIVATE_TICKET_TEXT', dueAt: '2026-11-05T15:00:00.000Z' }],
        },
        messages: {
          columns: [
            column('messages', 'id', 1, 'integer'),
            column('messages', 'body', 2),
            column('messages', 'kind', 3),
          ],
          rows: [{ id: 1, body: '**Literal old text must remain literal** FICTIONAL_PRIVATE_MESSAGE', kind: 'reply' }],
        },
        mailOutbox: {
          columns: [
            column('mailOutbox', 'id', 1),
            column('mailOutbox', 'payloadJson', 2),
            column('mailOutbox', 'status', 3),
          ],
          rows: [{ id: 'fictional-mail', payloadJson: '{"text":"FICTIONAL_PRIVATE_FROZEN_MAIL"}', status: 'queued' }],
        },
        'unknown"table': {
          columns: [column('unknown"table', 'strange"column', 1)],
          rows: [{ 'strange"column': 'preserve unknown data too' }],
        },
      },
    };
    this.initial = clone(this.state);
  }
  catalog() {
    return Object.keys(this.state.tables)
      .sort(compare)
      .flatMap(name => this.state.tables[name].columns);
  }
  async query(input, values = []) {
    const sql = queryText(input),
      trimmed = sql.trim();
    this.queries.push({ sql, values });
    if (this.options.fail?.(sql))
      throw Object.assign(new Error('Fictitious database error; no network call'), { code: '55P03' });
    const result = rows => ({ rows, rowCount: rows.length });
    if (/^BEGIN ISOLATION LEVEL /.test(trimmed)) {
      assert.equal(this.outerSnapshot, undefined, 'The migrator must never issue a second outer BEGIN');
      this.outerSnapshot = clone(this.state);
      this.options.onBegin?.();
      return result([]);
    }
    if (/^SET LOCAL /.test(trimmed)) return result([]);
    if (/current_database\(\)/.test(sql))
      return result([{ name: this.options.database || 'daybook_ticket', version: '170006' }]);
    if (/pg_try_advisory_xact_lock/.test(sql)) return result([{ locked: this.options.locked ?? true }]);
    if (/^SELECT hash, created_at FROM drizzle\.__drizzle_migrations/.test(trimmed))
      return result(clone(this.state.journal));
    if (/format_type\(a.atttypid/.test(sql)) return result(clone(this.catalog()));
    if (/^LOCK TABLE /.test(trimmed)) {
      if (trimmed.startsWith('LOCK TABLE public.')) this.options.afterTableLock?.(this.state);
      return result([]);
    }
    if (/all_fingerprints/.test(sql)) {
      const fingerprints = [...sql.matchAll(/jsonb_build_array\((.*?)\)::text[\s\S]*?FROM public\."((?:""|[^"])*)"/g)]
        .map(match => {
          const names = [...match[1].matchAll(/"((?:""|[^"])*)"/g)].map(item => item[1].replaceAll('""', '"'));
          const table = match[2].replaceAll('""', '"');
          const rowHashes = this.state.tables[table].rows
            .map(row => hash(JSON.stringify(names.map(name => row[name] ?? null))))
            .sort(compare);
          return { table, columns: names.length, rows: String(rowHashes.length), sha256: hash(rowHashes.join('')) };
        })
        .sort((a, b) => compare(a.table, b.table));
      assert.deepEqual(
        fingerprints.map(item => item.table),
        values,
        'Every bound table label has one fingerprint, including unknown tables',
      );
      return result(fingerprints);
    }
    if (
      /^CREATE SCHEMA IF NOT EXISTS "drizzle"/.test(trimmed) ||
      /^CREATE TABLE IF NOT EXISTS "drizzle"\./.test(trimmed)
    )
      return result([]);
    if (/^select id, hash, created_at from "drizzle"\./.test(trimmed))
      return result([clone(this.state.journal.at(-1))]);
    if (/^SAVEPOINT /.test(trimmed)) {
      this.savepointSnapshot = clone(this.state);
      return result([]);
    }
    if (/^ROLLBACK TO SAVEPOINT /.test(trimmed)) {
      this.state = clone(this.savepointSnapshot);
      return result([]);
    }
    if (/^RELEASE SAVEPOINT /.test(trimmed)) {
      this.savepointSnapshot = undefined;
      if (!this.injectedAfterMigration && this.state.journal.length === 7) {
        this.options.afterMigration?.(this.state);
        this.injectedAfterMigration = true;
      }
      return result([]);
    }
    const newTable = trimmed.match(/^CREATE TABLE "([^"]+)" \(/);
    if (newTable) {
      const name = newTable[1];
      assert.equal(this.state.tables[name], undefined, 'Already-applied migrations must not recreate their tables');
      const definitions = [...sql.matchAll(/^\s*"([^"]+)" (text|integer|boolean|bigint)([^\n]*)/gm)];
      this.state.tables[name] = {
        rows: [],
        columns: definitions.map((match, index) => {
          const rawDefault = match[3].match(/DEFAULT ('[^']*'|true|false|\d+)/)?.[1] ?? null;
          const defaultValue = rawDefault?.startsWith("'") ? `${rawDefault}::text` : rawDefault;
          return column(name, match[1], index + 1, match[2], !match[3].includes('NOT NULL'), defaultValue);
        }),
      };
      return result([]);
    }
    const addedColumn = trimmed.match(/^ALTER TABLE "(members|tickets)" ADD COLUMN "([^"]+)" boolean([^;]*)/);
    if (addedColumn) {
      const tableName = addedColumn[1],
        table = this.state.tables[tableName];
      const rawDefault = addedColumn[3].match(/DEFAULT ('[^']*'|true|false|\d+)/)?.[1] ?? null;
      const defaultValue = rawDefault?.startsWith("'") ? `${rawDefault}::text` : rawDefault;
      table.columns.push(
        column(
          tableName,
          addedColumn[2],
          table.columns.length + 1,
          'boolean',
          !addedColumn[3].includes('NOT NULL'),
          defaultValue,
        ),
      );
      table.rows.forEach(row => {
        row[addedColumn[2]] =
          rawDefault === 'false'
            ? false
            : rawDefault === 'true'
              ? true
              : rawDefault
                ? rawDefault.replace(/^'|'$/g, '')
                : null;
      });
      return result([]);
    }
    if (/^ALTER TABLE ".+" ADD CONSTRAINT /.test(trimmed) || /^CREATE (?:UNIQUE )?INDEX /.test(trimmed))
      return result([]);
    if (/^insert into "drizzle"\."__drizzle_migrations"/.test(trimmed)) {
      this.state.journal.push({ id: this.state.journal.length + 1, hash: values[0], created_at: String(values[1]) });
      return result([]);
    }
    if (/AS markedMembers/.test(sql))
      return result([
        {
          backupsettings: String(this.state.tables.automaticBackupSettings.rows.length),
          backupruns: String(this.state.tables.automaticBackupRuns.rows.length),
          backupusage: String(this.state.tables.automaticBackupUsage.rows.length),
          inboundfiles: String(this.state.tables.inboundMailJobFiles.rows.length),
          inboundjobs: String(this.state.tables.inboundMailJobs.rows.length),
          presence: String(this.state.tables.ticketPresence.rows.length),
          markedmembers: String(this.state.tables.members.rows.filter(row => row.isTest !== false).length),
          markedtickets: String(this.state.tables.tickets.rows.filter(row => row.isTest !== false).length),
        },
      ]);
    if (trimmed === 'COMMIT') {
      assert.ok(this.outerSnapshot, 'A real outer transaction must exist');
      this.commits++;
      this.outerSnapshot = undefined;
      return result([]);
    }
    if (trimmed === 'ROLLBACK') {
      assert.ok(this.outerSnapshot, 'The outer transaction must exist before rollback');
      this.state = clone(this.outerSnapshot);
      this.outerSnapshot = undefined;
      return result([]);
    }
    throw new Error(`Unexpected fixture SQL: ${sql}`);
  }
}

async function artifactFolder(t, transform = () => undefined) {
  const source = await loadReliabilityMigrationArtifacts();
  transform(source);
  const directory = await mkdtemp(join(tmpdir(), 'daybook-reliability-operator-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'meta'));
  await writeFile(join(directory, 'meta/_journal.json'), source.journalText);
  for (const file of source.files) await writeFile(join(directory, `${file.tag}.sql`), file.content);
  return directory;
}

test('0006 requires exact mode and target plus its separate apply token, and pins production TLS/URLs', () => {
  assert.equal(validateReliabilityCliArguments(['--audit'], {}), 'audit');
  assert.equal(validateReliabilityCliArguments(['--dry-run'], environment), 'dry-run');
  assert.equal(validateReliabilityCliArguments(['--apply'], environment), 'apply');
  for (const args of [[], ['--apply', '--audit'], ['--apply=0006'], ['--audit', 'secret']])
    assert.throws(() => validateReliabilityCliArguments(args, environment), MigrationOperatorError);
  assert.throws(() => validateReliabilityCliArguments(['--dry-run'], {}), MigrationOperatorError);
  for (const token of [undefined, '0005', '', 'true'])
    assert.throws(
      () =>
        validateReliabilityCliArguments(['--apply'], {
          ...environment,
          DAYBOOK_PRODUCTION_MIGRATION_ALLOW_APPLY: token,
        }),
      MigrationOperatorError,
    );
  assert.throws(
    () =>
      validateReliabilityCliArguments(['--apply'], {
        ...environment,
        DAYBOOK_PRODUCTION_MIGRATION_CONFIRM_TARGET: RELIABILITY_CONFIRM_TARGET.replace('0006', '0005'),
      }),
    MigrationOperatorError,
  );
  assert.equal(validateProductionConnectionTargets(environment), environment.DIRECT_DATABASE_URL);
  assert.equal(new URL(validateReliabilityProductionTargets(environment)).searchParams.get('sslmode'), 'verify-full');
  for (const direct of [
    environment.DATABASE_URL,
    environment.DIRECT_DATABASE_URL.replace('/daybook_ticket?', '/other?'),
    environment.DIRECT_DATABASE_URL.replace('ep-dawn-moon-bbwpjcrp.', 'ep-falling-water-bbfa4ijl.'),
    environment.DIRECT_DATABASE_URL.replace('sslmode=require', 'sslmode=disable'),
    `${environment.DIRECT_DATABASE_URL}&host=localhost`,
    `${environment.DIRECT_DATABASE_URL}&dbname=other`,
    `${environment.DIRECT_DATABASE_URL}&options=-c%20search_path=evil`,
    `${environment.DIRECT_DATABASE_URL}#fragment`,
  ])
    assert.throws(
      () => validateReliabilityProductionTargets({ ...environment, DIRECT_DATABASE_URL: direct }),
      MigrationOperatorError,
    );
});

test('seven immutable reviewed artifacts are snapshotted; future migrations are excluded', async t => {
  const source = await loadReliabilityMigrationArtifacts();
  assert.equal(source.files.length, 7);
  assert.equal(source.files[6].hash, 'aa06eded54a9c36ddc77a3ecb3018a1b8460bb1f5a617870b3e276f245ea6797');
  assert.ok(source.files.every((file, index) => hash(file.content) === RELIABILITY_PINNED_MIGRATIONS[index].hash));
  const directory = await artifactFolder(t, artifacts => {
    const journal = JSON.parse(artifacts.journalText);
    journal.entries.push({ idx: 7, version: '7', when: 1793892925788, tag: '0007_unreviewed', breakpoints: true });
    artifacts.journalText = JSON.stringify(journal);
  });
  assert.equal(JSON.parse((await loadReliabilityMigrationArtifacts(directory)).journalText).entries.length, 7);
  for (const index of [0, 5, 6]) {
    const folder = await artifactFolder(t, artifacts => {
      artifacts.files[index].content = Buffer.from('SELECT 1;');
    });
    await assert.rejects(
      loadReliabilityMigrationArtifacts(folder),
      error => error.operatorCode === 'migration_source_hash_mismatch',
    );
  }
  const folder = await artifactFolder(t, artifacts => {
    const journal = JSON.parse(artifacts.journalText);
    journal.entries[6].when++;
    artifacts.journalText = JSON.stringify(journal);
  });
  await assert.rejects(
    loadReliabilityMigrationArtifacts(folder),
    error => error.operatorCode === 'unexpected_source_journal',
  );
});

test('only exact pre-0006 or already-0006 journals are accepted', () => {
  assert.equal(validateReliabilityMigrationJournal(expectedJournal.slice(0, 6)), false);
  assert.equal(validateReliabilityMigrationJournal(expectedJournal), true);
  for (const rows of [
    [],
    expectedJournal.slice(0, 5),
    [...expectedJournal, expectedJournal[6]],
    [...expectedJournal].reverse(),
    expectedJournal.map((row, index) => (index === 6 ? { ...row, hash: 'unknown' } : row)),
  ])
    assert.throws(() => validateReliabilityMigrationJournal(rows), MigrationOperatorError);
});

test('audit is one read-only consistent snapshot with aggregate fingerprints and no locks or writes', async () => {
  const client = new FixtureClient(),
    report = await runReliabilityMigrationOperator(client);
  assert.equal(report.migration, '0006_pending');
  assert.equal(report.committed, false);
  assert.equal(report.reliability, null);
  assert.equal(client.queries[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(client.queries.at(-1).sql, 'ROLLBACK');
  assert.equal(
    client.queries.some(
      ({ sql }) =>
        /^\s*(LOCK|CREATE|ALTER|INSERT|UPDATE|DELETE|COMMIT)\b/i.test(sql) || /pg_try_advisory_xact_lock/.test(sql),
    ),
    false,
  );
  assert.equal(/FICTIONAL_PRIVATE|fictional_password/.test(JSON.stringify(report)), false);
  assert.deepEqual(client.state, client.initial);
  assert.ok(report.fingerprints.some(row => row.table === 'unknown"table'));
});

test('dry-run exercises the actual migrator/savepoint and rolls back exactly 0006 DDL plus journal', async () => {
  const client = new FixtureClient(),
    report = await runReliabilityMigrationOperator(client, { mode: 'dry-run' });
  assert.equal(report.migration, '0006_would_apply');
  assert.equal(report.committed, false);
  assert.equal(client.commits, 0);
  assert.deepEqual(client.state, client.initial);
  for (const prefix of ['BEGIN ', 'SAVEPOINT ', 'RELEASE SAVEPOINT '])
    assert.equal(client.queries.filter(({ sql }) => sql.startsWith(prefix)).length, 1);
  assert.equal(client.queries.at(-1).sql, 'ROLLBACK');
  assert.equal(
    client.queries.some(({ sql }) => /CREATE TABLE "automaticBackupRuns"/.test(sql)),
    true,
  );
  assert.equal(
    client.queries.some(({ sql }) => /CREATE TABLE "tickets"|CREATE TABLE "ticketSatisfaction"/.test(sql)),
    false,
  );
  const inserts = client.queries.filter(({ sql }) => /^\s*insert into\b/i.test(sql));
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].values[0], RELIABILITY_PINNED_MIGRATIONS[6].hash);
});

test('apply commits once after preserving all old columns and zero jobs/presence/backups/test flags', async () => {
  const client = new FixtureClient(),
    report = await runReliabilityMigrationOperator(client, { mode: 'apply' });
  assert.equal(report.migration, '0006_applied');
  assert.equal(report.committed, true);
  assert.equal(client.commits, 1);
  assert.equal(client.state.journal.length, 7);
  assert.equal(report.preservedTables, 7);
  assert.equal(report.preservedRows, '7');
  assert.equal(client.queries.at(-1).sql, 'COMMIT');
  assert.deepEqual(report.reliability, {
    backupsettings: '0',
    backupruns: '0',
    backupusage: '0',
    inboundfiles: '0',
    inboundjobs: '0',
    presence: '0',
    markedmembers: '0',
    markedtickets: '0',
  });
  assert.equal(client.state.tables.members.rows[0].isTest, false);
  assert.equal(client.state.tables.tickets.rows[0].isTest, false);
  for (const [table, field] of [
    ['members', 'passwordHash'],
    ['tickets', 'dueAt'],
    ['messages', 'body'],
    ['mailOutbox', 'payloadJson'],
    ['sessions', 'token'],
  ])
    assert.equal(client.state.tables[table].rows[0][field], client.initial.tables[table].rows[0][field]);
  assert.deepEqual(client.state.tables.settings, client.initial.tables.settings);
  const prints = client.queries.filter(({ sql }) => /all_fingerprints/.test(sql));
  assert.equal(prints.length, 2);
  assert.ok(
    prints.every(
      ({ sql }) => !sql.includes('isTest') && sql.includes('passwordHash') && sql.includes('"strange""column"'),
    ),
  );
  assert.equal(/FICTIONAL_PRIVATE|fictional_password/.test(JSON.stringify(report)), false);
});

test('already applied modes preserve real jobs/backups/test flags and never rerun DDL', async () => {
  const client = new FixtureClient();
  await runReliabilityMigrationOperator(client, { mode: 'apply' });
  client.state.tables.automaticBackupSettings.rows.push({ ownerId: 'existing-owner', enabled: true });
  client.state.tables.inboundMailJobs.rows.push({ providerId: 'existing-job' });
  client.state.tables.members.rows[0].isTest = true;
  const preserved = clone(client.state);
  for (const mode of ['audit', 'dry-run', 'apply']) {
    client.queries = [];
    const report = await runReliabilityMigrationOperator(client, { mode });
    assert.equal(report.reliability.backupsettings, '1');
    assert.equal(report.reliability.markedmembers, '1');
    assert.deepEqual(client.state, preserved);
    assert.equal(
      client.queries.some(({ sql }) => /^\s*(CREATE|ALTER|INSERT|UPDATE|DELETE|SAVEPOINT)\b/i.test(sql)),
      false,
    );
  }
});

test('artifact mutation after validation cannot alter the executed private snapshot', async () => {
  const artifacts = await loadReliabilityMigrationArtifacts();
  const client = new FixtureClient({ onBegin: () => artifacts.files[6].content.fill(0) });
  assert.equal(
    (await runReliabilityMigrationOperator(client, { mode: 'dry-run', artifacts })).migration,
    '0006_would_apply',
  );
  assert.deepEqual(client.state, client.initial);
  const tampered = await loadReliabilityMigrationArtifacts();
  tampered.files[6].content.fill(0);
  const untouched = new FixtureClient();
  await assert.rejects(
    runReliabilityMigrationOperator(untouched, { mode: 'apply', artifacts: tampered }),
    MigrationOperatorError,
  );
  assert.equal(untouched.queries.length, 0);
});

test('wrong database, contention, lock timeout, catalog drift and DDL error roll back everything', async () => {
  for (const options of [
    { database: 'other' },
    { locked: false },
    { fail: sql => sql.startsWith('LOCK TABLE public.') },
    { fail: sql => /ALTER TABLE "members" ADD COLUMN/.test(sql) },
    {
      afterTableLock: state => {
        state.tables.members.columns[1].column_default = "'changed'::text";
      },
    },
  ]) {
    const client = new FixtureClient(options);
    await assert.rejects(runReliabilityMigrationOperator(client, { mode: 'apply' }));
    assert.equal(client.commits, 0);
    assert.equal(client.queries.at(-1).sql, 'ROLLBACK');
    assert.deepEqual(client.state, client.initial);
  }
});

test('partial reliability schema or unknown journal aborts before any DDL', async () => {
  for (const change of [
    state => {
      state.journal[0].hash = 'unknown';
    },
    state => {
      state.tables.automaticBackupRuns = { rows: [], columns: [column('automaticBackupRuns', 'id', 1)] };
    },
    state => {
      state.tables.members.columns.push(column('members', 'isTest', 4, 'boolean', false, 'false'));
    },
    state => {
      state.tables.tickets.columns.push(column('tickets', 'isTest', 4, 'boolean', false, 'false'));
    },
  ]) {
    const client = new FixtureClient();
    change(client.state);
    const before = clone(client.state);
    await assert.rejects(runReliabilityMigrationOperator(client, { mode: 'apply' }), MigrationOperatorError);
    assert.equal(
      client.queries.some(({ sql }) => /^\s*(CREATE|ALTER|INSERT)\b/i.test(sql)),
      false,
    );
    assert.deepEqual(client.state, before);
  }
});

test('private data changes, drifted definitions, extra schema, backfill or nonfalse test markers abort before commit', async () => {
  const cases = [
    [
      state => {
        state.tables.members.rows[0].passwordHash = 'rewritten';
      },
      'original_data_preservation_failed',
    ],
    [
      state => {
        state.tables.settings.rows[0].data = 'rewritten';
      },
      'original_data_preservation_failed',
    ],
    [
      state => {
        state.tables.mailOutbox.rows[0].payloadJson = 'rewritten';
      },
      'original_data_preservation_failed',
    ],
    [
      state => {
        state.tables.sessions.columns[1].data_type = 'integer';
      },
      'existing_column_definition_changed',
    ],
    [
      state => {
        state.tables.unexpected = { rows: [], columns: [column('unexpected', 'id', 1)] };
      },
      'unexpected_public_schema_change',
    ],
    [
      state => {
        state.tables.members.columns.push(column('members', 'unexpected', 5));
      },
      'unexpected_public_column_change',
    ],
    [
      state => {
        state.journal[6].hash = 'changed';
      },
      'unexpected_database_journal',
    ],
    ...[
      'automaticBackupSettings',
      'automaticBackupRuns',
      'automaticBackupUsage',
      'inboundMailJobFiles',
      'inboundMailJobs',
      'ticketPresence',
    ].map(table => [
      state => {
        state.tables[table].rows.push({ id: 'invented' });
      },
      'unexpected_reliability_backfill',
    ]),
    [
      state => {
        state.tables.members.rows[0].isTest = true;
      },
      'unexpected_reliability_backfill',
    ],
    [
      state => {
        state.tables.tickets.rows[0].isTest = null;
      },
      'unexpected_reliability_backfill',
    ],
    [
      state => {
        state.tables.members.columns.find(item => item.column_name === 'isTest').column_default = 'true';
      },
      'reliability_test_flag_schema_mismatch',
    ],
    [
      state => {
        state.tables.tickets.columns.find(item => item.column_name === 'isTest').not_null = false;
      },
      'reliability_test_flag_schema_mismatch',
    ],
    [
      state => {
        state.tables.automaticBackupSettings.columns.find(item => item.column_name === 'enabled').column_default =
          'true';
      },
      'reliability_table_schema_mismatch',
    ],
  ];
  for (const [afterMigration, code] of cases) {
    const client = new FixtureClient({ afterMigration });
    await assert.rejects(
      runReliabilityMigrationOperator(client, { mode: 'apply' }),
      error => error.operatorCode === code,
      code,
    );
    assert.equal(client.commits, 0);
    assert.equal(client.queries.at(-1).sql, 'ROLLBACK');
    assert.deepEqual(client.state, client.initial);
  }
});

test('failure reports disclose only safe operator or SQLSTATE codes', () => {
  for (const error of [
    new Error('PRIVATE_CREDENTIAL'),
    { code: 'PRIVATE_CREDENTIAL', detail: 'PRIVATE_TICKET' },
    { operatorCode: 'PRIVATE_PASSWORD' },
  ])
    assert.deepEqual(reliabilityFailureReport(error), { result: 'FAIL', code: 'operator_failed' });
  assert.deepEqual(reliabilityFailureReport(new MigrationOperatorError('original_data_preservation_failed')), {
    result: 'FAIL',
    code: 'original_data_preservation_failed',
  });
  assert.deepEqual(reliabilityFailureReport({ cause: { code: '55P03', detail: 'PRIVATE_CREDENTIAL' } }), {
    result: 'FAIL',
    code: '55P03',
  });
});
