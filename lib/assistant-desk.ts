/**
 * The desk summary Bita shows when the chat opens (feature 1): what is due today, what is overdue, how many tickets
 * have nobody, how each technician is doing and what is escalated. Fixed rules over rows the server already read;
 * no model, no cost. The same result is the `resumen_bandeja` tool, so the chat and the greeting never disagree.
 *
 * Pure: the rows come from `readDeskRows` (`assistant-data.ts`) and the clock is a parameter.
 */
import { ticketLine } from './assistant-privacy';
import { isActive } from './ticket-status';
import type { Ticket } from './types';

export const SERVICE_TIME_ZONE = 'America/Santiago';
export const MAX_LISTED = 10;
export const MAX_DESK_ROWS = 500;

export type DeskRow = Pick<
  Ticket,
  'id' | 'subject' | 'status' | 'assigneeMemberId' | 'priority' | 'dueAt' | 'updatedAt' | 'createdAt'
> & {
  /** Only used to mask the requester's name if it was typed into the subject; never sent. */
  requesterName?: string | null;
  assigneeName: string | null;
  /** Kind of the latest message that is not an internal note: "request" means the customer spoke last. */
  lastPublicKind: string | null;
  /** Reason of an escalation raised after the team's last public reply, if any. */
  escalationReason: string | null;
};

/** The calendar day in Santiago, "AAAA-MM-DD". It is the day of the daily quota and of "vence hoy". */
export function serviceDay(now: number = Date.now(), timeZone = SERVICE_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(now))
    .reduce<Record<string, string>>((all, part) => ({ ...all, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function offsetMinutes(instant: number, timeZone: string): number {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(new Date(instant))
      .find(part => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === '-' ? -minutes : minutes;
}

/** The instant the current Santiago day ends (next local midnight), daylight-saving changes included. */
export function serviceDayEnd(now: number = Date.now(), timeZone = SERVICE_TIME_ZONE): number {
  const [year, month, day] = serviceDay(now, timeZone).split('-').map(Number);
  const midnightUtc = Date.UTC(year, month - 1, day + 1);
  let end = midnightUtc - offsetMinutes(midnightUtc, timeZone) * 60_000;
  // On a change day the offset before and after midnight differ; one correction lands on the local midnight.
  end = midnightUtc - offsetMinutes(end, timeZone) * 60_000;
  return end;
}

export type DeskSummary = ReturnType<typeof summarizeDesk>;

const byDue = (a: DeskRow, b: DeskRow) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.id - b.id;
const byAge = (a: DeskRow, b: DeskRow) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id - b.id;

export function summarizeDesk(rows: DeskRow[], now: number = Date.now(), partial = false) {
  const active = rows.filter(row => isActive(row.status));
  const dayEnd = serviceDayEnd(now);
  const due = (row: DeskRow) => Date.parse(row.dueAt);
  const overdue = active.filter(row => due(row) < now).sort(byDue);
  const dueToday = active.filter(row => due(row) >= now && due(row) < dayEnd).sort(byDue);
  const unassigned = active.filter(row => !row.assigneeMemberId).sort(byAge);
  const escalated = active.filter(row => row.escalationReason).sort(byDue);
  const waiting = active.filter(row => row.lastPublicKind === 'request').sort(byAge);
  const line = (row: DeskRow) => ({
    ...ticketLine(row, { assigneeName: row.assigneeName, requesterName: row.requesterName }, now),
    ...(row.escalationReason
      ? { escalado_por: row.escalationReason === 'overdue' ? 'plazo vencido' : 'sin respuesta' }
      : {}),
  });
  const technicians = new Map<string, { nombre: string; activos: number; vencidos: number; vencen_hoy: number }>();
  for (const row of active) {
    if (!row.assigneeMemberId) continue;
    const entry = technicians.get(row.assigneeMemberId) ?? {
      nombre: row.assigneeName || 'Sin nombre',
      activos: 0,
      vencidos: 0,
      vencen_hoy: 0,
    };
    entry.activos += 1;
    if (due(row) < now) entry.vencidos += 1;
    else if (due(row) < dayEnd) entry.vencen_hoy += 1;
    technicians.set(row.assigneeMemberId, entry);
  }
  return {
    fecha: serviceDay(now),
    totales: {
      activos: active.length,
      sin_asignar: unassigned.length,
      en_proceso: active.length - unassigned.length,
      vencidos: overdue.length,
      vencen_hoy: dueToday.length,
      escalados: escalated.length,
      esperan_respuesta: waiting.length,
    },
    vencidos: overdue.slice(0, MAX_LISTED).map(line),
    vencen_hoy: dueToday.slice(0, MAX_LISTED).map(line),
    sin_asignar: unassigned.slice(0, MAX_LISTED).map(line),
    escalados: escalated.slice(0, MAX_LISTED).map(line),
    esperan_respuesta: waiting.slice(0, MAX_LISTED).map(line),
    por_tecnico: [...technicians.values()].sort((a, b) => b.vencidos - a.vencidos || b.activos - a.activos),
    /** True when the desk had more active tickets than were read: the totals are a lower bound. */
    parcial: partial,
  };
}
