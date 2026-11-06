import { Pool } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Database } from './database';
import { explicitSslMode } from './connection-string';
import * as schema from './schema';

let pool: Pool | undefined;
let database: Database | undefined;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('Falta configurar DATABASE_URL.');
    pool = new Pool({ connectionString: explicitSslMode(connectionString), max: 5, idleTimeoutMillis: 5000, connectionTimeoutMillis: 10000 });
    attachDatabasePool(pool);
    pool.on('error', () => console.error('Daybook Ticket database connection unavailable'));
  }
  return pool;
}

export function getDatabase(): Database {
  database ??= new Database(getPool());
  return database;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}
