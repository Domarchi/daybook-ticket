import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
const connectionString = process.env.DIRECT_DATABASE_URL;
if (!connectionString) throw new Error('Falta DIRECT_DATABASE_URL para ejecutar las migraciones.');
const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10000 });
try {
  await migrate(drizzle(pool), { migrationsFolder: './drizzle-postgres' });
  console.log('Migraciones PostgreSQL aplicadas.');
} catch (error) {
  console.error('Falló la migración PostgreSQL:', error.code || error.cause?.code || error.name);
  process.exitCode = 1;
} finally {
  await pool.end();
}
