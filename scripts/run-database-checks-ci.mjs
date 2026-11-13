/**
 * CI only: migrate the disposable Postgres service, then run every database check in series.
 * Each check creates fictitious owners and cleans up after itself; none reaches a provider.
 */
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { DATABASE_CHECKS, databaseCheckCi } from './database-check-target.mjs';

if (!databaseCheckCi()) throw Error('Este ejecutor solo corre con DAYBOOK_DATABASE_CI=1 en el CI.');

const only = process.argv.slice(2);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  await migrate(drizzle({ client: pool }), { migrationsFolder: './drizzle-postgres' });
} finally {
  await pool.end();
}

const failed = [];
for (const script of DATABASE_CHECKS.filter(name => !only.length || only.includes(name))) {
  const started = Date.now();
  console.log(`\n▶ ${script}`);
  const result = spawnSync(process.execPath, ['--import', 'tsx', `scripts/${script}`], {
    stdio: 'inherit',
    env: process.env,
    timeout: 5 * 60_000,
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.status === 0) console.log(`✔ ${script} (${seconds} s)`);
  else {
    failed.push(script);
    console.log(`✘ ${script} (${seconds} s, ${result.signal ?? `código ${result.status}`})`);
  }
}
if (failed.length) {
  console.error(`\nFallaron ${failed.length} pruebas de base de datos: ${failed.join(', ')}`);
  process.exit(1);
}
console.log('\nTodas las pruebas de base de datos pasaron.');
