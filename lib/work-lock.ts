import type { PoolClient } from 'pg';

/** One lock order for ticket writes and service configuration, before membership
 * and ticket locks. It serializes load-based assignment without lost updates. */
export async function acquireTicketWorkLock(tx: PoolClient, ownerId: string): Promise<void> {
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`daybook-ticket-work:${ownerId}`]);
}
