import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Database } from '../db/database';
import { canAccessTicket, requireAdmin, type AccessContext, type MemberRecord } from './access';
import { ApiError } from './server';
import { acquireTicketWorkLock } from './work-lock';
import type { MetricsQuery } from './agent-metrics-model';
import { canSubmitSatisfaction, satisfactionIsEnabled, type SatisfactionReport, type TicketSatisfaction } from './satisfaction-model';
import { productionTicketSql } from './test-data';

interface SatisfactionRow extends Omit<TicketSatisfaction, 'available'> {
  ownerId: string; resolutionKey: string; requesterMemberId: string;
  resolverMemberId: string | null; customerCompanyId: string | null;
}
interface TicketRow { id: number; ownerId: string; requesterMemberId: string | null; customerCompanyId: string | null; status: string }

async function latestResolutionKey(tx: PoolClient, ownerId: string, ticketId: number): Promise<string | null> {
  return (await tx.query<{ id: string }>('SELECT id FROM "ticketSlaOutcomes" WHERE "ownerId"=$1 AND "ticketId"=$2 ORDER BY "resolvedAt" DESC,id DESC LIMIT 1', [ownerId, ticketId])).rows[0]?.id || null;
}

/** Called after the real resolution UPDATE, using its same transaction/outcome id. No historical invitations are inferred. */
export async function createSatisfactionForResolution(tx: PoolClient, database: Database, input: {
  ownerId: string; ticketId: number; resolutionKey: string; resolvedAt: string;
  requesterMemberId: string | null; resolverMemberId: string | null; customerCompanyId: string | null;
}): Promise<string | null> {
  if (!satisfactionIsEnabled(process.env.DAYBOOK_SATISFACTION_ENABLED) || !input.requesterMemberId) return null;
  const ticket = (await tx.query<TicketRow>('SELECT id,"ownerId","requesterMemberId","customerCompanyId",status FROM tickets WHERE id=$1 AND "ownerId"=$2', [input.ticketId, input.ownerId])).rows[0];
  const member = (await tx.query<MemberRecord>('SELECT * FROM members WHERE id=$1 AND "ownerId"=$2 FOR SHARE', [input.requesterMemberId, input.ownerId])).rows[0];
  if (!ticket || ticket.status !== 'resolved' || ticket.requesterMemberId !== input.requesterMemberId || !member?.userId
    || member.role !== 'client' || !canAccessTicket({ ownerId: input.ownerId, role: member.role, member }, ticket)) return null;
  const id = randomUUID();
  const inserted = await tx.query(`INSERT INTO "ticketSatisfaction"
    (id,"ownerId","ticketId","resolutionKey","resolvedAt","requesterMemberId","resolverMemberId","customerCompanyId",score,comment,"submittedAt","createdAt")
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,NULL,NULL,$5) ON CONFLICT ("ownerId","resolutionKey") DO NOTHING RETURNING id`,
  [id, input.ownerId, input.ticketId, input.resolutionKey, input.resolvedAt, input.requesterMemberId, input.resolverMemberId, input.customerCompanyId]);
  if (!inserted.rowCount) return (await tx.query<{ id: string }>('SELECT id FROM "ticketSatisfaction" WHERE "ownerId"=$1 AND "resolutionKey"=$2', [input.ownerId, input.resolutionKey])).rows[0]?.id || null;
  const { notificationStatements } = await import('./mail');
  for (const statement of notificationStatements(database, { ownerId: input.ownerId, event: 'satisfaction_requested',
    eventKey: `satisfaction:${id}`, recipientMemberId: input.requesterMemberId, ticketId: input.ticketId,
    satisfactionId: id, expiresAt: new Date(Date.parse(input.resolvedAt) + 30 * 86400_000).toISOString() })) await database.execute(statement, tx);
  return id;
}

export async function getTicketSatisfaction(tx: PoolClient, access: AccessContext, ticket: TicketRow): Promise<TicketSatisfaction | null> {
  if (!canAccessTicket(access, ticket)) throw new ApiError(404, 'El ticket no existe o no tienes acceso.');
  // Other company contacts can discuss tickets, but cannot inspect or submit another requester's survey.
  if (access.role === 'client' && ticket.requesterMemberId !== access.member.id) return null;
  const key = await latestResolutionKey(tx, access.ownerId, ticket.id);
  if (!key) return null;
  const row = (await tx.query<SatisfactionRow>('SELECT * FROM "ticketSatisfaction" WHERE "ownerId"=$1 AND "ticketId"=$2 AND "resolutionKey"=$3', [access.ownerId, ticket.id, key])).rows[0];
  if (!row || (access.role === 'client' && row.requesterMemberId !== access.member.id)) return null;
  return { id: row.id, ticketId: row.ticketId, resolvedAt: row.resolvedAt, score: row.score, comment: row.comment,
    submittedAt: row.submittedAt, available: satisfactionIsEnabled(process.env.DAYBOOK_SATISFACTION_ENABLED) && canSubmitSatisfaction({ viewerRole: access.role, viewerMemberId: access.member.id,
      requesterMemberId: ticket.requesterMemberId, invitationRequesterId: row.requesterMemberId, status: ticket.status,
      latestResolutionKey: key, resolutionKey: row.resolutionKey, submittedAt: row.submittedAt }) };
}

/** Caller holds the workspace, current membership and ticket locks. */
export async function submitTicketSatisfaction(tx: PoolClient, access: AccessContext, ticket: TicketRow, input: { satisfactionId: string; score: number; comment: string }, now = new Date()): Promise<TicketSatisfaction> {
  if (access.role !== 'client') throw new ApiError(403, 'La evaluación corresponde al cliente solicitante.');
  if (!canAccessTicket(access, ticket)) throw new ApiError(404, 'El ticket no existe o no tienes acceso.');
  if (!satisfactionIsEnabled(process.env.DAYBOOK_SATISFACTION_ENABLED)) throw new ApiError(503, 'Las evaluaciones están en pausa. Tu historial se conserva.');
  const row = (await tx.query<SatisfactionRow>('SELECT * FROM "ticketSatisfaction" WHERE id=$1 AND "ownerId"=$2 AND "ticketId"=$3 FOR UPDATE', [input.satisfactionId, access.ownerId, ticket.id])).rows[0];
  const key = await latestResolutionKey(tx, access.ownerId, ticket.id);
  if (!row || !canSubmitSatisfaction({ viewerRole: access.role, viewerMemberId: access.member.id,
    requesterMemberId: ticket.requesterMemberId, invitationRequesterId: row.requesterMemberId, status: ticket.status,
    latestResolutionKey: key, resolutionKey: row.resolutionKey, submittedAt: row.submittedAt })) throw new ApiError(409, 'La evaluación ya fue enviada o este cierre ya no está vigente.');
  const updated = (await tx.query<SatisfactionRow>('UPDATE "ticketSatisfaction" SET score=$1,comment=$2,"submittedAt"=$3 WHERE id=$4 AND "ownerId"=$5 AND score IS NULL RETURNING *',
    [input.score, input.comment || null, now.toISOString(), row.id, access.ownerId])).rows[0];
  if (!updated) throw new ApiError(409, 'Esta evaluación ya fue enviada.');
  return { id: updated.id, ticketId: updated.ticketId, resolvedAt: updated.resolvedAt, score: updated.score,
    comment: updated.comment, submittedAt: updated.submittedAt, available: false };
}

export async function isSatisfactionEligibleForDelivery(database: Database, input: { ownerId: string; ticketId: number | null; recipientMemberId: string; satisfactionId: string | null }): Promise<boolean> {
  if (!satisfactionIsEnabled(process.env.DAYBOOK_SATISFACTION_ENABLED) || !input.ticketId || !input.satisfactionId) return false;
  return database.transaction(async tx => {
    // Portal writes lock the workspace before membership and ticket rows.
    // Join that order before taking any shared row lock during delivery.
    await acquireTicketWorkLock(tx, input.ownerId);
    const ticket = (await tx.query<TicketRow>('SELECT id,"ownerId","requesterMemberId","customerCompanyId",status FROM tickets WHERE id=$1 AND "ownerId"=$2 FOR SHARE', [input.ticketId, input.ownerId])).rows[0];
    const row = (await tx.query<SatisfactionRow>('SELECT * FROM "ticketSatisfaction" WHERE id=$1 AND "ownerId"=$2 AND "ticketId"=$3', [input.satisfactionId, input.ownerId, input.ticketId])).rows[0];
    const member = (await tx.query<MemberRecord>('SELECT * FROM members WHERE id=$1 AND "ownerId"=$2 FOR SHARE', [input.recipientMemberId, input.ownerId])).rows[0];
    if (!ticket || !row || !member?.userId || member.role !== 'client' || !canAccessTicket({ ownerId: input.ownerId, role: member.role, member }, ticket)) return false;
    return canSubmitSatisfaction({ viewerRole: member.role, viewerMemberId: member.id, requesterMemberId: ticket.requesterMemberId,
      invitationRequesterId: row.requesterMemberId, status: ticket.status, latestResolutionKey: await latestResolutionKey(tx, input.ownerId, ticket.id),
      resolutionKey: row.resolutionKey, submittedAt: row.submittedAt });
  });
}

export async function getSatisfactionReport(tx: PoolClient, access: AccessContext, period: MetricsQuery, agentId: string | null): Promise<SatisfactionReport> {
  requireAdmin(access);
  if (period.companyId && !(await tx.query('SELECT id FROM "customerCompanies" WHERE id=$1 AND "ownerId"=$2 AND "organizationId"=$3', [period.companyId, access.ownerId, access.organizationId])).rowCount) throw new ApiError(400, 'Selecciona una empresa de este espacio.');
  if (agentId && !(await tx.query('SELECT id FROM members WHERE id=$1 AND "ownerId"=$2 AND "organizationId"=$3', [agentId, access.ownerId, access.organizationId])).rowCount) throw new ApiError(400, 'Selecciona un integrante de este equipo.');
  const values = [access.ownerId, period.fromInstant, period.untilInstant, period.companyId, agentId, period.includeTests === true];
  const where = `s."ownerId"=$1 AND s."resolvedAt">=$2 AND s."resolvedAt"<$3
    AND ($6::boolean OR EXISTS (SELECT 1 FROM tickets tested WHERE tested.id=s."ticketId" AND tested."ownerId"=s."ownerId" AND ${productionTicketSql('tested')}))
    AND ($4::text IS NULL OR s."customerCompanyId"=$4) AND ($5::text IS NULL OR s."resolverMemberId"=$5)`;
  const aggregate = `count(*)::int AS invitations,count(s.score)::int AS responses,avg(s.score)::float8 AS "averageScore",
    CASE WHEN count(s.score)>0 THEN 100.0*count(*) FILTER (WHERE s.score>=4)/count(s.score) ELSE NULL END::float8 AS "positivePercent"`;
  const totals = (await tx.query<SatisfactionReport['totals']>(`SELECT ${aggregate} FROM "ticketSatisfaction" s WHERE ${where}`, values)).rows[0];
  const agents = (await tx.query<SatisfactionReport['agents'][number]>(`SELECT s."resolverMemberId" AS id,COALESCE(m.name,'Sin atribución') AS name,${aggregate}
    FROM "ticketSatisfaction" s LEFT JOIN members m ON m.id=s."resolverMemberId" AND m."ownerId"=s."ownerId" WHERE ${where} GROUP BY s."resolverMemberId",m.name ORDER BY name`, values)).rows;
  const companies = (await tx.query<SatisfactionReport['companies'][number]>(`SELECT s."customerCompanyId" AS id,COALESCE(c.name,'Sin empresa') AS name,${aggregate}
    FROM "ticketSatisfaction" s LEFT JOIN "customerCompanies" c ON c.id=s."customerCompanyId" AND c."ownerId"=s."ownerId" WHERE ${where} GROUP BY s."customerCompanyId",c.name ORDER BY name`, values)).rows;
  const recent = (await tx.query<SatisfactionReport['recent'][number]>(`SELECT s.id,s."ticketId",s.score,s.comment,s."submittedAt",COALESCE(m.name,'Sin atribución') AS agent,COALESCE(c.name,'Sin empresa') AS company
    FROM "ticketSatisfaction" s LEFT JOIN members m ON m.id=s."resolverMemberId" AND m."ownerId"=s."ownerId"
    LEFT JOIN "customerCompanies" c ON c.id=s."customerCompanyId" AND c."ownerId"=s."ownerId" WHERE ${where} AND s.score IS NOT NULL ORDER BY s."submittedAt" DESC,s.id DESC LIMIT 50`, values)).rows;
  return { period: { from: period.from, to: period.to, companyId: period.companyId, includeTests: period.includeTests === true }, totals, agents, companies, recent };
}
