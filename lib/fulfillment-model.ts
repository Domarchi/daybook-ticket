/**
 * Follow-up of a requirement ("Requerimientos"), shown like a parcel being tracked:
 *
 *   Solicitado → En gestión → Listo para entregar → Entregado
 *                                     (or Cancelado, with a reason, from any open stage)
 *
 * A delay is not a stage. A requirement is "Atrasado" when its committed date has passed and it was not delivered
 * (derived when reading, no scheduled job), and the team can report a delay with a reason and a new date; the
 * person who asked sees both. Pure code: no database, no clock (callers pass "today").
 */
import { assetTagProblem } from './asset-tag';

export const FULFILLMENT_STAGES = ['requested', 'in_progress', 'ready', 'delivered', 'cancelled'] as const;
export type FulfillmentStage = (typeof FULFILLMENT_STAGES)[number];

/** The stages of the tracking line, in order. Cancelled is outside the line. */
export const TRACK_STAGES = ['requested', 'in_progress', 'ready', 'delivered'] as const;
export type TrackStage = (typeof TRACK_STAGES)[number];

export const STAGE_LABELS: Record<FulfillmentStage, string> = {
  requested: 'Solicitado',
  in_progress: 'En gestión',
  ready: 'Listo para entregar',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};
/** What the person who asked reads under each step of the tracking line. */
export const STAGE_DESCRIPTIONS: Record<FulfillmentStage, string> = {
  requested: 'Recibimos tu requerimiento.',
  in_progress: 'El equipo lo está gestionando.',
  ready: 'Está listo y se coordinará la entrega.',
  delivered: 'Fue entregado.',
  cancelled: 'El requerimiento se canceló.',
};

export const DELAY_REASONS = [
  { id: 'supplier', label: 'Proveedor' },
  { id: 'out_of_stock', label: 'Sin stock' },
  { id: 'approval_pending', label: 'Aprobación pendiente' },
  { id: 'logistics', label: 'Logística' },
  { id: 'other', label: 'Otro' },
] as const;
export type DelayReason = (typeof DELAY_REASONS)[number]['id'];

export const NOTE_MAX_LENGTH = 500;

export function isFulfillmentStage(value: unknown): value is FulfillmentStage {
  return typeof value === 'string' && (FULFILLMENT_STAGES as readonly string[]).includes(value);
}
export function isDelayReason(value: unknown): value is DelayReason {
  return DELAY_REASONS.some(reason => reason.id === value);
}
export function delayReasonLabel(value: string | null | undefined): string {
  return DELAY_REASONS.find(reason => reason.id === value)?.label ?? 'Otro';
}
/** Delivered and cancelled do not change any more. */
export function isFinalStage(stage: FulfillmentStage): boolean {
  return stage === 'delivered' || stage === 'cancelled';
}
const position = (stage: FulfillmentStage) => (TRACK_STAGES as readonly string[]).indexOf(stage);

/**
 * Whether a stage change is allowed. Returns the message to show, or null.
 * - Moving forward may skip steps (equipment in stock can go straight to "Listo" or "Entregado").
 * - Going back is only "Listo para entregar" → "En gestión", and needs a reason.
 * - Cancelling needs a reason. Delivered and cancelled are final.
 */
export function stageChangeProblem(
  from: FulfillmentStage,
  to: FulfillmentStage,
  reason?: string | null,
): string | null {
  if (isFinalStage(from))
    return from === 'delivered'
      ? 'Un requerimiento entregado ya no cambia de etapa.'
      : 'Un requerimiento cancelado ya no cambia de etapa.';
  if (from === to) return `El requerimiento ya está en «${STAGE_LABELS[to]}».`;
  const note = (reason ?? '').trim();
  if (note.length > NOTE_MAX_LENGTH) return `El motivo admite hasta ${NOTE_MAX_LENGTH} caracteres.`;
  if (to === 'cancelled') return note ? null : 'Indica por qué se cancela el requerimiento.';
  if (position(to) > position(from)) return null;
  if (from === 'ready' && to === 'in_progress')
    return note ? null : 'Indica por qué el requerimiento vuelve a «En gestión».';
  return `Un requerimiento no puede volver de «${STAGE_LABELS[from]}» a «${STAGE_LABELS[to]}».`;
}

/** The stages a control may offer from the current one (forward moves, the one allowed step back, cancel). */
export function stageOptions(from: FulfillmentStage): FulfillmentStage[] {
  return FULFILLMENT_STAGES.filter(to => !stageChangeProblem(from, to, 'motivo'));
}

/** What a stage change does to the ticket: delivering solves it (with the satisfaction survey, as today). */
export function ticketStatusAfter(to: FulfillmentStage): 'resolved' | null {
  return to === 'delivered' ? 'resolved' : null;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A calendar date "YYYY-MM-DD" that exists (no 31 of February). */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
/** Today's date in a time zone, as "YYYY-MM-DD". The committed date is a day for people, not an instant. */
export function todayIn(timeZone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The committed date: optional, but when given it must be a real date and not in the past. */
export function expectedDateProblem(value: string | null | undefined, today: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (!isCalendarDate(value)) return 'La fecha comprometida no es válida.';
  if (value < today) return 'La fecha comprometida no puede estar en el pasado.';
  return null;
}

/** "Atrasado": open, with a committed date, and that day is over. */
export function isOverdue(state: { stage: FulfillmentStage; expectedOn: string | null }, today: string): boolean {
  return !isFinalStage(state.stage) && state.expectedOn !== null && state.expectedOn < today;
}

/** Reporting a delay: a reason from the list, a note when the reason is "Otro", and a new date from today on. */
export function delayProblem(
  stage: FulfillmentStage,
  input: { reason: unknown; note?: string | null; newExpectedOn: unknown },
  today: string,
): string | null {
  if (isFinalStage(stage)) return 'Solo se informa un retraso en un requerimiento abierto.';
  if (!isDelayReason(input.reason)) return 'Elige el motivo del retraso.';
  const note = (input.note ?? '').trim();
  if (note.length > NOTE_MAX_LENGTH) return `La nota admite hasta ${NOTE_MAX_LENGTH} caracteres.`;
  if (input.reason === 'other' && !note) return 'Explica el motivo del retraso.';
  if (typeof input.newExpectedOn !== 'string' || !input.newExpectedOn) return 'Indica la nueva fecha comprometida.';
  return expectedDateProblem(input.newExpectedOn, today);
}

/**
 * Delivering. When what was asked is equipment, the equipment's inventory ID is required: it is recorded and
 * assigned to the person who asked.
 */
export function deliveryProblem(
  stage: FulfillmentStage,
  requirement: string | null,
  assetTag: string | null | undefined,
): string | null {
  const change = stageChangeProblem(stage, 'delivered');
  if (change) return change;
  if (!deliveryNeedsAsset(requirement)) return null;
  const problem = assetTagProblem(assetTag ?? '');
  if (!problem) return null;
  return (assetTag ?? '').trim() ? problem : 'Indica el ID del equipo entregado.';
}
export function deliveryNeedsAsset(requirement: string | null): boolean {
  return requirement === 'equipment';
}

/** "Confirmar recepción" is optional and only once, by the person who asked, after delivery. */
export function receiptProblem(state: { stage: FulfillmentStage; receivedAt: string | null }): string | null {
  if (state.stage !== 'delivered') return 'Solo se confirma la recepción de un requerimiento entregado.';
  if (state.receivedAt) return 'La recepción ya fue confirmada.';
  return null;
}

export type TrackStep = { stage: TrackStage | 'cancelled'; label: string; state: 'done' | 'current' | 'pending' };
/**
 * The tracking line. For a cancelled requirement, the steps it reached stay done and "Cancelado" closes the line;
 * `cancelledFrom` is the stage it had when it was cancelled (from its history).
 */
export function trackingSteps(stage: FulfillmentStage, cancelledFrom?: FulfillmentStage | null): TrackStep[] {
  if (stage === 'cancelled') {
    const reached = cancelledFrom && !isFinalStage(cancelledFrom) ? position(cancelledFrom) : 0;
    return [
      ...TRACK_STAGES.slice(0, reached + 1).map(item => ({
        stage: item,
        label: STAGE_LABELS[item],
        state: 'done' as const,
      })),
      { stage: 'cancelled', label: STAGE_LABELS.cancelled, state: 'current' },
    ];
  }
  const current = position(stage);
  return TRACK_STAGES.map((item, index) => ({
    stage: item,
    label: STAGE_LABELS[item],
    state: index < current || stage === 'delivered' ? 'done' : index === current ? 'current' : 'pending',
  }));
}
