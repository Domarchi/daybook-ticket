/** Guarded additive migration + byte-content preservation check. QA only. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
const pooledHost = 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech';
const directHost = 'ep-falling-water-bbfa4ijl.c-15.us-east-1.aws.neon.tech';
assert.equal(new URL(process.env.DATABASE_URL).hostname, pooledHost);
assert.ok(!process.env.RESEND_API_KEY && !process.env.DAYBOOK_EMAIL_FROM, 'No real email configuration may enter QA migration.');
const url = new URL(process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL);
if (url.hostname === pooledHost) url.hostname = directHost;
assert.equal(url.hostname, directHost);
const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
const quote = value => `"${value.replaceAll('"', '""')}"`;

async function fingerprint(table, columns) {
  const { rows } = await pool.query(`SELECT ${columns.map(quote).join(',')} FROM ${quote(table)}`);
  const stableRows = rows.map(row => JSON.stringify(row)).sort();
  return { count: stableRows.length, sha256: createHash('sha256').update(JSON.stringify(stableRows)).digest('hex') };
}
try {
  const { rows } = await pool.query(`SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='public' ORDER BY table_name,ordinal_position`);
  const tables = new Map();
  for (const row of rows) tables.set(row.table_name, [...(tables.get(row.table_name) || []), row.column_name]);
  // Record pre-existing columns, so additive defaults cannot disguise an old-data change.
  const before = new Map();
  for (const [table, columns] of tables) before.set(table, await fingerprint(table, columns));
  await migrate(drizzle(pool), { migrationsFolder: './drizzle-postgres' });
  for (const [table, columns] of tables) assert.deepEqual(await fingerprint(table, columns), before.get(table), `Existing data changed: ${table}`);
  const columns = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='mailOutbox' AND column_name IN ('readAt','reminderId','deliveryStatus','templateVersion')`)).rows;
  assert.equal(columns.length, 4);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM "notificationSettings" WHERE "remindersEnabled"=true')).rows[0].n, 0, 'No reminder activation during migration.');
  console.log(JSON.stringify({ result: 'PASS', preservedTables: tables.size, preservedRows: [...before.values()].reduce((sum, value) => sum + value.count, 0), migration: '0003_notification_center_delivery_reminders', remindersEnabled: false }));
} finally { await pool.end(); }
