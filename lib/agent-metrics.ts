import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { AccessContext } from './access';
import { requireAdmin } from './access';
import { ApiError } from './server';
import { METRICS_TIME_ZONE, type AgentMetric, type AgentMetricsReport, type MetricsQuery } from './agent-metrics-model';

export interface SlaOutcomeInput {
  ownerId: string;
  ticketId: number;
  actorMemberId: string | null;
  startedAt: string | null;
  dueAt: string;
  resolvedAt: string;
  customerCompanyId: string | null;
  policySnapshot: string | null;
}

/** Call once inside the same transaction as an actual transition to resolved.
 * The deadline is frozen here; a later priority, company or calendar edit cannot
 * rewrite a completed measurement. Historical resolutions are never backfilled.
 */
export async function recordSlaOutcome(tx: PoolClient, input: SlaOutcomeInput): Promise<string> {
  const resolved = Date.parse(input.resolvedAt), due = Date.parse(input.dueAt);
  const start = input.startedAt ? Date.parse(input.startedAt) : null;
  if (!Number.isFinite(resolved) || !Number.isFinite(due) || (start !== null && (!Number.isFinite(start) || start > resolved))) throw new ApiError(400, 'La medición del plazo no es válida.');
  const saved = await tx.query(`INSERT INTO "ticketSlaOutcomes"
    (id,"ownerId","ticketId","actorMemberId","startedAt","dueAt","resolvedAt","customerCompanyId","policySnapshot")
    SELECT $1,$2,t.id,$4,$5,$6,$7,$8,$9 FROM tickets t WHERE t.id=$3 AND t."ownerId"=$2
      AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM members m WHERE m.id=$4 AND m."ownerId"=$2 AND m.status='active' AND m.role IN ('owner','admin','agent')))
      AND ($8::text IS NULL OR EXISTS (SELECT 1 FROM "customerCompanies" c WHERE c.id=$8 AND c."ownerId"=$2))
    RETURNING id`, [randomUUID(), input.ownerId, input.ticketId, input.actorMemberId, input.startedAt, input.dueAt, input.resolvedAt, input.customerCompanyId, input.policySnapshot]);
  if (saved.rowCount !== 1) throw new ApiError(400, 'No se pudo vincular la medición al ticket y al equipo correctos.');
  return saved.rows[0].id as string;
}

/** Only aggregates leave PostgreSQL. Current workload is deliberately independent
 * of the chosen historical period. Completion metrics use outcome snapshots;
 * response metrics use immutable public-message author roles, never note text.
 */
export async function getAgentMetrics(tx: PoolClient, access: AccessContext, period: MetricsQuery, now = new Date()): Promise<AgentMetricsReport> {
  requireAdmin(access);
  if (period.companyId) {
    const company = await tx.query('SELECT id FROM "customerCompanies" WHERE id=$1 AND "ownerId"=$2 AND "organizationId"=$3 FOR SHARE', [period.companyId, access.ownerId, access.organizationId]);
    if (!company.rowCount) throw new ApiError(400, 'Selecciona una empresa de este espacio.');
  }
  const values = [access.ownerId, access.organizationId, period.fromInstant, period.untilInstant, period.companyId];
  const { rows } = await tx.query<AgentMetric>(`WITH scoped_tickets AS (
      SELECT id,"createdAt","assigneeMemberId",status FROM tickets
      WHERE "ownerId"=$1 AND ($5::text IS NULL OR "customerCompanyId"=$5)
    ), first_replies AS (
      SELECT DISTINCT ON (p."ticketId") p."ticketId",p."authorMemberId",p."authorRole",p."createdAt",t."createdAt" AS "ticketCreatedAt"
      FROM messages p JOIN scoped_tickets t ON t.id=p."ticketId"
      WHERE p."ownerId"=$1 AND p.kind='reply' AND p."authorRole" IS DISTINCT FROM 'client'
        AND p."createdAt">=t."createdAt"
      ORDER BY p."ticketId",p."createdAt",p.id
    ), workload AS (
      SELECT "assigneeMemberId" AS member_id,count(*) FILTER (WHERE status='open')::int AS open,
        count(*) FILTER (WHERE status='pending')::int AS pending
      FROM scoped_tickets WHERE status IN ('open','pending') GROUP BY "assigneeMemberId"
    ), replies AS (
      SELECT p."authorMemberId" AS member_id,count(*)::int AS total FROM messages p JOIN scoped_tickets t ON t.id=p."ticketId"
      WHERE p."ownerId"=$1 AND p.kind='reply' AND p."authorRole" IN ('owner','admin','agent') AND p."authorMemberId" IS NOT NULL
        AND p."createdAt">=$3 AND p."createdAt"<$4 GROUP BY p."authorMemberId"
    ), response AS (
      SELECT "authorMemberId" AS member_id,count(*)::int AS total,
        avg(EXTRACT(EPOCH FROM ("createdAt"::timestamptz-"ticketCreatedAt"::timestamptz))/3600)::float8 AS hours
      FROM first_replies WHERE "authorRole" IN ('owner','admin','agent') AND "authorMemberId" IS NOT NULL
        AND "createdAt">=$3 AND "createdAt"<$4 GROUP BY "authorMemberId"
    ), outcomes AS (
      SELECT o.* FROM "ticketSlaOutcomes" o JOIN tickets t ON t.id=o."ticketId" AND t."ownerId"=o."ownerId"
      WHERE o."ownerId"=$1 AND ($5::text IS NULL OR o."customerCompanyId"=$5) AND o."resolvedAt">=$3 AND o."resolvedAt"<$4
    ), resolution AS (
      SELECT "actorMemberId" AS member_id,count(*)::int AS total,count("startedAt")::int AS measured,
        avg(EXTRACT(EPOCH FROM ("resolvedAt"::timestamptz-"startedAt"::timestamptz))/3600)::float8 AS hours,
        count(*) FILTER (WHERE "resolvedAt"<= "dueAt")::int AS met,
        count(*) FILTER (WHERE "resolvedAt"> "dueAt")::int AS breached
      FROM outcomes GROUP BY "actorMemberId"
    ) SELECT m.id AS "memberId",m.name,m.role,m.status,
      COALESCE(w.open,0)::int AS "currentOpen",COALESCE(w.pending,0)::int AS "currentPending",
      COALESCE(p.total,0)::int AS "publicReplies",COALESCE(f.total,0)::int AS "firstResponseCount",f.hours AS "averageFirstResponseHours",
      COALESCE(r.total,0)::int AS resolutions,COALESCE(r.measured,0)::int AS "measurableResolutions",r.hours AS "averageResolutionHours",
      COALESCE(r.met,0)::int AS "slaMet",COALESCE(r.breached,0)::int AS "slaBreached",
      CASE WHEN r.total>0 THEN 100.0*r.met/r.total ELSE NULL END::float8 AS "slaCompliancePercent"
    FROM members m LEFT JOIN workload w ON w.member_id=m.id LEFT JOIN replies p ON p.member_id=m.id
      LEFT JOIN response f ON f.member_id=m.id LEFT JOIN resolution r ON r.member_id=m.id
    WHERE m."ownerId"=$1 AND m."organizationId"=$2
      AND (m.role IN ('owner','admin','agent') OR p.total>0 OR f.total>0 OR r.total>0)
    ORDER BY m.name COLLATE "C",m.id`, values);
  const coverage = (await tx.query<AgentMetricsReport['coverage']>(`WITH scoped AS (
      SELECT id,"createdAt",status FROM tickets WHERE "ownerId"=$1 AND ($5::text IS NULL OR "customerCompanyId"=$5)
        AND EXISTS (SELECT 1 FROM organizations WHERE "ownerId"=$1 AND id=$2)
    ), first_replies AS (
      SELECT DISTINCT ON (p."ticketId") p."ticketId",p."authorMemberId",p."authorRole",p."createdAt"
      FROM messages p JOIN scoped t ON t.id=p."ticketId" WHERE p."ownerId"=$1 AND p.kind='reply'
        AND p."authorRole" IS DISTINCT FROM 'client' AND p."createdAt">=t."createdAt"
      ORDER BY p."ticketId",p."createdAt",p.id
    ) SELECT
      (SELECT count(*)::int FROM messages p JOIN scoped t ON t.id=p."ticketId" WHERE p."ownerId"=$1 AND p.kind='reply'
        AND (COALESCE(p."authorRole",'') NOT IN ('client','owner','admin','agent') OR (p."authorRole" IN ('owner','admin','agent') AND p."authorMemberId" IS NULL)) AND p."createdAt">=$3 AND p."createdAt"<$4) AS "unknownPublicReplies",
      (SELECT count(*)::int FROM first_replies WHERE (COALESCE("authorRole",'') NOT IN ('owner','admin','agent') OR "authorMemberId" IS NULL) AND "createdAt">=$3 AND "createdAt"<$4) AS "unknownFirstResponseTickets",
      (SELECT count(*)::int FROM "ticketSlaOutcomes" o WHERE o."ownerId"=$1 AND o."actorMemberId" IS NULL
        AND ($5::text IS NULL OR o."customerCompanyId"=$5) AND o."resolvedAt">=$3 AND o."resolvedAt"<$4) AS "unattributedResolutions",
      (SELECT count(*)::int FROM scoped t WHERE t.status='resolved' AND NOT EXISTS (SELECT 1 FROM "ticketSlaOutcomes" o WHERE o."ticketId"=t.id AND o."ownerId"=$1)) AS "historicalResolvedWithoutMeasurement"`, values)).rows[0];
  return { period: { ...period, timeZone: METRICS_TIME_ZONE }, generatedAt: now.toISOString(), agents: rows, coverage };
}
