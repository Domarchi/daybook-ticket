/** Atomic additive 0004 rehearsal on the fixed fictitious QA database only. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createMigrationSavepointClient } from './migrate-notifications-production.mjs';

assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
assert.ok(!process.env.RESEND_API_KEY && !process.env.DAYBOOK_EMAIL_FROM && !process.env.VAPID_PRIVATE_KEY);
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
assert.equal(url.pathname, '/daybook_ticket');
url.hostname = 'ep-falling-water-bbfa4ijl.c-15.us-east-1.aws.neon.tech';
url.searchParams.set('sslmode', 'verify-full');
const journal = JSON.parse(await readFile('drizzle-postgres/meta/_journal.json', 'utf8'));
assert.equal(journal.entries.at(-1).tag, '0004_service_operations');
const sources = await Promise.all(journal.entries.map(async entry => ({ ...entry,
  hash: createHash('sha256').update(await readFile(`drizzle-postgres/${entry.tag}.sql`)).digest('hex'),
})));
const sql = await readFile('drizzle-postgres/0004_service_operations.sql', 'utf8');
assert.ok(!/(?:^|;)\s*(?:DROP|UPDATE|DELETE|TRUNCATE)\b/i.test(sql), 'Only additive migration statements are permitted.');
const client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 10000 });
const quote = text => `"${text.replaceAll('"', '""')}"`;
async function fingerprint(tables) {
  return (await client.query([...tables].map(([table, columns], index) => `SELECT $${index + 1}::text AS name,count(*)::text AS rows,
    encode(sha256(convert_to(COALESCE(string_agg(h,'' ORDER BY h COLLATE "C"),''),'UTF8')),'hex') AS sha256
    FROM (SELECT encode(sha256(convert_to(jsonb_build_array(${columns.map(quote).join(',')})::text,'UTF8')),'hex') AS h FROM public.${quote(table)}) r`).join(' UNION ALL '), [...tables.keys()])).rows;
}
try {
  await client.connect();
  await client.query("BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='45s'; SET LOCAL transaction_timeout='90s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('daybook-operations-0004-migration',0))");
  const rows = (await client.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name COLLATE \"C\",ordinal_position")).rows;
  const tables = new Map();
  for (const row of rows) tables.set(row.table_name, [...(tables.get(row.table_name) || []), row.column_name]);
  await client.query(`LOCK TABLE ${[...tables.keys()].map(table => `public.${quote(table)}`).join(',')} IN SHARE ROW EXCLUSIVE MODE`);
  const before = await fingerprint(tables);
  const recorded = (await client.query('SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id')).rows;
  assert.ok(recorded.length === 4 || recorded.length === 5);
  recorded.forEach((row, i) => { assert.equal(row.hash, sources[i].hash); assert.equal(String(row.created_at), String(sources[i].when)); });
  const adapter = createMigrationSavepointClient(client);
  await migrate(drizzle({ client: adapter.client }), { migrationsFolder: './drizzle-postgres' });
  adapter.assertReleased();
  assert.deepEqual(await fingerprint(tables), before, 'Preexisting column data must remain byte-equivalent.');
  assert.equal((await client.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations')).rows[0].n, 5);
  if (recorded.length === 4) {
    const result = (await client.query(`SELECT
      (SELECT count(*) FROM "servicePolicies")::int AS policies,(SELECT count(*) FROM "assignmentRules")::int AS rules,
      (SELECT count(*) FROM "agentAvailability")::int AS availability,(SELECT count(*) FROM "ticketSlaOutcomes")::int AS outcomes,
      (SELECT count(*) FROM tickets WHERE "slaStartedAt" IS NOT NULL OR "slaPolicySnapshot" IS NOT NULL)::int AS backfill`)).rows[0];
    assert.ok(Object.values(result).every(value => value === 0), 'No configuration, routing or history may be backfilled.');
  }
  await client.query('COMMIT');
  const result = { result: 'PASS', migration: '0004_service_operations', preservedTables: tables.size,
    preservedRows: before.reduce((n, row) => n + Number(row.rows), 0), originalColumnsUnchanged: true, fingerprints: before };
  await mkdir('work', { recursive: true });
  await writeFile('work/QA_MIGRATION_0004_RESULT.json', JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...result, fingerprints: undefined }));
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error(JSON.stringify({ result: 'FAIL', code: error.code || error.operatorCode || error.name }));
  process.exitCode = 1;
} finally { await client.end(); }
