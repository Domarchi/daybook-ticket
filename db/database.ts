import type { Pool, PoolClient, QueryResult } from 'pg';

export type DatabaseValue = string | number | boolean | Date | null;
export interface DatabaseResult<T = Record<string, unknown>> {
  results: T[];
  meta: { changes: number };
}

function result<T>(value: QueryResult): DatabaseResult<T> {
  return { results: value.rows as T[], meta: { changes: value.rowCount ?? 0 } };
}

/** Small application interface over native PostgreSQL SQL and bound $n parameters. */
export class PreparedStatement {
  readonly database: Database;
  readonly sql: string;
  readonly values: readonly DatabaseValue[];

  constructor(database: Database, sql: string, values: readonly DatabaseValue[] = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: DatabaseValue[]): PreparedStatement {
    return new PreparedStatement(this.database, this.sql, [...values]);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const value = await this.all<T>();
    return value.results[0] ?? null;
  }

  all<T = Record<string, unknown>>(): Promise<DatabaseResult<T>> {
    return this.database.execute<T>(this);
  }

  run<T = Record<string, unknown>>(): Promise<DatabaseResult<T>> {
    return this.database.execute<T>(this);
  }
}

export class Database {
  private readonly pool: Pool;

  constructor(pool: Pool) { this.pool = pool; }

  prepare(sql: string): PreparedStatement {
    return new PreparedStatement(this, sql);
  }

  async execute<T>(statement: PreparedStatement, client?: PoolClient): Promise<DatabaseResult<T>> {
    if (statement.database !== this) throw new Error('Statement belongs to another database.');
    return result<T>(await (client ?? this.pool).query(statement.sql, [...statement.values]));
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve original error. */ }
      throw error;
    } finally { client.release(); }
  }

  async batch<T = Record<string, unknown>>(statements: readonly PreparedStatement[]): Promise<DatabaseResult<T>[]> {
    if (statements.length === 0) return [];
    if (statements.some(statement => statement.database !== this)) throw new Error('Statement belongs to another database.');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const results: DatabaseResult<T>[] = [];
      // One connection preserves ordering and atomicity of all related writes.
      for (const statement of statements) results.push(await this.execute<T>(statement, client));
      await client.query('COMMIT');
      return results;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the original failure. */ }
      throw error;
    } finally {
      client.release();
    }
  }
}
