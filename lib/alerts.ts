import { ticketAccessSql, type AccessContext } from './access';
import { db } from './server';
import { getNotificationConfig } from './notification-config';
import { encodeAlertCursor, type AlertsQuery, type markAlertsSchema } from './alerts-query';
import type { z } from 'zod';
import type { AlertsPage } from './types';
import type { DatabaseValue } from '../db/database';

const events = "('ticket_created', 'agent_replied', 'client_replied', 'reminder')";

function alertScope(access: AccessContext) {
  const scope = ticketAccessSql(access);
  return {
    sql: `${scope.sql} AND o."recipientMemberId" = $${scope.values.length + 1} AND o.event IN ${events}${access.role === 'client' ? " AND o.event <> 'reminder'" : ''}`,
    values: [...scope.values, access.member.id] as DatabaseValue[],
  };
}

/** One SQL snapshot keeps the page, global badge and mark-all boundary consistent. */
export async function getAlertsPage(access: AccessContext, query: AlertsQuery = { filter: 'all', limit: 20 }): Promise<AlertsPage> {
  const config = await getNotificationConfig(access.ownerId);
  const scope = alertScope(access);
  const values = [...scope.values, config.alertsActivatedAt];
  const cutoff = `$${values.length}`;
  let pageCondition = query.filter === 'unread' ? 'WHERE NOT historical AND "readAt" IS NULL' : 'WHERE TRUE';
  if (query.cursor) {
    values.push(query.cursor.createdAt, query.cursor.id);
    pageCondition += ` AND ("createdAt", id) < ($${values.length - 1}, $${values.length})`;
  }
  values.push(query.limit + 1);
  const result = await db().prepare(`WITH visible AS MATERIALIZED (
      SELECT o.id, o.event, o."ticketId", t.subject, o."createdAt", o."readAt", o."createdAt" < ${cutoff} AS historical
      FROM "mailOutbox" o JOIN tickets t ON t.id = o."ticketId" AND t."ownerId" = o."ownerId"
      WHERE ${scope.sql}
    ), page AS (
      SELECT * FROM visible ${pageCondition} ORDER BY "createdAt" DESC, id DESC LIMIT $${values.length}
    ) SELECT COALESCE((SELECT jsonb_agg(p ORDER BY p."createdAt" DESC, p.id DESC) FROM page p), '[]'::jsonb) AS items,
      (SELECT count(*)::integer FROM visible WHERE NOT historical AND "readAt" IS NULL) AS "unreadCount",
      to_char(statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "snapshotAt"`)
    .bind(...values).first<AlertsPage>();
  if (!result) throw new Error('Could not read alerts.');
  const items = result.items.slice(0, query.limit);
  return { ...result, items, nextCursor: result.items.length > query.limit ? encodeAlertCursor(items[items.length - 1]) : null };
}

export async function markAlertsRead(access: AccessContext, change: z.infer<typeof markAlertsSchema>): Promise<AlertsPage> {
  const config = await getNotificationConfig(access.ownerId);
  const scope = alertScope(access);
  const values = [...scope.values, new Date().toISOString(), config.alertsActivatedAt];
  const readAt = `$${values.length - 1}`, cutoff = `$${values.length}`;
  let selected: string;
  if ('ids' in change) {
    values.push(JSON.stringify([...new Set(change.ids)]));
    selected = `o.id IN (SELECT jsonb_array_elements_text($${values.length}::jsonb))`;
  } else {
    // The UPDATE's MVCC snapshot excludes concurrent, uncommitted arrivals.
    selected = 'TRUE';
  }
  await db().prepare(`UPDATE "mailOutbox" o SET "readAt" = ${readAt}
    FROM tickets t WHERE t.id = o."ticketId" AND t."ownerId" = o."ownerId" AND ${scope.sql}
      AND o."readAt" IS NULL AND o."createdAt" >= ${cutoff} AND ${selected} RETURNING o.id`).bind(...values).run();
  return getAlertsPage(access);
}
