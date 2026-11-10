/** Reviewed production operator for EXACTLY migration 0003.
 * --audit: one repeatable-read READ ONLY snapshot; aggregate data only.
 * --apply: one connection + one outer transaction, locks, hashes, migration,
 *          verification, then COMMIT. Any failure rolls everything back.
 *
 * Credentials are supplied privately through the environment, never CLI args.
 * No application imports, seeds, auth changes, notifications or provider calls.
 * Library exports permit an independently guarded isolated rehearsal connection;
 * the production CLI always enforces the exact production hosts and database.
 */
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const PROD_POOLED_HOST = 'ep-dawn-moon-bbwpjcrp-pooler.c-15.us-east-1.aws.neon.tech';
const PROD_DIRECT_HOST = 'ep-dawn-moon-bbwpjcrp.c-15.us-east-1.aws.neon.tech';
const DATABASE_NAME = 'daybook_ticket';
export const PINNED_MIGRATIONS = Object.freeze([
  {
    tag: '0000_flawless_boom_boom',
    when: 1793724458940,
    hash: 'bb40fcb55bc3c31a072a34369faee0b7bf59fe794c1f319cf4737d6204283c46',
  },
  {
    tag: '0001_premium_silver_fox',
    when: 1793742279077,
    hash: '78c2f233a100951dc7553c24032893c2ec2a3d6b285d8d7bc9ce62306276bb19',
  },
  {
    tag: '0002_companies_team_workflow',
    when: 1793761521497,
    hash: '6d9a27107a9b8a916a2b89bceb25f716d0d1f6346aadfbc9526e1a8265225830',
  },
  {
    tag: '0003_notification_center_delivery_reminders',
    when: 1793801286130,
    hash: 'c1b0dfca16966ae89e7cbe0828e43558828af532eea0abd0adfbb4ca7b5128c2',
  },
]);
const NEW_TABLES = {
  mailDeliveryEvents: [
    'id',
    'outboxId',
    'ownerId',
    'providerId',
    'eventType',
    'occurredAt',
    'receivedAt',
    'payloadHash',
  ],
  notificationJobHealth: [
    'ownerId',
    'lastStartedAt',
    'lastSucceededAt',
    'lastFailedAt',
    'lastErrorCode',
    'lastInvocationId',
    'cursorTicketId',
    'leaseToken',
    'leaseUntil',
  ],
  notificationSettings: ['ownerId', 'alertsActivatedAt', 'remindersEnabled', 'remindersActivatedAt'],
  reminderOccurrences: [
    'id',
    'ownerId',
    'ticketId',
    'cycleMessageId',
    'unansweredMessageId',
    'activationAt',
    'sequence',
    'reasonsJson',
    'recipientMemberIdsJson',
    'dueAtSnapshot',
    'createdAt',
    'expiresAt',
  ],
};
const NEW_MAIL_COLUMNS = [
  'readAt',
  'reminderId',
  'templateVersion',
  'environment',
  'deliveryStatus',
  'deliveryEventAt',
  'deliveredAt',
  'bouncedAt',
  'complainedAt',
  'deliveryErrorCode',
];
const quote = value => `"${value.replaceAll('"', '""')}"`;
const hash = value => createHash('sha256').update(value).digest('hex');

export class MigrationOperatorError extends Error {
  constructor(code) {
    super(code);
    this.operatorCode = code;
  }
}
function guard(condition, code) {
  if (!condition) throw new MigrationOperatorError(code);
}

export function validateProductionConnectionTargets(environment) {
  const parse = (value, host) => {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new MigrationOperatorError('invalid_connection_target');
    }
    guard(
      ['postgres:', 'postgresql:'].includes(url.protocol) &&
        url.hostname === host &&
        (!url.port || url.port === '5432') &&
        url.pathname === `/${DATABASE_NAME}` &&
        url.username &&
        url.password &&
        !url.hash,
      'invalid_connection_target',
    );
    // pg-connection-string accepts query-string host/db overrides. An allowlist
    // prevents a visually correct URL from selecting another server/database.
    const keys = [...url.searchParams.keys()];
    guard(
      keys.every(key => ['sslmode', 'channel_binding'].includes(key)) && new Set(keys).size === keys.length,
      'unsafe_connection_options',
    );
    guard(['require', 'verify-full'].includes(url.searchParams.get('sslmode')), 'tls_required');
    const binding = url.searchParams.get('channel_binding');
    guard(binding === null || binding === 'require', 'unsafe_connection_options');
    return url;
  };
  const pooled = parse(environment.DATABASE_URL, PROD_POOLED_HOST);
  const direct = parse(environment.DIRECT_DATABASE_URL, PROD_DIRECT_HOST);
  guard(pooled.pathname === direct.pathname, 'database_mismatch');
  return direct.toString();
}

export async function loadPinnedMigrationArtifacts(folder = new URL('../drizzle-postgres/', import.meta.url)) {
  const directory = folder instanceof URL ? fileURLToPath(folder) : folder;
  const journalText = await readFile(join(directory, 'meta/_journal.json'), 'utf8');
  let journal;
  try {
    journal = JSON.parse(journalText);
  } catch {
    throw new MigrationOperatorError('invalid_source_journal');
  }
  guard(
    journal.version === '7' && journal.dialect === 'postgresql' && journal.entries?.length >= 4,
    'unexpected_source_journal',
  );
  const files = [];
  for (const [index, pinned] of PINNED_MIGRATIONS.entries()) {
    const entry = journal.entries[index];
    guard(
      entry.idx === index &&
        entry.version === '7' &&
        entry.when === pinned.when &&
        entry.tag === pinned.tag &&
        entry.breakpoints === true,
      'unexpected_source_journal',
    );
    const content = await readFile(join(directory, `${pinned.tag}.sql`));
    guard(hash(content) === pinned.hash, 'migration_source_hash_mismatch');
    files.push({ ...pinned, content });
  }
  // This historical operator owns 0003 only, even when the repository advances.
  return { journalText: JSON.stringify({ ...journal, entries: journal.entries.slice(0, 4) }), files };
}

export function validateMigrationJournal(rows) {
  guard(rows.length === 3 || rows.length === 4, 'unexpected_database_journal_length');
  for (const [index, row] of rows.entries()) {
    const pinned = PINNED_MIGRATIONS[index];
    guard(row.hash === pinned.hash && String(row.created_at) === String(pinned.when), 'unexpected_database_journal');
  }
  return rows.length === 4;
}

/** Drizzle 0.45.2's migrate(db) calls db.session.transaction(), including when
 * passed a NodePgTransaction. Its session emits real BEGIN/COMMIT, so migrate(tx)
 * alone would prematurely commit the caller's outer transaction. This narrow
 * query adapter translates ONLY that exact one transaction into a savepoint.
 * It forwards every SQL/data query unchanged to the SAME connected pg.Client.
 */
export function createMigrationSavepointClient(client) {
  let state = 'initial';
  const name = 'daybook_notification_migration_0003';
  const query = async (input, ...arguments_) => {
    guard(!arguments_.some(argument => typeof argument === 'function'), 'unexpected_migrator_callback');
    const text = typeof input === 'string' ? input : input?.text;
    guard(typeof text === 'string', 'unexpected_migrator_query');
    const command = text.trim().toLowerCase();
    let replacement;
    if (command === 'begin') {
      guard(state === 'initial', 'unexpected_migrator_transaction');
      state = 'active';
      replacement = `SAVEPOINT ${name}`;
    } else if (command === 'commit') {
      guard(state === 'active', 'unexpected_migrator_transaction');
      replacement = `RELEASE SAVEPOINT ${name}`;
      const result = await client.query(
        typeof input === 'string' ? replacement : { ...input, text: replacement },
        ...arguments_,
      );
      state = 'released';
      return result;
    } else if (command === 'rollback') {
      guard(state === 'active', 'unexpected_migrator_transaction');
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      const result = await client.query(`RELEASE SAVEPOINT ${name}`);
      state = 'rolled_back';
      return result;
    } else {
      guard(
        !/^(?:begin|start\s+transaction|commit|end|rollback|savepoint|release)\b/i.test(command),
        'unexpected_migrator_transaction',
      );
      guard(state === 'initial' || state === 'active', 'query_after_migrator_transaction');
    }
    return client.query(
      replacement ? (typeof input === 'string' ? replacement : { ...input, text: replacement }) : input,
      ...arguments_,
    );
  };
  return { client: { query }, assertReleased: () => guard(state === 'released', 'migrator_did_not_release_savepoint') };
}

async function journal(client) {
  return (await client.query('SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id')).rows;
}
async function publicColumns(client) {
  const { rows } = await client.query(`SELECT c.relname AS table_name, a.attname AS column_name,
    a.attnum::integer AS position, format_type(a.atttypid, a.atttypmod) AS data_type, a.attnotnull AS not_null,
    pg_get_expr(d.adbin, d.adrelid) AS column_default
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY c.relname COLLATE "C", a.attnum`);
  const tables = new Map();
  for (const row of rows) tables.set(row.table_name, [...(tables.get(row.table_name) || []), row]);
  guard(tables.size > 0, 'empty_public_schema');
  return tables;
}
async function fingerprints(client, tables) {
  // One request for every table minimizes the interval in which application
  // writes wait for the migration locks. Labels are bound values, identifiers
  // come from the catalog and are quoted, and no row contents leave PostgreSQL.
  const names = [...tables.keys()];
  const statements = [...tables].map(
    (
      [table, columns],
      index,
    ) => `SELECT $${index + 1}::text AS "table", ${columns.length}::integer AS columns, count(*)::text AS rows,
      encode(sha256(convert_to(COALESCE(string_agg(row_hash, '' ORDER BY row_hash COLLATE "C"), ''), 'UTF8')), 'hex') AS sha256
      FROM (SELECT encode(sha256(convert_to(jsonb_build_array(${columns.map(column => quote(column.column_name)).join(',')})::text, 'UTF8')), 'hex') AS row_hash
        FROM public.${quote(table)}) original_rows`,
  );
  return (
    await client.query(
      `SELECT * FROM (${statements.join(' UNION ALL ')}) all_fingerprints ORDER BY "table" COLLATE "C"`,
      names,
    )
  ).rows;
}
function verifyOriginalColumns(before, after) {
  for (const [table, columns] of before) {
    const current = after.get(table);
    guard(
      current && columns.every((column, index) => JSON.stringify(column) === JSON.stringify(current[index])),
      'existing_column_definition_changed',
    );
  }
}
function verifyNewSchema(tables) {
  for (const [table, columns] of Object.entries(NEW_TABLES)) {
    const actual = tables.get(table)?.map(column => column.column_name);
    guard(actual && JSON.stringify(actual) === JSON.stringify(columns), 'notification_table_schema_mismatch');
  }
  const mail = tables.get('mailOutbox')?.map(column => column.column_name) || [];
  guard(
    NEW_MAIL_COLUMNS.every(column => mail.includes(column)),
    'notification_mail_columns_missing',
  );
}
async function summary(client, applied) {
  const queue = (
    await client.query(`SELECT status, count(*)::text AS total, min("createdAt") AS "oldestCreatedAt"
    FROM public."mailOutbox" GROUP BY status ORDER BY status`)
  ).rows;
  const settings = applied
    ? (
        await client.query(`SELECT count(*)::text AS total,
    count(*) FILTER (WHERE "remindersEnabled")::text AS enabled,
    min("alertsActivatedAt") AS "earliestAlertsCutoff", max("alertsActivatedAt") AS "latestAlertsCutoff"
    FROM public."notificationSettings"`)
      ).rows[0]
    : null;
  return { queue, notificationSettings: settings };
}

/** This library entry accepts an already connected, independently guarded client
 * so an isolated clone can rehearse the exact production transaction code. */
export async function runMigrationOperator(client, { apply = false, artifacts } = {}) {
  const source = artifacts ?? (await loadPinnedMigrationArtifacts());
  let active = false;
  let snapshotDirectory;
  try {
    await client.query(
      apply ? 'BEGIN ISOLATION LEVEL READ COMMITTED' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );
    active = true;
    await client.query(
      "SET LOCAL lock_timeout = '3s'; SET LOCAL statement_timeout = '45s'; SET LOCAL idle_in_transaction_session_timeout = '60s'; SET LOCAL TIME ZONE 'UTC'",
    );
    const identity = (
      await client.query("SELECT current_database() AS name, current_setting('server_version_num') AS version")
    ).rows[0];
    guard(identity?.name === DATABASE_NAME, 'unexpected_database');
    if (Number(identity.version) >= 170000) await client.query("SET LOCAL transaction_timeout = '90s'");
    if (apply) {
      const locked = (
        await client.query(
          "SELECT pg_try_advisory_xact_lock(hashtextextended('daybook-ticket:notifications:0003', 0)) AS locked",
        )
      ).rows[0]?.locked;
      guard(locked === true, 'another_migration_operator_is_running');
      await client.query('LOCK TABLE drizzle.__drizzle_migrations IN SHARE ROW EXCLUSIVE MODE');
    }
    const alreadyApplied = validateMigrationJournal(await journal(client));
    const originals = await publicColumns(client);
    if (apply) {
      // A single client avoids pool self-deadlock. Locks are deterministic and
      // held until the OUTER commit; live writes may wait at most the lock budget.
      await client.query(
        `LOCK TABLE ${[...originals.keys()].map(table => `public.${quote(table)}`).join(', ')} IN SHARE ROW EXCLUSIVE MODE`,
      );
      guard(
        JSON.stringify([...(await publicColumns(client)).keys()]) === JSON.stringify([...originals.keys()]),
        'public_schema_changed_during_locking',
      );
    }
    const before = await fingerprints(client, originals);
    if (!apply) {
      if (alreadyApplied) verifyNewSchema(originals);
      const aggregates = await summary(client, alreadyApplied);
      await client.query('ROLLBACK');
      active = false;
      return {
        result: 'PASS',
        mode: 'audit',
        migration: alreadyApplied ? '0003_already_applied' : '0003_pending',
        fingerprints: before,
        ...aggregates,
      };
    }
    if (!alreadyApplied) {
      guard(
        Object.keys(NEW_TABLES).every(table => !originals.has(table)) &&
          !originals.get('mailOutbox')?.some(column => NEW_MAIL_COLUMNS.includes(column.column_name)),
        'partial_notification_schema_without_journal',
      );
      // Freeze the already hash-checked source into a private temporary folder.
      // The standard migrator cannot pick up a concurrently edited SQL file.
      snapshotDirectory = await mkdtemp(join(tmpdir(), 'daybook-0003-'));
      await mkdir(join(snapshotDirectory, 'meta'), { mode: 0o700 });
      await writeFile(join(snapshotDirectory, 'meta/_journal.json'), source.journalText, { mode: 0o600 });
      for (const file of source.files)
        await writeFile(join(snapshotDirectory, `${file.tag}.sql`), file.content, { mode: 0o600 });
      const adapter = createMigrationSavepointClient(client);
      await migrate(drizzle({ client: adapter.client, logger: false }), { migrationsFolder: snapshotDirectory });
      adapter.assertReleased();
    }
    guard(validateMigrationJournal(await journal(client)), 'notification_journal_not_applied');
    const afterColumns = await publicColumns(client);
    const expectedTables = [...new Set([...originals.keys(), ...Object.keys(NEW_TABLES)])].sort();
    guard(
      JSON.stringify([...afterColumns.keys()].sort()) === JSON.stringify(expectedTables),
      'unexpected_public_schema_change',
    );
    verifyOriginalColumns(originals, afterColumns);
    verifyNewSchema(afterColumns);
    guard(
      JSON.stringify(await fingerprints(client, originals)) === JSON.stringify(before),
      'original_data_preservation_failed',
    );
    if (!alreadyApplied) {
      const invalid = (
        await client.query(`SELECT count(*)::text AS total FROM public."mailOutbox" WHERE "readAt" IS NOT NULL
        OR "reminderId" IS NOT NULL OR "templateVersion"<>1 OR environment IS NOT NULL OR "deliveryStatus"<>'untracked'
        OR "deliveryEventAt" IS NOT NULL OR "deliveredAt" IS NOT NULL OR "bouncedAt" IS NOT NULL OR "complainedAt" IS NOT NULL OR "deliveryErrorCode" IS NOT NULL`)
      ).rows[0]?.total;
      guard(invalid === '0', 'historical_mail_defaults_changed');
      const cutoffs = (
        await client.query(`SELECT
        (SELECT count(*) FROM public.organizations)::text AS organizations,
        count(*)::text AS settings,
        count(*) FILTER (WHERE "remindersEnabled" OR "remindersActivatedAt" IS NOT NULL OR "alertsActivatedAt" <> to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text AS invalid
        FROM public."notificationSettings"`)
      ).rows[0];
      guard(
        cutoffs?.organizations === cutoffs?.settings && cutoffs?.invalid === '0',
        'initial_notification_cutoffs_invalid',
      );
      const emptyTables = (
        await client.query(`SELECT
        (SELECT count(*) FROM public."mailDeliveryEvents")::text AS receipts,
        (SELECT count(*) FROM public."notificationJobHealth")::text AS jobs,
        (SELECT count(*) FROM public."reminderOccurrences")::text AS reminders`)
      ).rows[0];
      guard(emptyTables && Object.values(emptyTables).every(count => count === '0'), 'unexpected_notification_rows');
    }
    const aggregates = await summary(client, true);
    await client.query('COMMIT');
    active = false;
    return {
      result: 'PASS',
      mode: 'apply',
      migration: alreadyApplied ? '0003_already_applied_no_changes' : '0003_applied',
      preservedTables: originals.size,
      preservedRows: before.reduce((total, item) => total + BigInt(item.rows), 0n).toString(),
      fingerprints: before,
      ...aggregates,
    };
  } catch (error) {
    if (active) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    if (snapshotDirectory) await rm(snapshotDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  guard(args.length === 1 && ['--audit', '--apply'].includes(args[0]), 'usage_audit_or_apply_required');
  const apply = args[0] === '--apply';
  if (apply) guard(process.env.DAYBOOK_PRODUCTION_MIGRATION_ALLOW_APPLY === '0003', 'explicit_apply_guard_required');
  const artifacts = await loadPinnedMigrationArtifacts();
  const connectionString = validateProductionConnectionTargets(process.env);
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 10000,
    query_timeout: 60000,
    application_name: 'daybook-ticket-notifications-0003-operator',
  });
  try {
    await client.connect();
    console.log(JSON.stringify(await runMigrationOperator(client, { apply, artifacts })));
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    const databaseCode = error?.code ?? error?.cause?.code;
    const code =
      typeof error?.operatorCode === 'string'
        ? error.operatorCode
        : /^[0-9A-Z]{5}$/.test(databaseCode || '')
          ? databaseCode
          : 'operator_failed';
    console.error(JSON.stringify({ result: 'FAIL', code }));
    process.exitCode = 1;
  });
}
