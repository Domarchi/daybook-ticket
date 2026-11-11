/**
 * Daily message quota per person, without a new table: the counter lives in "authRateLimit", the table the sign-in
 * limits and `lib/rate-limit.ts` already use. One row per person and Santiago day, keyed
 * `daybook-assistant:<day>:<userId>`; no text is ever stored.
 *
 * Unlike `consumeRateLimit`, this FAILS CLOSED: it is a spending cap, so if the counter cannot be read the message is
 * refused (503) instead of going through uncounted.
 *
 * The reservation is ONE atomic statement: the upsert only adds one while the counter is under the limit, so two
 * simultaneous messages cannot both take the last slot.
 */
import { getDatabase } from '../db';
import type { Database } from '../db/database';

export type Reservation = { allowed: boolean; used: number };

export function quotaKey(day: string, userId: string): string {
  return `daybook-assistant:${day}:${userId}`;
}

export async function reserveMessage(
  userId: string,
  day: string,
  limit: number,
  database: Database = getDatabase(),
  now = Date.now(),
): Promise<Reservation> {
  const key = quotaKey(day, userId);
  const row = await database
    .prepare(
      `INSERT INTO "authRateLimit" (id,key,count,"lastRequest") VALUES ($1,$1,1,$2)
      ON CONFLICT(key) DO UPDATE SET count="authRateLimit".count+1,"lastRequest"=$2
      WHERE "authRateLimit".count < $3 RETURNING count`,
    )
    .bind(key, now, limit)
    .first<{ count: number | string }>();
  // No row back: the WHERE of the update did not hold, the limit is reached.
  if (!row) return { allowed: false, used: limit };
  return { allowed: true, used: Number(row.count) };
}

/** A failure that cost nothing (the API was down, no budget) gives the message back. */
export async function refundMessage(userId: string, day: string, database: Database = getDatabase()): Promise<void> {
  await database
    .prepare(`UPDATE "authRateLimit" SET count=GREATEST(count-1,0) WHERE key=$1`)
    .bind(quotaKey(day, userId))
    .run();
}

export async function readUsed(userId: string, day: string, database: Database = getDatabase()): Promise<number> {
  const row = await database
    .prepare(`SELECT count FROM "authRateLimit" WHERE key=$1`)
    .bind(quotaKey(day, userId))
    .first<{ count: number | string }>();
  return row ? Number(row.count) : 0;
}
