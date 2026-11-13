/** Words for the follow-up of a requirement, shared by the staff screens and (F6-B3) the client portal. Pure. */
import { delayReasonLabel, isCalendarDate, isFulfillmentStage, STAGE_LABELS } from './fulfillment-model';
import { REQUIREMENTS } from './ticket-category-model';
import { csvOrganizationCell } from './work-organization-model';
import type { FulfillmentListItem } from './fulfillment';

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
  if (action === 'fulfillment_receipt') return 'Recepción confirmada por quien lo pidió';
  if (action === 'fulfillment_date') return `Fecha comprometida: ${formatDay(text(after.expectedOn)) || 'sin fecha'}`;
  if (action === 'fulfillment') {
    const stage = isFulfillmentStage(after.stage) ? after.stage : null;
    if (stage === 'requested') {
      const date = formatDay(text(after.expectedOn));
      return `Requerimiento en seguimiento${date ? ` · fecha comprometida ${date}` : ''}`;
    }
    if (stage === 'delivered') {
      const tag = text(after.assetTag);
      return `${STAGE_LABELS.delivered}${tag ? ` · equipo ${tag}` : ''}`;
    }
    const reason = text(after.reason);
    return `${stage ? STAGE_LABELS[stage] : 'Etapa actualizada'}${reason ? ` · ${reason}` : ''}`;
  }
  return '';
}

/** Every followed requirement as CSV (cells escaped against spreadsheet formulas). */
export function fulfillmentCsv(
  items: Pick<
    FulfillmentListItem,
    | 'ticketId'
    | 'subject'
    | 'requesterName'
    | 'requirement'
    | 'stage'
    | 'expectedOn'
    | 'overdue'
    | 'delayReason'
    | 'deliveredAt'
  >[],
): string {
  const rows = [
    [
      'Ticket',
      'Asunto',
      'Solicitante',
      'Requerimiento',
      'Etapa',
      'Fecha comprometida',
      'Atrasado',
      'Último retraso',
      'Entregado el',
    ],
    ...items.map(item => [
      `#${String(item.ticketId).padStart(4, '0')}`,
      item.subject,
      item.requesterName,
      REQUIREMENTS.find(entry => entry.id === item.requirement)?.label ?? 'Requerimiento',
      STAGE_LABELS[item.stage],
      item.expectedOn ?? '',
      item.overdue ? 'Sí' : 'No',
      item.delayReason ? delayReasonLabel(item.delayReason) : '',
      item.deliveredAt ? item.deliveredAt.slice(0, 10) : '',
    ]),
  ];
  return rows.map(row => row.map(csvOrganizationCell).join(',')).join('\r\n');
}
