import { activeWorkspaceOwners } from './workspaces';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getDatabase } from '../db';
import type { Database } from '../db/database';
import { enqueueTicketEscalation } from './escalations';
import {
  activeReminderReasons,
  nextReminderReasons,
  parseReminderReasons,
  reminderRecipients,
  REMINDER_GRACE_MS,
  REMINDER_REASON_LABELS,
  type ReminderClock,
  type ReminderHistory,
} from './reminders-policy';

interface TicketRow extends ReminderClock {
  id: number;
  ownerId: string;
  assigneeMemberId: string | null;
}
interface Episode {
  cycleMessageId: number;
  unansweredMessageId: number | null;
  unansweredSince: string | null;
}
interface Activation {
  remindersEnabled: boolean;
  remindersActivatedAt: string | null;
}
interface Occurrence {
  id: string;
  ownerId: string;
  ticketId: number;
  cycleMessageId: number;
  unansweredMessageId: number | null;
  activationAt: string;
  reasonsJson: string;
  recipientMemberIdsJson: string;
  expiresAt: string;
  dueAtSnapshot: string;
}
export interface ReminderHealth {
  lastStartedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  lastErrorCode: string | null;
  lastInvocationId: string | null;
  cursorTicketId: number;
  leaseUntil: string | null;
  configured: boolean;
  stale: boolean;
}

function configuredIds(data: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(data || '{}');
    const ids = (parsed as { notificationMemberIds?: unknown })?.notificationMemberIds;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

async function activation(tx: PoolClient, ownerId: string): Promise<Activation | null> {
  return (
    (
      await tx.query<Activation>(
        'SELECT "remindersEnabled","remindersActivatedAt" FROM "notificationSettings" WHERE "ownerId"=$1 FOR SHARE',
        [ownerId],
      )
    ).rows[0] || null
  );
}

/** Uses immutable authorRole; notes and imported messages with unknown authors cannot start/close a clock. */
async function episode(
  tx: PoolClient,
  ticket: Pick<TicketRow, 'id' | 'ownerId'>,
  cutoff: string,
): Promise<Episode | null> {
  const result = await tx.query<Episode>(
    `WITH boundary AS (
    SELECT MAX("createdAt") AS at FROM "ticketEvents"
      WHERE "ownerId"=$1 AND "ticketId"=$2 AND action='status' AND "afterValue"='resolved'
  ), cycle AS (
    SELECT id,"createdAt" FROM messages,boundary WHERE "ownerId"=$1 AND "ticketId"=$2
      AND kind<>'note' AND "authorRole"='client' AND "createdAt">=$3
      AND (boundary.at IS NULL OR "createdAt">boundary.at)
    ORDER BY "createdAt",id LIMIT 1
  ), staff AS (
    SELECT p.id,p."createdAt" FROM messages p,cycle c WHERE p."ownerId"=$1 AND p."ticketId"=$2
      AND p.kind<>'note' AND p."authorRole" IN ('owner','admin','agent')
      AND (p."createdAt",p.id)>(c."createdAt",c.id) ORDER BY p."createdAt" DESC,p.id DESC LIMIT 1
  ) SELECT c.id AS "cycleMessageId",pending.id AS "unansweredMessageId",pending."createdAt" AS "unansweredSince"
    FROM cycle c LEFT JOIN LATERAL (
      SELECT p.id,p."createdAt" FROM messages p WHERE p."ownerId"=$1 AND p."ticketId"=$2
        AND p.kind<>'note' AND p."authorRole"='client' AND (p."createdAt",p.id)>=(c."createdAt",c.id)
        AND NOT EXISTS (SELECT 1 FROM staff s WHERE (p."createdAt",p.id)<=(s."createdAt",s.id))
      ORDER BY p."createdAt",p.id LIMIT 1
    ) pending ON TRUE`,
    [ticket.ownerId, ticket.id, cutoff],
  );
  return result.rows[0] || null;
}

async function recipients(tx: PoolClient, ticket: Pick<TicketRow, 'ownerId' | 'assigneeMemberId'>): Promise<string[]> {
  const staff = await tx.query<{ id: string; role: string; status: string; userId: string | null }>(
    `SELECT id,role,status,"userId" FROM members WHERE "ownerId"=$1 AND "organizationId"=(SELECT id FROM organizations WHERE "ownerId"=$1)`,
    [ticket.ownerId],
  );
  const settings = await tx.query<{ data: string }>('SELECT data FROM settings WHERE "ownerId"=$1', [ticket.ownerId]);
  return reminderRecipients(staff.rows, ticket.assigneeMemberId, configuredIds(settings.rows[0]?.data));
}

/** One ticket lock serializes the grouped occurrence and all recipient outbox writes. */
export async function enqueueTicketReminder(
  database: Database,
  ownerId: string,
  ticketId: number,
  now = new Date(),
): Promise<number> {
  return database.transaction(async tx => {
    // Same lock order as ticket writes: ticket first, then configuration/members.
    const ticket = (
      await tx.query<TicketRow>(
        'SELECT id,"ownerId",status,"dueAt","assigneeMemberId" FROM tickets WHERE id=$1 AND "ownerId"=$2 FOR UPDATE',
        [ticketId, ownerId],
      )
    ).rows[0];
    if (!ticket || ticket.status === 'resolved') return 0;
    const config = await activation(tx, ownerId);
    if (!config?.remindersEnabled || !config.remindersActivatedAt) return 0;
    const clock = await episode(tx, ticket, config.remindersActivatedAt);
    if (!clock) return 0; // Historical tickets need a new client intervention after activation.
    const recipientIds = await recipients(tx, ticket);
    if (!recipientIds.length) return 0;
    const scope = [ownerId, ticketId, config.remindersActivatedAt, clock.cycleMessageId];
    let sequence = (
      await tx.query<{ sequence: number }>(
        `SELECT COALESCE(MAX(sequence),0)::integer AS sequence
      FROM "reminderOccurrences" WHERE "ownerId"=$1 AND "ticketId"=$2 AND "activationAt"=$3 AND "cycleMessageId"=$4`,
        scope,
      )
    ).rows[0].sequence;
    const groups = new Map<string, string[]>();
    for (const recipientId of recipientIds) {
      const history = (
        await tx.query<ReminderHistory>(
          `SELECT
        COALESCE(bool_or("reasonsJson"::jsonb ? 'unanswered' AND "unansweredMessageId"=$5),false) AS "unansweredSent",
        COALESCE(bool_or("reasonsJson"::jsonb ? 'due_soon'),false) AS "dueSoonSent",
        COALESCE(bool_or("reasonsJson"::jsonb ? 'overdue'),false) AS "overdueSent", MAX("createdAt") AS "lastEnqueuedAt"
        FROM "reminderOccurrences" WHERE "ownerId"=$1 AND "ticketId"=$2 AND "activationAt"=$3 AND "cycleMessageId"=$4
          AND "recipientMemberIdsJson"::jsonb ? $6`,
          [...scope, clock.unansweredMessageId, recipientId],
        )
      ).rows[0];
      const reasons = nextReminderReasons({ ...ticket, ...clock }, history, now);
      if (!reasons.length) continue;
      const key = JSON.stringify(reasons);
      groups.set(key, [...(groups.get(key) || []), recipientId]);
    }
    if (!groups.size) return 0;
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + REMINDER_GRACE_MS).toISOString();
    const { notificationStatements } = await import('./mail');
    let queued = 0;
    for (const [reasonsJson, groupRecipients] of groups) {
      const id = randomUUID();
      await tx.query(
        `INSERT INTO "reminderOccurrences" (id,"ownerId","ticketId","cycleMessageId","unansweredMessageId","activationAt",sequence,"reasonsJson","recipientMemberIdsJson","dueAtSnapshot","createdAt","expiresAt")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          id,
          ownerId,
          ticketId,
          clock.cycleMessageId,
          clock.unansweredMessageId,
          config.remindersActivatedAt,
          ++sequence,
          reasonsJson,
          JSON.stringify(groupRecipients),
          ticket.dueAt,
          createdAt,
          expiresAt,
        ],
      );
      for (const recipientMemberId of groupRecipients) {
        for (const statement of notificationStatements(database, {
          ownerId,
          event: 'reminder',
          eventKey: `reminder:${id}`,
          recipientMemberId,
          ticketId,
          reminderId: id,
          expiresAt,
        }))
          await database.execute(statement, tx);
        queued++;
      }
    }
    return queued;
  });
}

/** Must be called again immediately before dispatch, including retries of frozen payloads. */
export async function isReminderEligibleForDelivery(
  database: Database,
  input: {
    ownerId: string;
    ticketId: number | null;
    recipientMemberId: string;
    reminderId: string | null;
  },
  now = new Date(),
): Promise<boolean> {
  if (!input.reminderId || !input.ticketId) return false;
  return database.transaction(async tx => {
    const ticket = (
      await tx.query<TicketRow>(
        'SELECT id,"ownerId",status,"dueAt","assigneeMemberId" FROM tickets WHERE id=$1 AND "ownerId"=$2 FOR SHARE',
        [input.ticketId, input.ownerId],
      )
    ).rows[0];
    if (!ticket || ticket.status === 'resolved') return false;
    const config = await activation(tx, input.ownerId);
    if (!config?.remindersEnabled || !config.remindersActivatedAt) return false;
    const occurrence = (
      await tx.query<Occurrence>('SELECT * FROM "reminderOccurrences" WHERE id=$1 AND "ownerId"=$2 AND "ticketId"=$3', [
        input.reminderId,
        input.ownerId,
        input.ticketId,
      ])
    ).rows[0];
    if (
      !occurrence ||
      occurrence.activationAt !== config.remindersActivatedAt ||
      now.getTime() >= Date.parse(occurrence.expiresAt)
    )
      return false;
    let intended: unknown;
    try {
      intended = JSON.parse(occurrence.recipientMemberIdsJson);
    } catch {
      return false;
    }
    if (!Array.isArray(intended) || !intended.includes(input.recipientMemberId)) return false;
    if (!(await recipients(tx, ticket)).includes(input.recipientMemberId)) return false;
    const current = await episode(tx, ticket, config.remindersActivatedAt);
    if (!current || current.cycleMessageId !== occurrence.cycleMessageId) return false;
    const original = parseReminderReasons(occurrence.reasonsJson);
    const active = activeReminderReasons({ ...ticket, ...current }, now);
    // Frozen emails may mention several reasons; cancel if any has become stale.
    return (
      original.length > 0 &&
      original.every(
        reason =>
          active.includes(reason) &&
          (reason === 'unanswered' || occurrence.dueAtSnapshot === ticket.dueAt) &&
          (reason !== 'unanswered' || current.unansweredMessageId === occurrence.unansweredMessageId),
      )
    );
  });
}

export async function getReminderDeliveryReasons(
  database: Database,
  reminderId: string,
  ownerId: string,
): Promise<string[]> {
  const row = await database
    .prepare('SELECT "reasonsJson" FROM "reminderOccurrences" WHERE id=$1 AND "ownerId"=$2')
    .bind(reminderId, ownerId)
    .first<{ reasonsJson: string }>();
  return row ? parseReminderReasons(row.reasonsJson).map(reason => REMINDER_REASON_LABELS[reason]) : [];
}

export async function getReminderHealth(ownerId: string, database = getDatabase()): Promise<ReminderHealth> {
  const row = await database
    .prepare(
      `SELECT "lastStartedAt","lastSucceededAt","lastFailedAt","lastErrorCode","lastInvocationId","cursorTicketId","leaseUntil"
    FROM "notificationJobHealth" WHERE "ownerId"=$1`,
    )
    .bind(ownerId)
    .first<ReminderHealth>();
  const configured =
    process.env.DAYBOOK_NOTIFICATION_JOB_ENABLED === 'true' &&
    (process.env.DAYBOOK_NOTIFICATION_JOB_SECRET?.length || 0) >= 32;
  return {
    lastStartedAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
    lastErrorCode: null,
    lastInvocationId: null,
    cursorTicketId: 0,
    leaseUntil: null,
    ...row,
    configured,
    stale: !row?.lastSucceededAt || Date.now() - Date.parse(row.lastSucceededAt) > 65 * 60_000,
  };
}

export interface ReminderTickResult {
  processed: number;
  queued: number;
  skipped: boolean;
  incomplete: boolean;
}

/** Bounded, leased and resumable. Each workspace owns its cursor, lease and recipients. */
async function runWorkspaceNotificationTick(
  invocationId: string,
  options: { ownerId: string; database?: Database; maxTickets?: number; maxDurationMs?: number; now?: () => Date },
): Promise<ReminderTickResult> {
  const database = options.database || getDatabase();
  const clock = options.now || (() => new Date());
  const started = clock();
  const deadline = started.getTime() + Math.min(45_000, Math.max(100, options.maxDurationMs ?? 20_000));
  const maxTickets = Math.min(500, Math.max(1, Math.floor(options.maxTickets || 100)));
  const ownerId = options.ownerId;
  const token = randomUUID();
  const claimed = await database.transaction(async tx => {
    await tx.query('INSERT INTO "notificationJobHealth" ("ownerId") VALUES ($1) ON CONFLICT ("ownerId") DO NOTHING', [
      ownerId,
    ]);
    return (
      (
        await tx.query<{ cursorTicketId: number }>(
          `UPDATE "notificationJobHealth" SET "leaseToken"=$2,"leaseUntil"=$3,"lastStartedAt"=$4,"lastInvocationId"=$5
      WHERE "ownerId"=$1 AND ("leaseUntil" IS NULL OR "leaseUntil"<=$4) RETURNING "cursorTicketId"`,
          [ownerId, token, new Date(started.getTime() + 120_000).toISOString(), started.toISOString(), invocationId],
        )
      ).rows[0] || null
    );
  });
  if (!claimed) return { processed: 0, queued: 0, skipped: true, incomplete: false };
  let processed = 0;
  let queued = 0;
  let cursor = claimed.cursorTicketId;
  let incomplete = false;
  try {
    let ids = (
      await database
        .prepare(`SELECT id FROM tickets WHERE "ownerId"=$1 AND status<>'resolved' AND id>$2 ORDER BY id LIMIT $3`)
        .bind(ownerId, cursor, maxTickets + 1)
        .all<{ id: number }>()
    ).results;
    if (!ids.length && cursor) {
      cursor = 0;
      ids = (
        await database
          .prepare(`SELECT id FROM tickets WHERE "ownerId"=$1 AND status<>'resolved' ORDER BY id LIMIT $2`)
          .bind(ownerId, maxTickets + 1)
          .all<{ id: number }>()
      ).results;
    }
    for (const { id } of ids.slice(0, maxTickets)) {
      if (clock().getTime() >= deadline - 2000) {
        incomplete = true;
        break;
      }
      queued += await enqueueTicketReminder(database, ownerId, id, clock());
      queued += await enqueueTicketEscalation(database, ownerId, id, clock());
      processed++;
      cursor = id;
      await database
        .prepare('UPDATE "notificationJobHealth" SET "cursorTicketId"=$3 WHERE "ownerId"=$1 AND "leaseToken"=$2')
        .bind(ownerId, token, cursor)
        .run();
    }
    incomplete ||= ids.length > maxTickets;
    if (!incomplete) cursor = 0;
    // Reuse the existing bounded, rate-limit-aware outbox; do not invent another mail sender.
    const remaining = deadline - clock().getTime();
    if (remaining > 1000) {
      const { drainOutbox } = await import('./mail');
      await drainOutbox(ownerId, { maxMessages: 50, maxDurationMs: remaining });
    }
    await database
      .prepare(
        `UPDATE "notificationJobHealth" SET "lastSucceededAt"=$3,"lastErrorCode"=NULL,"cursorTicketId"=$4,"leaseToken"=NULL,"leaseUntil"=NULL WHERE "ownerId"=$1 AND "leaseToken"=$2`,
      )
      .bind(ownerId, token, clock().toISOString(), cursor)
      .run();
    return { processed, queued, skipped: false, incomplete };
  } catch (error) {
    await database
      .prepare(
        `UPDATE "notificationJobHealth" SET "lastFailedAt"=$3,"lastErrorCode"='tick_failed',"leaseToken"=NULL,"leaseUntil"=NULL WHERE "ownerId"=$1 AND "leaseToken"=$2`,
      )
      .bind(ownerId, token, clock().toISOString())
      .run()
      .catch(() => undefined);
    throw error;
  }
}

/** Bounded fair multiplexing; every space retains independent transactional leases and health. */
export async function runNotificationTick(
  invocationId: string,
  options: { database?: Database; maxTickets?: number; maxDurationMs?: number; now?: () => Date } = {},
): Promise<ReminderTickResult> {
  const database = options.database || getDatabase(),
    deadline = Date.now() + Math.min(45000, options.maxDurationMs ?? 40000),
    owners = await activeWorkspaceOwners(database);
  const summary = { processed: 0, queued: 0, skipped: owners.length === 0, incomplete: false };
  for (const [index, owner] of owners.entries()) {
    if (Date.now() > deadline - 1000) {
      summary.incomplete = true;
      break;
    }
    try {
      const result = await runWorkspaceNotificationTick(invocationId, {
        ...options,
        database,
        ownerId: owner.ownerId,
        maxTickets: Math.max(1, Math.floor((options.maxTickets ?? 100) / owners.length)),
        maxDurationMs: Math.max(1000, Math.floor((deadline - Date.now()) / (owners.length - index))),
      });
      summary.processed += result.processed;
      summary.queued += result.queued;
      summary.incomplete ||= result.incomplete;
    } catch {
      summary.incomplete = true;
    }
    await database
      .prepare('UPDATE "workspaceProfiles" SET "lastJobAt"=$1 WHERE "ownerId"=$2')
      .bind(new Date().toISOString(), owner.ownerId)
      .run();
  }
  return summary;
}
