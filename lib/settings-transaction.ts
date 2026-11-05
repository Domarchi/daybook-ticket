import type { PoolClient } from 'pg';
import { DEFAULT_SETTINGS, type Settings } from './types';

/** Read configuration on the mutation's connection, after the workspace lock. */
export async function getSettingsInTransaction(tx: PoolClient, ownerId: string): Promise<Settings> {
  const row = (await tx.query<{ data: string }>('SELECT data FROM settings WHERE "ownerId"=$1', [ownerId])).rows[0];
  return { ...structuredClone(DEFAULT_SETTINGS), ...(row ? JSON.parse(row.data) : {}) };
}
