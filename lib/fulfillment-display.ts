/** Words for the follow-up of a requirement, shared by the staff screens and (F6-B3) the client portal. Pure. */
import { delayReasonLabel, isCalendarDate, isFulfillmentStage, STAGE_LABELS } from './fulfillment-model';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
/** "2026-11-20" → "20 nov 2026". A calendar day, never shifted by time zones. */
export function formatDay(value: string | null | undefined): string {
  if (!value || !isCalendarDate(value)) return '';
  const [year, month, day] = value.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

function parse(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : '');

/** One line of the follow-up history, from a ticket event (`action` and its stored `afterValue`). */
export function describeFulfillmentEvent(action: string, afterValue: string | null): string {
  const after = parse(afterValue);
  if (action === 'fulfillment_delay') {
    const date = formatDay(text(after.expectedOn));
    const note = text(after.note);
    return `Retraso: ${delayReasonLabel(text(after.reason))}${date ? ` · nueva fecha ${date}` : ''}${note ? ` · ${note}` : ''}`;
  }
  if (action === 'fulfillment_date') return `Fecha comprometida: ${formatDay(text(after.expectedOn)) || 'sin fecha'}`;
  if (action === 'fulfillment') {
    const stage = isFulfillmentStage(after.stage) ? after.stage : null;
    if (stage === 'requested') {
      const date = formatDay(text(after.expectedOn));
      return `Requerimiento en seguimiento${date ? ` · fecha comprometida ${date}` : ''}`;
    }
    const reason = text(after.reason);
    return `${stage ? STAGE_LABELS[stage] : 'Etapa actualizada'}${reason ? ` · ${reason}` : ''}`;
  }
  return '';
}
