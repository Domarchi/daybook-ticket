import type { PoolClient } from 'pg';
import { requireStaff, type AccessContext } from './access';
import {
  DELAY_REASONS,
  delayProblem,
  expectedDateProblem,
  isFinalStage,
  isFulfillmentStage,
  isOverdue,
  stageChangeProblem,
  todayIn,
  type FulfillmentStage,
} from './fulfillment-model';
import { DEFAULT_SERVICE_TIME_ZONE } from './sla-policy';
import { lockAccess, recordEvent } from './ticket-mutations';
import { ApiError, db, getTicket } from './server';
import { acquireTicketWorkLock } from './work-lock';

/** Follow-up of a requirement (F6-B2). Rules live in lib/fulfillment-model.ts; this file only reads and writes. */
export const FULFILLMENT_EVENT_ACTIONS = ['fulfillment', 'fulfillment_delay', 'fulfillment_date'] as const;
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
  updatedAt: string;
  overdue: boolean;
};
export const FULFILLMENT_LIST_FILTERS = ['active', 'requested', 'in_progress', 'ready', 'overdue', 'closed'] as const;
export type FulfillmentListFilter = (typeof FULFILLMENT_LIST_FILTERS)[number];
export function isFulfillmentListFilter(value: unknown): value is FulfillmentListFilter {
  return typeof value === 'string' && (FULFILLMENT_LIST_FILTERS as readonly string[]).includes(value);
}

const COLUMNS = `"ticketId", stage, "expectedOn", "delayReason", "delayNote", "delayedAt", "deliveredAt", "receivedAt",
  "cancelReason", "cancelledFrom", version, "createdAt", "updatedAt"`;
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
  return {
    fulfillment: row ? { ...row, overdue: isOverdue(row, day) } : null,
    canStart: !row && Boolean((ticket as { requirement?: string | null }).requirement) && ticket.status === 'open',
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
): Promise<{ items: FulfillmentListItem[]; counts: Record<FulfillmentListFilter, number>; today: string }> {
  requireStaff(access);
  const day = today();
  const rows = (
    await db()
      .prepare(
        `SELECT f."ticketId", t.subject, t."requesterName", t.requirement, f.stage, f."expectedOn", f."delayReason", f."updatedAt"
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
    value === 'active'
      ? !isFinalStage(item.stage)
      : value === 'overdue'
        ? item.overdue
        : value === 'closed'
          ? isFinalStage(item.stage)
          : item.stage === value;
  const counts = Object.fromEntries(
    FULFILLMENT_LIST_FILTERS.map(value => [value, items.filter(item => matches(item, value)).length]),
  ) as Record<FulfillmentListFilter, number>;
  return { items: items.filter(item => matches(item, filter)), counts, today: day };
}

export const DELAY_REASON_IDS = DELAY_REASONS.map(reason => reason.id);
