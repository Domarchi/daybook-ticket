import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Database } from '../db/database';
import { ApiError } from './server';
import type { AccessContext } from './access';
import { requireAdmin } from './access';
import {
  activeEscalationReasons,
  DEFAULT_ESCALATION_POLICY,
  ESCALATION_LABELS,
  escalationRecipients,
  escalationStageKey,
  type EscalationPolicy,
  type EscalationReason,
} from './escalation-policy';

interface PolicyRow extends Omit<EscalationPolicy, 'recipientMemberIds'> {
  recipientMemberIdsJson: string;
}
interface EscalationTicket {
  id: number;
  ownerId: string;
  status: string;
  dueAt: string;
  assigneeMemberId: string | null;
}
interface Episode {
  cycleMessageId: number;
  unansweredMessageId: number | null;
  unansweredSince: string | null;
}
interface Occurrence {
  id: string;
  activationAt: string;
  cycleMessageId: number;
  unansweredMessageId: number | null;
  reason: EscalationReason;
  recipientMemberId: string;
  assigneeMemberId: string | null;
  dueAtSnapshot: string;
  expiresAt: string;
}

function publicPolicy(row?: PolicyRow | null): EscalationPolicy {
  if (!row) return structuredClone(DEFAULT_ESCALATION_POLICY);
  let ids: unknown = [];
  try {
    ids = JSON.parse(row.recipientMemberIdsJson);
  } catch {
    /* Invalid stored selection is safely empty. */
  }
  return {
    enabled: row.enabled,
    unansweredMinutes: row.unansweredMinutes,
    overdueMinutes: row.overdueMinutes,
    recipientMemberIds: Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [],
    activatedAt: row.activatedAt,
    version: row.version,
  };
}
export async function getEscalationPolicy(tx: PoolClient, ownerId: string): Promise<EscalationPolicy> {
  return publicPolicy(
    (await tx.query<PolicyRow>('SELECT * FROM "escalationSettings" WHERE "ownerId"=$1 FOR SHARE', [ownerId])).rows[0],
  );
}
export async function saveEscalationPolicy(
  tx: PoolClient,
  access: AccessContext,
  input: Omit<EscalationPolicy, 'activatedAt'>,
  now = new Date(),
): Promise<EscalationPolicy> {
  requireAdmin(access);
  const old = publicPolicy(
    (await tx.query<PolicyRow>('SELECT * FROM "escalationSettings" WHERE "ownerId"=$1 FOR UPDATE', [access.ownerId]))
      .rows[0],
  );
  if (input.version !== old.version) throw new ApiError(409, 'La configuración cambió. Actualiza antes de guardar.');
  const ids = [...new Set(input.recipientMemberIds)];
  if (input.enabled && !ids.length)
    throw new ApiError(400, 'Selecciona al menos un encargado para recibir escalaciones.');
  if (ids.length) {
    const active = await tx.query<{ id: string }>(
      `SELECT id FROM members WHERE "ownerId"=$1 AND "organizationId"=$2
      AND id=ANY($3::text[]) AND status='active' AND "userId" IS NOT NULL AND role IN ('owner','admin','agent') FOR SHARE`,
      [access.ownerId, access.organizationId, ids],
    );
    if (active.rowCount !== ids.length) throw new ApiError(400, 'Selecciona solo integrantes activos del equipo.');
  }
  const activatedAt = input.enabled ? (old.enabled ? old.activatedAt : now.toISOString()) : null;
  const result = await tx.query<PolicyRow>(
    `INSERT INTO "escalationSettings"
    ("ownerId",enabled,"unansweredMinutes","overdueMinutes","recipientMemberIdsJson","activatedAt",version,"updatedAt")
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT ("ownerId") DO UPDATE SET
    enabled=EXCLUDED.enabled,"unansweredMinutes"=EXCLUDED."unansweredMinutes","overdueMinutes"=EXCLUDED."overdueMinutes",
    "recipientMemberIdsJson"=EXCLUDED."recipientMemberIdsJson","activatedAt"=EXCLUDED."activatedAt",version=EXCLUDED.version,"updatedAt"=EXCLUDED."updatedAt" RETURNING *`,
    [
      access.ownerId,
      input.enabled,
      input.unansweredMinutes,
      input.overdueMinutes,
      JSON.stringify(ids),
      activatedAt,
      old.version + 1,
      now.toISOString(),
    ],
  );
  return publicPolicy(result.rows[0]);
}

async function episode(tx: PoolClient, ticket: EscalationTicket, cutoff: string): Promise<Episode | null> {
  const result = await tx.query<Episode>(
    `WITH boundary AS (
      SELECT MAX("createdAt") AS at FROM "ticketEvents" WHERE "ownerId"=$1 AND "ticketId"=$2 AND action='status' AND "afterValue"='resolved'
    ), cycle AS (
      SELECT id,"createdAt" FROM messages,boundary WHERE "ownerId"=$1 AND "ticketId"=$2 AND kind<>'note' AND "authorRole"='client'
        AND "createdAt">=$3 AND (boundary.at IS NULL OR "createdAt">boundary.at) ORDER BY "createdAt",id LIMIT 1
    ), staff AS (
      SELECT p.id,p."createdAt" FROM messages p,cycle c WHERE p."ownerId"=$1 AND p."ticketId"=$2 AND p.kind<>'note'
        AND p."authorRole" IN ('owner','admin','agent') AND (p."createdAt",p.id)>(c."createdAt",c.id) ORDER BY p."createdAt" DESC,p.id DESC LIMIT 1
    ) SELECT c.id AS "cycleMessageId",pending.id AS "unansweredMessageId",pending."createdAt" AS "unansweredSince" FROM cycle c LEFT JOIN LATERAL (
      SELECT p.id,p."createdAt" FROM messages p WHERE p."ownerId"=$1 AND p."ticketId"=$2 AND p.kind<>'note' AND p."authorRole"='client'
        AND (p."createdAt",p.id)>=(c."createdAt",c.id) AND NOT EXISTS (SELECT 1 FROM staff s WHERE (p."createdAt",p.id)<=(s."createdAt",s.id))
      ORDER BY p."createdAt",p.id LIMIT 1
    ) pending ON TRUE`,
    [ticket.ownerId, ticket.id, cutoff],
  );
  return result.rows[0] || null;
}
async function recipients(tx: PoolClient, ticket: EscalationTicket, policy: EscalationPolicy): Promise<string[]> {
  const staff = await tx.query<{ id: string; role: string; status: string; userId: string | null }>(
    `SELECT id,role,status,"userId" FROM members WHERE "ownerId"=$1 AND "organizationId"=(SELECT id FROM organizations WHERE "ownerId"=$1)`,
    [ticket.ownerId],
  );
  return escalationRecipients(staff.rows, ticket.assigneeMemberId, policy.recipientMemberIds);
}

/** Separate durable stages leave the existing reminder history and routing intact. */
export async function enqueueTicketEscalation(
  database: Database,
  ownerId: string,
  ticketId: number,
  now = new Date(),
): Promise<number> {
  return database.transaction(async tx => {
    const ticket = (
      await tx.query<EscalationTicket>(
        'SELECT id,"ownerId",status,"dueAt","assigneeMemberId" FROM tickets WHERE id=$1 AND "ownerId"=$2 FOR UPDATE',
        [ticketId, ownerId],
      )
    ).rows[0];
    if (!ticket || !['open', 'pending'].includes(ticket.status)) return 0;
    const policy = await getEscalationPolicy(tx, ownerId);
    if (!policy.enabled || !policy.activatedAt) return 0;
    const clock = await episode(tx, ticket, policy.activatedAt);
    if (!clock) return 0;
    const reasons = activeEscalationReasons({ ...ticket, ...clock }, policy, now);
    if (!reasons.length) return 0;
    const ids = await recipients(tx, ticket, policy);
    const { notificationStatements } = await import('./mail');
    let queued = 0;
    for (const recipientMemberId of ids)
      for (const reason of reasons) {
        const id = randomUUID();
        const stageKey = escalationStageKey({
          activationAt: policy.activatedAt,
          cycleMessageId: clock.cycleMessageId,
          reason,
          unansweredMessageId: clock.unansweredMessageId,
          recipientMemberId,
        });
        const expiresAt = new Date(now.getTime() + 24 * 60 * 60_000).toISOString();
        const inserted = await tx.query(
          `INSERT INTO "escalationOccurrences"
        (id,"ownerId","ticketId","activationAt","cycleMessageId","unansweredMessageId",reason,"recipientMemberId","assigneeMemberId","stageKey","dueAtSnapshot","createdAt","expiresAt")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT ("ownerId","ticketId","stageKey") DO NOTHING RETURNING id`,
          [
            id,
            ownerId,
            ticketId,
            policy.activatedAt,
            clock.cycleMessageId,
            clock.unansweredMessageId,
            reason,
            recipientMemberId,
            ticket.assigneeMemberId,
            stageKey,
            ticket.dueAt,
            now.toISOString(),
            expiresAt,
          ],
        );
        if (!inserted.rowCount) continue;
        for (const statement of notificationStatements(database, {
          ownerId,
          event: 'escalation',
          eventKey: `escalation:${id}`,
          recipientMemberId,
          ticketId,
          escalationId: id,
          expiresAt,
        }))
          await database.execute(statement, tx);
        queued++;
      }
    return queued;
  });
}

export async function isEscalationEligibleForDelivery(
  database: Database,
  input: { ownerId: string; ticketId: number | null; recipientMemberId: string; escalationId: string | null },
  now = new Date(),
): Promise<boolean> {
  if (!input.escalationId || !input.ticketId) return false;
  return database.transaction(async tx => {
    const ticket = (
      await tx.query<EscalationTicket>(
        'SELECT id,"ownerId",status,"dueAt","assigneeMemberId" FROM tickets WHERE id=$1 AND "ownerId"=$2 FOR SHARE',
        [input.ticketId, input.ownerId],
      )
    ).rows[0];
    if (!ticket || !['open', 'pending'].includes(ticket.status)) return false;
    const policy = await getEscalationPolicy(tx, input.ownerId);
    if (!policy.enabled || !policy.activatedAt) return false;
    const occurrence = (
      await tx.query<Occurrence>(
        'SELECT * FROM "escalationOccurrences" WHERE id=$1 AND "ownerId"=$2 AND "ticketId"=$3',
        [input.escalationId, input.ownerId, input.ticketId],
      )
    ).rows[0];
    if (
      !occurrence ||
      occurrence.recipientMemberId !== input.recipientMemberId ||
      occurrence.activationAt !== policy.activatedAt ||
      Date.parse(occurrence.expiresAt) <= now.getTime() ||
      occurrence.assigneeMemberId !== ticket.assigneeMemberId
    )
      return false;
    if (!(await recipients(tx, ticket, policy)).includes(input.recipientMemberId)) return false;
    const current = await episode(tx, ticket, policy.activatedAt);
    if (!current || current.cycleMessageId !== occurrence.cycleMessageId) return false;
    if (occurrence.reason === 'unanswered' && current.unansweredMessageId !== occurrence.unansweredMessageId)
      return false;
    if (occurrence.reason === 'overdue' && occurrence.dueAtSnapshot !== ticket.dueAt) return false;
    return activeEscalationReasons({ ...ticket, ...current }, policy, now).includes(occurrence.reason);
  });
}
export async function getEscalationDeliveryReasons(
  database: Database,
  escalationId: string,
  ownerId: string,
): Promise<string[]> {
  const row = await database
    .prepare('SELECT reason FROM "escalationOccurrences" WHERE id=$1 AND "ownerId"=$2')
    .bind(escalationId, ownerId)
    .first<{ reason: EscalationReason }>();
  return row && ESCALATION_LABELS[row.reason] ? [ESCALATION_LABELS[row.reason]] : [];
}
