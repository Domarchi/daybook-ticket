import type { PoolClient } from 'pg';
import type { Database } from '../db/database';
import { requireStaff, type AccessContext } from './access';
import { ApiError } from './server';
import { lockAccess, lockTicket } from './ticket-mutations';
import { acquireTicketWorkLock } from './work-lock';
import { PRESENCE_MAX_TABS, PRESENCE_TTL_MS, visiblePresence, type PresenceActivity, type PresencePage, type PresenceRow } from './ticket-presence-model';

async function authorized<T>(database: Database, access: AccessContext, ticketId: number,
  work: (tx: PoolClient, fresh: AccessContext) => Promise<T>): Promise<T> {
  requireStaff(access);
  return database.transaction(async tx => {
    await acquireTicketWorkLock(tx, access.ownerId);
    const fresh = requireStaff(await lockAccess(tx, access));
    await lockTicket(tx, fresh, ticketId);
    return work(tx, fresh);
  });
}

async function list(tx: PoolClient, access: AccessContext, ticketId: number, now: Date): Promise<PresencePage> {
  const { rows } = await tx.query<PresenceRow>(`SELECT p."memberId", m.name, p.activity, p."updatedAt", p."expiresAt"
    FROM "ticketPresence" p JOIN members m ON m.id=p."memberId" AND m."ownerId"=p."ownerId"
    WHERE p."ownerId"=$1 AND p."ticketId"=$2 AND p."expiresAt">$3
      AND m."organizationId"=$4 AND m.status='active' AND m."userId" IS NOT NULL
      AND m.role IN ('owner','admin','agent') ORDER BY p."updatedAt" DESC LIMIT 100`,
  [access.ownerId, ticketId, now.toISOString(), access.organizationId]);
  return { people: visiblePresence(rows, access.member.id, now), expiresInMs: PRESENCE_TTL_MS };
}

export async function readTicketPresence(database: Database, access: AccessContext, ticketId: number, now = new Date()): Promise<PresencePage> {
  return authorized(database, access, ticketId, (tx, fresh) => list(tx, fresh, ticketId, now));
}

export async function heartbeatTicketPresence(database: Database, access: AccessContext, ticketId: number,
  input: { tabId: string; activity: PresenceActivity }, now = new Date()): Promise<PresencePage> {
  return authorized(database, access, ticketId, async (tx, fresh) => {
    const timestamp = now.toISOString(), expiresAt = new Date(now.getTime() + PRESENCE_TTL_MS).toISOString();
    // Bounded opportunistic cleanup means no extra cron or infrastructure.
    await tx.query(`DELETE FROM "ticketPresence" WHERE ctid IN (SELECT ctid FROM "ticketPresence"
      WHERE "ownerId"=$1 AND "expiresAt"<=$2 LIMIT 100)`, [fresh.ownerId, timestamp]);
    const total = (await tx.query<{ total: number; known: boolean }>(`SELECT count(DISTINCT "tabId")::int AS total,
      COALESCE(bool_or("tabId"=$3),false) AS known FROM "ticketPresence"
      WHERE "ownerId"=$1 AND "memberId"=$2 AND "expiresAt">$4`,
    [fresh.ownerId, fresh.member.id, input.tabId, timestamp])).rows[0];
    if (!total.known && total.total >= PRESENCE_MAX_TABS) throw new ApiError(429, 'Hay demasiadas pestañas de atención activas.');
    await tx.query(`INSERT INTO "ticketPresence" ("ownerId","ticketId","memberId","tabId",activity,"updatedAt","expiresAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT ("ownerId","ticketId","memberId","tabId")
      DO UPDATE SET activity=EXCLUDED.activity,"updatedAt"=EXCLUDED."updatedAt","expiresAt"=EXCLUDED."expiresAt"`,
    [fresh.ownerId, ticketId, fresh.member.id, input.tabId.toLowerCase(), input.activity, timestamp, expiresAt]);
    return list(tx, fresh, ticketId, now);
  });
}

export async function releaseTicketPresence(database: Database, access: AccessContext, ticketId: number, tabId: string): Promise<void> {
  await authorized(database, access, ticketId, async (tx, fresh) => {
    await tx.query('DELETE FROM "ticketPresence" WHERE "ownerId"=$1 AND "ticketId"=$2 AND "memberId"=$3 AND "tabId"=$4',
      [fresh.ownerId, ticketId, fresh.member.id, tabId.toLowerCase()]);
  });
}
