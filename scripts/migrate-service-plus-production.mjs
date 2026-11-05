/** Reviewed production operator for EXACTLY migration 0005.
 *
 * Supply DATABASE_URL and DIRECT_DATABASE_URL privately through the environment;
 * neither credentials nor row contents are accepted in arguments or printed.
 * Requires Node 24 and the reviewed repository dependencies, without app imports.
 *
 * Read-only preflight:
 *   node scripts/migrate-service-plus-production.mjs --audit
 * Full rehearsal, locks + DDL + preservation checks, always ROLLBACK:
 *   DAYBOOK_PRODUCTION_MIGRATION_CONFIRM_TARGET='daybook-ticket:ep-dawn-moon-bbwpjcrp.c-15.us-east-1.aws.neon.tech/daybook_ticket:0005' node scripts/migrate-service-plus-production.mjs --dry-run
 * Later, ONLY after publication authorization and a reviewed restoration point:
 *   DAYBOOK_PRODUCTION_MIGRATION_CONFIRM_TARGET='daybook-ticket:ep-dawn-moon-bbwpjcrp.c-15.us-east-1.aws.neon.tech/daybook_ticket:0005' DAYBOOK_PRODUCTION_MIGRATION_ALLOW_APPLY=0005 node scripts/migrate-service-plus-production.mjs --apply
 *
 * Both writing modes use one direct pg.Client and one outer transaction. The
 * installed Drizzle migrator runs inside a savepoint, never an independent
 * COMMIT. Every preexisting public column is fingerprinted under write locks.
 * PostgreSQL sequence increments are not transactional: a dry-run may leave a
 * harmless gap in the Drizzle journal's serial ID, while its rows roll back.
 * No surveys, escalations, inbound receipts, history or settings are seeded
 * or backfilled. Existing messages receive only the safe 'plain' format label,
 * never an interpretation or rewrite of their original body text. An already-applied 0005 is verified without invoking migrate.
 * This file does not deploy an application or activate production features.
 */
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import {
  MigrationOperatorError, validateProductionConnectionTargets, createMigrationSavepointClient,
} from './migrate-notifications-production.mjs';

export { MigrationOperatorError, validateProductionConnectionTargets };
export const SERVICE_PLUS_CONFIRM_TARGET = 'daybook-ticket:ep-dawn-moon-bbwpjcrp.c-15.us-east-1.aws.neon.tech/daybook_ticket:0005';
export const SERVICE_PLUS_PINNED_MIGRATIONS = Object.freeze([
  Object.freeze({ tag: '0000_flawless_boom_boom', when: 1793724458940, hash: 'bb40fcb55bc3c31a072a34369faee0b7bf59fe794c1f319cf4737d6204283c46' }),
  Object.freeze({ tag: '0001_premium_silver_fox', when: 1793742279077, hash: '78c2f233a100951dc7553c24032893c2ec2a3d6b285d8d7bc9ce62306276bb19' }),
  Object.freeze({ tag: '0002_companies_team_workflow', when: 1793761521497, hash: '6d9a27107a9b8a916a2b89bceb25f716d0d1f6346aadfbc9526e1a8265225830' }),
  Object.freeze({ tag: '0003_notification_center_delivery_reminders', when: 1793801286130, hash: 'c1b0dfca16966ae89e7cbe0828e43558828af532eea0abd0adfbb4ca7b5128c2' }),
  Object.freeze({ tag: '0004_service_operations', when: 1793834997001, hash: '9342a5088781d12820d8905085c86e8f56c5f157bad2565058cd956b06975763' }),
  Object.freeze({ tag: '0005_service_plus', when: 1793852652432, hash: '34834ec6946844394916d06bedf3e5089dbf615c552e5e8ad541956f66eeffba' }),
]);

// [name, SQL type, nullable, canonical PostgreSQL default expression]
const text = name => [name, 'text', false, null];
const nullableText = name => [name, 'text', true, null];
const integer = name => [name, 'integer', false, null];
const nullableInteger = name => [name, 'integer', true, null];
const NEW_TABLE_COLUMNS = {
  escalationOccurrences: [text('id'), text('ownerId'), integer('ticketId'), text('activationAt'), integer('cycleMessageId'), nullableInteger('unansweredMessageId'), text('reason'), text('recipientMemberId'), nullableText('assigneeMemberId'), text('stageKey'), text('dueAtSnapshot'), text('createdAt'), text('expiresAt')],
  escalationSettings: [text('ownerId'), ['enabled', 'boolean', false, 'false'], ['unansweredMinutes', 'integer', false, '240'], ['overdueMinutes', 'integer', false, '60'], ['recipientMemberIdsJson', 'text', false, "'[]'::text"], nullableText('activatedAt'), ['version', 'integer', false, '0'], text('updatedAt')],
  inboundMailReceipts: [text('providerId'), text('environment'), text('payloadHash'), nullableText('ownerId'), nullableText('memberId'), nullableInteger('ticketId'), nullableInteger('messageId'), text('status'), nullableText('reasonCode'), text('createdAt'), text('updatedAt')],
  ticketSatisfaction: [text('id'), text('ownerId'), integer('ticketId'), text('resolutionKey'), text('resolvedAt'), text('requesterMemberId'), nullableText('resolverMemberId'), nullableText('customerCompanyId'), nullableInteger('score'), nullableText('comment'), nullableText('submittedAt'), text('createdAt')],
};
const NEW_MAIL_COLUMNS = ['escalationId', 'satisfactionId'];
const quote = value => `"${value.replaceAll('"', '""')}"`;
const sha256 = value => createHash('sha256').update(value).digest('hex');
function guard(condition, code) { if (!condition) throw new MigrationOperatorError(code); }

export function validateServicePlusCliArguments(args, environment) {
  guard(args.length === 1 && ['--audit', '--dry-run', '--apply'].includes(args[0]), 'usage_audit_dry_run_or_apply_required');
  const mode = args[0].slice(2);
  if (mode !== 'audit') guard(environment.DAYBOOK_PRODUCTION_MIGRATION_CONFIRM_TARGET === SERVICE_PLUS_CONFIRM_TARGET, 'exact_target_confirmation_required');
  if (mode === 'apply') guard(environment.DAYBOOK_PRODUCTION_MIGRATION_ALLOW_APPLY === '0005', 'explicit_0005_apply_guard_required');
  return mode;
}

function checkedArtifacts(source) {
  let journal;
  try { journal = JSON.parse(source.journalText); } catch { throw new MigrationOperatorError('invalid_source_journal'); }
  guard(journal.version === '7' && journal.dialect === 'postgresql' && Array.isArray(journal.entries)
    && journal.entries.length >= 6 && Array.isArray(source.files) && source.files.length === 6, 'unexpected_source_journal');
  const files = SERVICE_PLUS_PINNED_MIGRATIONS.map((pinned, index) => {
    const entry = journal.entries[index], file = source.files[index];
    guard(entry?.idx === index && entry.version === '7' && entry.when === pinned.when && entry.tag === pinned.tag
      && entry.breakpoints === true, 'unexpected_source_journal');
    guard(file?.tag === pinned.tag && file.when === pinned.when && file.hash === pinned.hash
      && (Buffer.isBuffer(file.content) || typeof file.content === 'string'), 'migration_source_hash_mismatch');
    // Copy before any awaited DB work: callers cannot mutate a source Buffer
    // after its hash was checked and before the private migrator snapshot.
    const content = Buffer.from(file.content);
    guard(sha256(content) === pinned.hash, 'migration_source_hash_mismatch');
    return { ...pinned, content };
  });
  return { journalText: JSON.stringify({ ...journal, entries: journal.entries.slice(0, 6) }), files };
}

export async function loadServicePlusMigrationArtifacts(folder = new URL('../drizzle-postgres/', import.meta.url)) {
  const directory = folder instanceof URL ? fileURLToPath(folder) : folder;
  const journalText = await readFile(join(directory, 'meta/_journal.json'), 'utf8');
  const files = await Promise.all(SERVICE_PLUS_PINNED_MIGRATIONS.map(async pinned => ({
    ...pinned, content: await readFile(join(directory, `${pinned.tag}.sql`)),
  })));
  return checkedArtifacts({ journalText, files });
}

export function validateServicePlusMigrationJournal(rows) {
  guard(Array.isArray(rows) && (rows.length === 5 || rows.length === 6), 'unexpected_database_journal_length');
  rows.forEach((row, index) => {
    const pinned = SERVICE_PLUS_PINNED_MIGRATIONS[index];
    guard(row.hash === pinned.hash && String(row.created_at) === String(pinned.when), 'unexpected_database_journal');
  });
  return rows.length === 6;
}

async function databaseJournal(client) {
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
  guard(tables.size > 0 && ['tickets', 'messages', 'mailOutbox'].every(name => tables.has(name)), 'unexpected_public_schema');
  return tables;
}
async function fingerprints(client, tables) {
  const names = [...tables.keys()];
  const statements = [...tables].map(([table, columns], index) => `SELECT $${index + 1}::text AS "table", ${columns.length}::integer AS columns, count(*)::text AS rows,
    encode(sha256(convert_to(COALESCE(string_agg(row_hash, '' ORDER BY row_hash COLLATE "C"), ''), 'UTF8')), 'hex') AS sha256
    FROM (SELECT encode(sha256(convert_to(jsonb_build_array(${columns.map(column => quote(column.column_name)).join(',')})::text, 'UTF8')), 'hex') AS row_hash
      FROM public.${quote(table)}) original_rows`);
  return (await client.query(`SELECT * FROM (${statements.join(' UNION ALL ')}) all_fingerprints ORDER BY "table" COLLATE "C"`, names)).rows;
}
function verifyOriginalColumns(before, after) {
  for (const [table, columns] of before) {
    const current = after.get(table);
    guard(current && columns.every((column, index) => JSON.stringify(column) === JSON.stringify(current[index])), 'existing_column_definition_changed');
  }
}
function verifyOnlyExpectedColumnAdditions(before, after, alreadyApplied) {
  for (const [table, columns] of before) {
    const added = alreadyApplied ? [] : table === 'messages' ? ['bodyFormat'] : table === 'mailOutbox' ? NEW_MAIL_COLUMNS : [];
    guard(JSON.stringify(after.get(table)?.map(column => column.column_name)) === JSON.stringify([...columns.map(column => column.column_name), ...added]), 'unexpected_public_column_change');
  }
}
function verifyServicePlusSchema(tables) {
  for (const [table, definitions] of Object.entries(NEW_TABLE_COLUMNS)) {
    const columns = tables.get(table);
    guard(columns && columns.length === definitions.length, 'service_plus_table_schema_mismatch');
    for (const [index, [name, type, nullable, defaultValue]] of definitions.entries()) {
      const column = columns[index];
      guard(column.column_name === name && column.data_type === type && column.not_null === !nullable
        && column.column_default === defaultValue, 'service_plus_table_schema_mismatch');
    }
  }
  const format = tables.get('messages')?.find(column => column.column_name === 'bodyFormat');
  guard(format?.data_type === 'text' && format.not_null === true && format.column_default === "'plain'::text", 'service_plus_message_format_schema_mismatch');
  for (const name of NEW_MAIL_COLUMNS) {
    const column = tables.get('mailOutbox')?.find(item => item.column_name === name);
    guard(column?.data_type === 'text' && column.not_null === false && column.column_default === null, 'service_plus_mail_column_schema_mismatch');
  }
}
function verifyNoPartialServicePlusSchema(tables) {
  guard(Object.keys(NEW_TABLE_COLUMNS).every(table => !tables.has(table))
    && !tables.get('messages')?.some(column => column.column_name === 'bodyFormat')
    && !tables.get('mailOutbox')?.some(column => NEW_MAIL_COLUMNS.includes(column.column_name)), 'partial_service_plus_schema_without_journal');
}
async function servicePlusCounts(client) {
  return (await client.query(`SELECT
    (SELECT count(*) FROM public."escalationSettings")::text AS escalationSettings,
    (SELECT count(*) FROM public."escalationOccurrences")::text AS escalations,
    (SELECT count(*) FROM public."inboundMailReceipts")::text AS inbound,
    (SELECT count(*) FROM public."ticketSatisfaction")::text AS satisfaction,
    (SELECT count(*) FROM public.messages WHERE "bodyFormat" IS DISTINCT FROM 'plain')::text AS reformattedMessages,
    (SELECT count(*) FROM public."mailOutbox" WHERE "escalationId" IS NOT NULL OR "satisfactionId" IS NOT NULL)::text AS linkedAutomationMail`)).rows[0];
}

/** Normalize the checked direct URL to full certificate/hostname verification,
 * independent of pg-connection-string's changing semantics for sslmode=require.
 * Credentials are neither accepted as CLI args nor printed in any report. */
export function validateServicePlusProductionTargets(environment) {
  const direct = new URL(validateProductionConnectionTargets(environment));
  direct.searchParams.set('sslmode', 'verify-full');
  return direct.toString();
}

/** An already connected, independently guarded client permits isolated
 * rehearsals. The production CLI below always enforces both exact URL targets.
 * Only --apply can commit; --dry-run exercises the same migration then rolls
 * back its outer transaction, including the Drizzle journal insertion.
 */
export async function runServicePlusMigrationOperator(client, { mode = 'audit', artifacts } = {}) {
  guard(['audit', 'dry-run', 'apply'].includes(mode), 'invalid_operator_mode');
  const source = checkedArtifacts(artifacts ?? await loadServicePlusMigrationArtifacts());
  const writing = mode !== 'audit';
  let active = false, snapshotDirectory;
  try {
    await client.query(writing ? 'BEGIN ISOLATION LEVEL READ COMMITTED' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    active = true;
    await client.query("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='45s'; SET LOCAL idle_in_transaction_session_timeout='60s'; SET LOCAL TIME ZONE 'UTC'; SET LOCAL search_path=public");
    const identity = (await client.query("SELECT current_database() AS name, current_setting('server_version_num') AS version")).rows[0];
    guard(identity?.name === 'daybook_ticket', 'unexpected_database');
    if (Number(identity.version) >= 170000) await client.query("SET LOCAL transaction_timeout='90s'");
    if (writing) {
      const locked = (await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended('daybook-ticket:service-plus:0005',0)) AS locked")).rows[0]?.locked;
      guard(locked === true, 'another_migration_operator_is_running');
      await client.query('LOCK TABLE drizzle.__drizzle_migrations IN SHARE ROW EXCLUSIVE MODE');
    }
    const alreadyApplied = validateServicePlusMigrationJournal(await databaseJournal(client));
    const originals = await publicColumns(client);
    if (writing) {
      // One connection and deterministic table order; app writes can only wait
      // within the lock budget. Hold every lock until the final outer outcome.
      await client.query(`LOCK TABLE ${[...originals.keys()].map(table => `public.${quote(table)}`).join(', ')} IN SHARE ROW EXCLUSIVE MODE`);
      guard(JSON.stringify([...(await publicColumns(client))]) === JSON.stringify([...originals]), 'public_schema_changed_during_locking');
    }
    if (alreadyApplied) verifyServicePlusSchema(originals); else verifyNoPartialServicePlusSchema(originals);
    const before = await fingerprints(client, originals);
    if (mode === 'audit') {
      const counts = alreadyApplied ? await servicePlusCounts(client) : null;
      await client.query('ROLLBACK'); active = false;
      return { result: 'PASS', mode, migration: alreadyApplied ? '0005_already_applied' : '0005_pending', committed: false, fingerprints: before, servicePlus: counts };
    }
    if (!alreadyApplied) {
      snapshotDirectory = await mkdtemp(join(tmpdir(), 'daybook-0005-'));
      await mkdir(join(snapshotDirectory, 'meta'), { mode: 0o700 });
      await writeFile(join(snapshotDirectory, 'meta/_journal.json'), source.journalText, { mode: 0o600 });
      for (const file of source.files) await writeFile(join(snapshotDirectory, `${file.tag}.sql`), file.content, { mode: 0o600 });
      const adapter = createMigrationSavepointClient(client);
      await migrate(drizzle({ client: adapter.client, logger: false }), { migrationsFolder: snapshotDirectory });
      adapter.assertReleased();
    }
    guard(validateServicePlusMigrationJournal(await databaseJournal(client)), 'service_plus_journal_not_applied');
    const afterColumns = await publicColumns(client);
    const expectedTables = [...new Set([...originals.keys(), ...Object.keys(NEW_TABLE_COLUMNS)])].sort();
    guard(JSON.stringify([...afterColumns.keys()].sort()) === JSON.stringify(expectedTables), 'unexpected_public_schema_change');
    verifyOriginalColumns(originals, afterColumns);
    verifyOnlyExpectedColumnAdditions(originals, afterColumns, alreadyApplied);
    verifyServicePlusSchema(afterColumns);
    guard(JSON.stringify(await fingerprints(client, originals)) === JSON.stringify(before), 'original_data_preservation_failed');
    const counts = await servicePlusCounts(client);
    guard(counts && (!alreadyApplied ? Object.values(counts).every(count => count === '0') : true), 'unexpected_service_plus_backfill');
    await client.query(mode === 'apply' ? 'COMMIT' : 'ROLLBACK'); active = false;
    return { result: 'PASS', mode, migration: alreadyApplied ? '0005_already_applied_no_changes' : mode === 'apply' ? '0005_applied' : '0005_would_apply',
      committed: mode === 'apply', originalColumnsUnchanged: true, preservedTables: originals.size,
      preservedRows: before.reduce((total, item) => total + BigInt(item.rows), 0n).toString(), fingerprints: before, servicePlus: counts };
  } catch (error) {
    if (active) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    if (snapshotDirectory) await rm(snapshotDirectory, { recursive: true, force: true });
  }
}

export function servicePlusFailureReport(error) {
  const databaseCode = error?.code ?? error?.cause?.code;
  const code = error instanceof MigrationOperatorError && /^[a-z][a-z0-9_]{0,99}$/.test(error.operatorCode) ? error.operatorCode
    : /^[0-9A-Z]{5}$/.test(databaseCode || '') ? databaseCode : 'operator_failed';
  return { result: 'FAIL', code };
}

async function main() {
  const mode = validateServicePlusCliArguments(process.argv.slice(2), process.env);
  const artifacts = await loadServicePlusMigrationArtifacts();
  const connectionString = validateServicePlusProductionTargets(process.env);
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10000, query_timeout: 60000,
    application_name: 'daybook-ticket-service-plus-0005-operator' });
  try {
    await client.connect();
    console.log(JSON.stringify(await runServicePlusMigrationOperator(client, { mode, artifacts })));
  } finally { await client.end().catch(() => undefined); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(JSON.stringify(servicePlusFailureReport(error))); process.exitCode = 1; });
}
