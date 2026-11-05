import { ticketAccessSql, type AccessContext } from './access';
import { db } from './server';
import { getNotificationConfig } from './notification-config';
import { encodeAlertCursor, type AlertsQuery, type markAlertsSchema } from './alerts-query';
import type { z } from 'zod';
import type { AlertsPage } from './types';
import type { DatabaseValue } from '../db/database';

const events = "('ticket_created', 'agent_replied', 'client_replied', 'reminder', 'escalation', 'satisfaction_requested')";

function alertScope(access: AccessContext) {
  const scope = ticketAccessSql(access);
  const values: DatabaseValue[] = [...scope.values];
  const bind = (value: DatabaseValue) => { values.push(value); return `$${values.length}`; };
  const member = bind(access.member.id), role = bind(access.role), company = bind(access.member.customerCompanyId ?? null);
  const permission = bind(access.member.companyAccess), organization = bind(access.organizationId), user = bind(access.userId);
  // requireAccess and the alert statement are separate snapshots. Reject an old
  // staff/company context if the membership changed between those two reads.
  const live = `EXISTS (SELECT 1 FROM members live WHERE live.id=${member} AND live."ownerId"=t."ownerId"
    AND live."organizationId"=${organization} AND live."userId"=${user} AND live.status='active' AND live.role=${role}
    AND live."customerCompanyId" IS NOT DISTINCT FROM ${company}::text AND live."companyAccess"=${permission})`;
  return {
    sql: `${scope.sql} AND ${live} AND o."recipientMemberId" = ${member} AND o.event IN ${events}${access.role === 'client' ? " AND o.event NOT IN ('reminder','escalation')" : ''}
      AND (o.event <> 'satisfaction_requested' OR (${access.role === 'client' ? 'TRUE' : 'FALSE'} AND t."requesterMemberId"=o."recipientMemberId" AND EXISTS (SELECT 1 FROM "ticketSatisfaction" s WHERE s.id=o."satisfactionId" AND s."ownerId"=o."ownerId" AND s."requesterMemberId"=o."recipientMemberId")))`,
    values,
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
