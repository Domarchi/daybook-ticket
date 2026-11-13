import type { PoolClient } from 'pg';
import { requireStaff, ticketAccessSql, type AccessContext } from './access';
import {
  DELAY_REASONS,
  delayReasonLabel,
  delayProblem,
  deliveryNeedsAsset,
  deliveryProblem,
  expectedDateProblem,
  receiptProblem,
  ticketStatusAfter,
  isFinalStage,
  isFulfillmentStage,
  isOverdue,
  stageChangeProblem,
  todayIn,
  type FulfillmentStage,
} from './fulfillment-model';
import { DEFAULT_SERVICE_TIME_ZONE } from './sla-policy';
import { lockAccess, patchTicketInTransaction, recordEvent } from './ticket-mutations';
import { normalizeAssetTag } from './asset-tag';
import { assignInviteEquipment } from './client-equipment';
import { EQUIPMENT_KINDS, type InviteEquipment } from './client-equipment-model';
import { ApiError, db, getTicket } from './server';
import { acquireTicketWorkLock } from './work-lock';

/** Follow-up of a requirement (F6-B2). Rules live in lib/fulfillment-model.ts; this file only reads and writes. */
export const FULFILLMENT_EVENT_ACTIONS = [
  'fulfillment',
  'fulfillment_delay',
  'fulfillment_date',
  'fulfillment_receipt',
] as const;
export type FulfillmentEventAction = (typeof FULFILLMENT_EVENT_ACTIONS)[number];

export type FulfillmentRow = {
  ticketId: number;
  stage: FulfillmentStage;
  expectedOn: string | null;
  delayReason: string | null;
  delayNote: string | null;
  delayedAt: string | null;
  deliveredAt: string | null;
  receivedAt: string | null;
  cancelReason: string | null;
  cancelledFrom: FulfillmentStage | null;
  assetId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type FulfillmentEvent = {
  id: string;
  action: FulfillmentEventAction;
  actorName: string;
  afterValue: string | null;
  createdAt: string;
};
export type FulfillmentView = {
  fulfillment: (FulfillmentRow & { overdue: boolean }) | null;
  /** The ticket names a requirement, so the team can start following it. */
  canStart: boolean;
  /** What is asked for: delivering equipment asks for its inventory ID. */
  requirement: string | null;
  /** The inventory ID of the equipment that was delivered, if any. */
  deliveredAssetTag: string | null;
  /** The person who asked can confirm the receipt now. */
  canConfirmReceipt: boolean;
  events: FulfillmentEvent[];
  today: string;
};
export type FulfillmentListItem = {
  ticketId: number;
  subject: string;
  requesterName: string;
  requirement: string | null;
  stage: FulfillmentStage;
  expectedOn: string | null;
  delayReason: string | null;
  createdAt: string;
  deliveredAt: string | null;
  updatedAt: string;
  overdue: boolean;
};
export const FULFILLMENT_LIST_FILTERS = [
  'active',
  'requested',
  'in_progress',
  'ready',
  'overdue',
  'closed',
  'all',
] as const;
/** The figures above the list (F6-B4): over every followed requirement of the workspace. */
export type FulfillmentSummary = {
  delivered: number;
  /** Mean days from "Solicitado" to "Entregado", one decimal; null until something was delivered. */
  averageDeliveryDays: number | null;
  /** Late share of the open ones, 0–100; null when nothing is open. */
  overduePercent: number | null;
  topDelayReasons: { reason: string; label: string; count: number }[];
};
/** Pure, so the figures are tested without a database. */
export function summarizeFulfillments(
  items: Pick<FulfillmentListItem, 'stage' | 'overdue' | 'createdAt' | 'deliveredAt'>[],
  delayReasons: string[],
): FulfillmentSummary {
  const delivered = items.filter(item => item.stage === 'delivered' && item.deliveredAt);
  const days = delivered.map(item => (Date.parse(item.deliveredAt!) - Date.parse(item.createdAt)) / 86_400_000);
  const open = items.filter(item => !isFinalStage(item.stage));
  const counts = new Map<string, number>();
  for (const reason of delayReasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return {
    delivered: delivered.length,
    averageDeliveryDays: days.length
      ? Math.round((days.reduce((sum, value) => sum + value, 0) / days.length) * 10) / 10
      : null,
    overduePercent: open.length ? Math.round((open.filter(item => item.overdue).length / open.length) * 100) : null,
    topDelayReasons: [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([reason, count]) => ({ reason, label: delayReasonLabel(reason), count })),
  };
}
export type FulfillmentListFilter = (typeof FULFILLMENT_LIST_FILTERS)[number];
export function isFulfillmentListFilter(value: unknown): value is FulfillmentListFilter {
  return typeof value === 'string' && (FULFILLMENT_LIST_FILTERS as readonly string[]).includes(value);
}

const COLUMNS = `"ticketId", stage, "expectedOn", "delayReason", "delayNote", "delayedAt", "deliveredAt", "receivedAt",
  "cancelReason", "cancelledFrom", "assetId", version, "createdAt", "updatedAt"`;
export const today = (now = new Date()) => todayIn(DEFAULT_SERVICE_TIME_ZONE, now);

/** What the ticket screen shows: the follow-up (if any), whether it can start, and its history. */
export async function readFulfillment(access: AccessContext, ticketId: number): Promise<FulfillmentView> {
  const ticket = await getTicket(access, ticketId);
  const database = db(),
    day = today();
  const row = await database
    .prepare(`SELECT ${COLUMNS} FROM "ticketFulfillment" WHERE "ticketId"=$1 AND "ownerId"=$2`)
    .bind(ticketId, access.ownerId)
    .first<FulfillmentRow>();
  const events = (
    await database
      .prepare(
        `SELECT id, action, "actorName", "afterValue", "createdAt" FROM "ticketEvents"
          WHERE "ownerId"=$1 AND "ticketId"=$2 AND action IN (${FULFILLMENT_EVENT_ACTIONS.map(action => `'${action}'`).join(',')})
          ORDER BY "createdAt", id`,
      )
      .bind(access.ownerId, ticketId)
      .all<FulfillmentEvent>()
  ).results;
  const requirement = (ticket as { requirement?: string | null }).requirement ?? null;
  const deliveredAssetTag = row?.assetId
    ? ((
        await database
          .prepare('SELECT "assetTag" FROM "customerAssets" WHERE id=$1 AND "ownerId"=$2')
          .bind(row.assetId, access.ownerId)
          .first<{ assetTag: string | null }>()
      )?.assetTag ?? null)
    : null;
  return {
    fulfillment: row ? { ...row, overdue: isOverdue(row, day) } : null,
    canStart: !row && Boolean(requirement) && ticket.status === 'open',
    requirement,
    deliveredAssetTag,
    canConfirmReceipt: Boolean(row && ticket.requesterMemberId === access.member.id && !receiptProblem(row)),
    events,
    today: day,
  };
}

async function inTicketTransaction<T>(
  access: AccessContext,
  ticketId: number,
  work: (tx: PoolClient, fresh: AccessContext, row: FulfillmentRow | undefined) => Promise<T>,
): Promise<T> {
  requireStaff(access);
  await getTicket(access, ticketId);
  return db().transaction(async tx => {
    await acquireTicketWorkLock(tx, access.ownerId);
    const fresh = requireStaff(await lockAccess(tx, access));
    const row = (
      await tx.query<FulfillmentRow>(
        `SELECT ${COLUMNS} FROM "ticketFulfillment" WHERE "ticketId"=$1 AND "ownerId"=$2 FOR UPDATE`,
        [ticketId, fresh.ownerId],
      )
    ).rows[0];
    return work(tx, fresh, row);
  });
}
function checkVersion(row: FulfillmentRow | undefined, expectedVersion: number): FulfillmentRow {
  if (!row) throw new ApiError(404, 'Este ticket todavía no tiene seguimiento de requerimiento.');
  if (Number(row.version) !== expectedVersion)
    throw new ApiError(
      409,
      'Alguien actualizó este seguimiento hace un momento. Recarga el ticket y vuelve a intentarlo.',
    );
  return row;
}

/** "Seguir como requerimiento": starts the follow-up in "Solicitado", optionally with a committed date. */
export async function startFulfillment(access: AccessContext, ticketId: number, input: { expectedOn?: string | null }) {
  const day = today();
  const dateProblem = expectedDateProblem(input.expectedOn, day);
  if (dateProblem) throw new ApiError(400, dateProblem);
  return inTicketTransaction(access, ticketId, async (tx, fresh, existing) => {
    if (existing) throw new ApiError(409, 'Este ticket ya tiene seguimiento de requerimiento.');
    const ticket = (
      await tx.query<{ requirement: string | null; status: string }>(
        'SELECT requirement, status FROM tickets WHERE id=$1 AND "ownerId"=$2 FOR UPDATE',
        [ticketId, fresh.ownerId],
      )
    ).rows[0];
    if (!ticket) throw new ApiError(404, 'El ticket no existe o no tienes acceso.');
    if (!ticket.requirement)
      throw new ApiError(400, 'Indica primero qué se está pidiendo en «Clasificación» (Requerimiento).');
    if (ticket.status !== 'open') throw new ApiError(400, 'Solo se sigue un requerimiento en un ticket abierto.');
    const now = new Date().toISOString(),
      expectedOn = input.expectedOn || null;
    const row = (
      await tx.query<FulfillmentRow>(
        `INSERT INTO "ticketFulfillment" ("ticketId","ownerId",stage,"expectedOn","createdAt","updatedAt")
         VALUES ($1,$2,'requested',$3,$4,$4) RETURNING ${COLUMNS}`,
        [ticketId, fresh.ownerId, expectedOn, now],
      )
    ).rows[0];
    await recordEvent(tx, fresh, ticketId, 'fulfillment', null, { stage: 'requested', expectedOn });
    return { ...row, overdue: false };
  });
}

/** Moves the follow-up to another stage. Delivering has its own action (it records the equipment, F6-B4). */
export async function changeFulfillmentStage(
  access: AccessContext,
  ticketId: number,
  input: { expectedVersion: number; stage: string; reason?: string | null },
) {
  if (!isFulfillmentStage(input.stage)) throw new ApiError(400, 'Elige una etapa válida.');
  const to = input.stage;
  if (to === 'delivered') throw new ApiError(400, 'La entrega se registra con «Marcar entregado».');
  return inTicketTransaction(access, ticketId, async (tx, fresh, existing) => {
    const row = checkVersion(existing, input.expectedVersion);
    const problem = stageChangeProblem(row.stage, to, input.reason);
    if (problem) throw new ApiError(400, problem);
    const reason = (input.reason ?? '').trim() || null,
      now = new Date().toISOString();
    const updated = (
      await tx.query<FulfillmentRow>(
        `UPDATE "ticketFulfillment" SET stage=$3, "cancelReason"=$4, "cancelledFrom"=$5, version=version+1, "updatedAt"=$6
          WHERE "ticketId"=$1 AND "ownerId"=$2 RETURNING ${COLUMNS}`,
        [
          ticketId,
          fresh.ownerId,
          to,
          to === 'cancelled' ? reason : row.cancelReason,
          to === 'cancelled' ? row.stage : row.cancelledFrom,
          now,
        ],
      )
    ).rows[0];
    await recordEvent(tx, fresh, ticketId, 'fulfillment', { stage: row.stage }, { stage: to, reason });
    return { ...updated, overdue: isOverdue(updated, today()) };
  });
}

/** "Informar retraso": reason, optional note and the new committed date. The person who asked sees all three. */
export async function reportFulfillmentDelay(
  access: AccessContext,
  ticketId: number,
  input: { expectedVersion: number; reason: string; note?: string | null; newExpectedOn: string },
) {
  return inTicketTransaction(access, ticketId, async (tx, fresh, existing) => {
    const row = checkVersion(existing, input.expectedVersion),
      day = today();
    const problem = delayProblem(row.stage, input, day);
    if (problem) throw new ApiError(400, problem);
    const note = (input.note ?? '').trim() || null,
      now = new Date().toISOString();
    const updated = (
      await tx.query<FulfillmentRow>(
        `UPDATE "ticketFulfillment" SET "delayReason"=$3, "delayNote"=$4, "delayedAt"=$5, "expectedOn"=$6,
                version=version+1, "updatedAt"=$5
          WHERE "ticketId"=$1 AND "ownerId"=$2 RETURNING ${COLUMNS}`,
        [ticketId, fresh.ownerId, input.reason, note, now, input.newExpectedOn],
      )
    ).rows[0];
    await recordEvent(
      tx,
      fresh,
      ticketId,
      'fulfillment_delay',
      { expectedOn: row.expectedOn },
      { reason: input.reason, note, expectedOn: input.newExpectedOn },
    );
    return { ...updated, overdue: isOverdue(updated, day) };
  });
}

/**
 * The first committed date. Once there is one, moving it is a delay ("Informar retraso"), so the person who asked
 * always learns why it changed.
 */
export async function setFulfillmentDate(
  access: AccessContext,
  ticketId: number,
  input: { expectedVersion: number; expectedOn: string },
) {
  return inTicketTransaction(access, ticketId, async (tx, fresh, existing) => {
    const row = checkVersion(existing, input.expectedVersion),
      day = today();
    if (isFinalStage(row.stage)) throw new ApiError(400, 'El requerimiento ya está cerrado.');
    if (row.expectedOn) throw new ApiError(400, 'Para cambiar la fecha comprometida usa «Informar retraso».');
    if (!input.expectedOn) throw new ApiError(400, 'Indica la fecha comprometida.');
    const problem = expectedDateProblem(input.expectedOn, day);
    if (problem) throw new ApiError(400, problem);
    const now = new Date().toISOString();
    const updated = (
      await tx.query<FulfillmentRow>(
        `UPDATE "ticketFulfillment" SET "expectedOn"=$3, version=version+1, "updatedAt"=$4
          WHERE "ticketId"=$1 AND "ownerId"=$2 RETURNING ${COLUMNS}`,
        [ticketId, fresh.ownerId, input.expectedOn, now],
      )
    ).rows[0];
    await recordEvent(tx, fresh, ticketId, 'fulfillment_date', null, { expectedOn: input.expectedOn });
    return { ...updated, overdue: isOverdue(updated, day) };
  });
}

/** The "Requerimientos" section: followed requirements with their stage, date and whether they are late. */
export async function listFulfillments(
  access: AccessContext,
  filter: FulfillmentListFilter = 'active',
): Promise<{
  items: FulfillmentListItem[];
  counts: Record<FulfillmentListFilter, number>;
  summary: FulfillmentSummary;
  today: string;
}> {
  requireStaff(access);
  const day = today();
  const rows = (
    await db()
      .prepare(
        `SELECT f."ticketId", t.subject, t."requesterName", t.requirement, f.stage, f."expectedOn", f."delayReason",
                f."createdAt", f."deliveredAt", f."updatedAt"
           FROM "ticketFulfillment" f
           JOIN tickets t ON t.id = f."ticketId" AND t."ownerId" = f."ownerId"
          WHERE f."ownerId" = $1
          ORDER BY f."expectedOn" NULLS LAST, f."ticketId"`,
      )
      .bind(access.ownerId)
      .all<Omit<FulfillmentListItem, 'overdue'>>()
  ).results;
  const items = rows.map(row => ({ ...row, overdue: isOverdue(row, day) }));
  const matches = (item: FulfillmentListItem, value: FulfillmentListFilter) =>
    value === 'all'
      ? true
      : value === 'active'
        ? !isFinalStage(item.stage)
        : value === 'overdue'
          ? item.overdue
          : value === 'closed'
            ? isFinalStage(item.stage)
            : item.stage === value;
  const counts = Object.fromEntries(
    FULFILLMENT_LIST_FILTERS.map(value => [value, items.filter(item => matches(item, value)).length]),
  ) as Record<FulfillmentListFilter, number>;
  const delays = (
    await db()
      .prepare(`SELECT "afterValue" FROM "ticketEvents" WHERE "ownerId"=$1 AND action='fulfillment_delay'`)
      .bind(access.ownerId)
      .all<{ afterValue: string | null }>()
  ).results.map(row => {
    try {
      const reason = (JSON.parse(row.afterValue ?? '{}') as { reason?: unknown }).reason;
      return typeof reason === 'string' ? reason : 'other';
    } catch {
      return 'other';
    }
  });
  return {
    items: items.filter(item => matches(item, filter)),
    counts,
    summary: summarizeFulfillments(items, delays),
    today: day,
  };
}

export const DELAY_REASON_IDS = DELAY_REASONS.map(reason => reason.id);
const isEquipmentKind = (value: unknown): value is string => EQUIPMENT_KINDS.some(kind => kind.id === value);

/**
 * Inside the ticket-creation transaction (F6-B3): a requirement asked for on purpose starts its follow-up in
 * "Solicitado" at once, so the person sees the tracking line from the first moment.
 */
export async function startRequestedFulfillment(tx: PoolClient, fresh: AccessContext, ticketId: number, now: string) {
  await tx.query(
    `INSERT INTO "ticketFulfillment" ("ticketId","ownerId",stage,"createdAt","updatedAt") VALUES ($1,$2,'requested',$3,$3)`,
    [ticketId, fresh.ownerId, now],
  );
  await recordEvent(tx, fresh, ticketId, 'fulfillment', null, { stage: 'requested', expectedOn: null });
}

export type OwnFulfillment = {
  ticketId: number;
  subject: string;
  requirement: string | null;
  stage: FulfillmentStage;
  expectedOn: string | null;
  delayReason: string | null;
  delayNote: string | null;
  updatedAt: string;
  overdue: boolean;
};
/** "Mis requerimientos": the followed requirements of the tickets this person can see (their own, or the company's). */
export async function listOwnFulfillments(access: AccessContext): Promise<{ items: OwnFulfillment[]; today: string }> {
  const scope = ticketAccessSql(access, 't', 2),
    day = today();
  const rows = (
    await db()
      .prepare(
        `SELECT f."ticketId", t.subject, t.requirement, f.stage, f."expectedOn", f."delayReason", f."delayNote", f."updatedAt"
           FROM "ticketFulfillment" f
           JOIN tickets t ON t.id = f."ticketId" AND t."ownerId" = f."ownerId"
          WHERE f."ownerId" = $1 AND ${scope.sql}
          ORDER BY (f.stage IN ('delivered','cancelled')), f."updatedAt" DESC, f."ticketId" DESC
          LIMIT 50`,
      )
      .bind(access.ownerId, ...scope.values)
      .all<Omit<OwnFulfillment, 'overdue'>>()
  ).results;
  return { items: rows.map(row => ({ ...row, overdue: isOverdue(row, day) })), today: day };
}

/**
 * "Marcar entregado" (F6-B4), in one transaction:
 * - when what was asked is equipment, its inventory ID is recorded and assigned to the requester (an existing free
 *   one of their company is reused, one that is already theirs is kept) and linked to the ticket;
 * - the follow-up moves to "Entregado";
 * - the ticket is solved through the same path as "Marcar solucionado" (SLA outcome, satisfaction survey, events).
 */
export async function deliverFulfillment(
  access: AccessContext,
  ticketId: number,
  input: { expectedVersion: number; assetTag?: string | null; kind?: string | null; serial?: string | null },
) {
  return inTicketTransaction(access, ticketId, async (tx, fresh, existing) => {
    const row = checkVersion(existing, input.expectedVersion);
    const ticket = (
      await tx.query<{ requirement: string | null; requesterMemberId: string | null; status: string }>(
        'SELECT requirement, "requesterMemberId", status FROM tickets WHERE id=$1 AND "ownerId"=$2 FOR UPDATE',
        [ticketId, fresh.ownerId],
      )
    ).rows[0];
    if (!ticket) throw new ApiError(404, 'El ticket no existe o no tienes acceso.');
    const problem = deliveryProblem(row.stage, ticket.requirement, input.assetTag);
    if (problem) throw new ApiError(400, problem);
    const now = new Date().toISOString();
    let asset: { id: string; assetTag: string } | null = null;
    if (deliveryNeedsAsset(ticket.requirement)) {
      if (!ticket.requesterMemberId)
        throw new ApiError(400, 'Vincula primero la cuenta del cliente al ticket para asignarle el equipo.');
      const requester = (
        await tx.query<{ role: string; status: string; customerCompanyId: string | null }>(
          'SELECT role, status, "customerCompanyId" FROM members WHERE id=$1 AND "ownerId"=$2',
          [ticket.requesterMemberId, fresh.ownerId],
        )
      ).rows[0];
      if (!requester || requester.role !== 'client' || requester.status === 'revoked')
        throw new ApiError(400, 'El equipo se entrega a una cuenta de cliente con acceso.');
      if (!requester.customerCompanyId)
        throw new ApiError(400, 'El cliente no tiene empresa. Asígnale una para registrar su equipo.');
      const tag = normalizeAssetTag(input.assetTag ?? '');
      const mine = (
        await tx.query<{ id: string }>(
          `SELECT id FROM "customerAssets" WHERE "ownerId"=$1 AND "assetTag"=$2 AND "assignedContactMemberId"=$3
             AND "companyId"=$4 AND archived=false`,
          [fresh.ownerId, tag, ticket.requesterMemberId, requester.customerCompanyId],
        )
      ).rows[0];
      asset = mine
        ? { id: mine.id, assetTag: tag }
        : await assignInviteEquipment(tx, {
            ownerId: fresh.ownerId,
            companyId: requester.customerCompanyId,
            memberId: ticket.requesterMemberId,
            actorMemberId: fresh.member.id,
            equipment: {
              assetTag: tag,
              kind: (isEquipmentKind(input.kind) ? input.kind : 'other_device') as InviteEquipment['kind'],
              ...(input.serial?.trim() ? { serial: input.serial.trim() } : {}),
            },
            now,
          });
      await tx.query(
        `INSERT INTO "ticketAssetLinks" ("ticketId","assetId","ownerId","createdAt","createdBy") VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT DO NOTHING`,
        [ticketId, asset.id, fresh.ownerId, now, fresh.member.id],
      );
    }
    const updated = (
      await tx.query<FulfillmentRow>(
        `UPDATE "ticketFulfillment" SET stage='delivered', "deliveredAt"=$3, "deliveredBy"=$4, "assetId"=$5,
                version=version+1, "updatedAt"=$3
          WHERE "ticketId"=$1 AND "ownerId"=$2 RETURNING ${COLUMNS}`,
        [ticketId, fresh.ownerId, now, fresh.member.id, asset?.id ?? null],
      )
    ).rows[0];
    await recordEvent(
      tx,
      fresh,
      ticketId,
      'fulfillment',
      { stage: row.stage },
      { stage: 'delivered', assetTag: asset?.assetTag ?? null },
    );
    if (ticketStatusAfter('delivered') === 'resolved' && ticket.status === 'open')
      await patchTicketInTransaction(tx, fresh, ticketId, { status: 'resolved' });
    return { ...updated, overdue: false, assetTag: asset?.assetTag ?? null };
  });
}

/** "Confirmar recepción": optional, once, by the person who asked, after delivery. */
export async function confirmFulfillmentReceipt(access: AccessContext, ticketId: number) {
  const ticket = await getTicket(access, ticketId);
  if (ticket.requesterMemberId !== access.member.id)
    throw new ApiError(403, 'Solo quien hizo el pedido puede confirmar que lo recibió.');
  return db().transaction(async tx => {
    await acquireTicketWorkLock(tx, access.ownerId);
    const fresh = await lockAccess(tx, access);
    const row = (
      await tx.query<FulfillmentRow>(
        `SELECT ${COLUMNS} FROM "ticketFulfillment" WHERE "ticketId"=$1 AND "ownerId"=$2 FOR UPDATE`,
        [ticketId, fresh.ownerId],
      )
    ).rows[0];
    if (!row) throw new ApiError(404, 'Este ticket no tiene seguimiento de requerimiento.');
    const problem = receiptProblem(row);
    if (problem) throw new ApiError(400, problem);
    const now = new Date().toISOString();
    const updated = (
      await tx.query<FulfillmentRow>(
        `UPDATE "ticketFulfillment" SET "receivedAt"=$3, version=version+1, "updatedAt"=$3
          WHERE "ticketId"=$1 AND "ownerId"=$2 RETURNING ${COLUMNS}`,
        [ticketId, fresh.ownerId, now],
      )
    ).rows[0];
    await recordEvent(tx, fresh, ticketId, 'fulfillment_receipt', null, { receivedAt: now });
    return { ...updated, overdue: false };
  });
}
