import { z } from 'zod';
import type { TicketPriority } from './types';

export const DEFAULT_SERVICE_TIME_ZONE = 'America/Santiago';
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MAX_CALENDAR_DAYS = 3660;

export interface ServiceCalendar {
  mode: 'always' | 'business';
  timeZone: string;
  /** ISO weekday: Monday 1, Sunday 7. End may be 24:00. */
  week: { day: number; start: string; end: string }[];
  holidays: string[];
}
export interface ServicePolicySnapshot {
  version: 1;
  calendar: ServiceCalendar;
  slaHours: Record<TicketPriority, number>;
}
export class SlaCalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlaCalculationError';
  }
}

export function isServiceTimeZone(value: string): boolean {
  if (value.length > 100 || !/^(?:UTC|GMT|[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+)$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value;
}
const startTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Usa una hora válida, por ejemplo 09:00.');
const endTime = z
  .string()
  .regex(/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/, 'Usa una hora válida; el fin puede ser 24:00.');
export const slaHoursSchema = z
  .object({
    urgent: z.number().finite().min(1).max(8760),
    high: z.number().finite().min(1).max(8760),
    normal: z.number().finite().min(1).max(8760),
    low: z.number().finite().min(1).max(8760),
  })
  .strict();
export const serviceCalendarSchema = z
  .object({
    mode: z.enum(['always', 'business']),
    timeZone: z.string().refine(isServiceTimeZone, 'Selecciona una zona horaria IANA válida.'),
    week: z.array(z.object({ day: z.number().int().min(1).max(7), start: startTime, end: endTime }).strict()).max(28),
    holidays: z.array(z.string().refine(isCalendarDate, 'Usa una fecha real en formato AAAA-MM-DD.')).max(500),
  })
  .strict()
  .superRefine((calendar, context) => {
    if (calendar.mode === 'business' && !calendar.week.length)
      context.addIssue({ code: 'custom', path: ['week'], message: 'Agrega al menos un tramo de atención semanal.' });
    const sorted = [...calendar.week].sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
    for (let index = 0; index < sorted.length; index++) {
      const item = sorted[index],
        previous = sorted[index - 1];
      if (item.start >= item.end)
        context.addIssue({
          code: 'custom',
          path: ['week'],
          message: 'El inicio debe ser anterior al fin; divide los turnos que cruzan medianoche.',
        });
      if (previous?.day === item.day && previous.end > item.start)
        context.addIssue({
          code: 'custom',
          path: ['week'],
          message: 'Los tramos del mismo día no pueden superponerse.',
        });
    }
    if (new Set(calendar.holidays).size !== calendar.holidays.length)
      context.addIssue({ code: 'custom', path: ['holidays'], message: 'Hay fechas no laborables repetidas.' });
  })
  .transform(calendar => ({
    ...calendar,
    week: [...calendar.week].sort((a, b) => a.day - b.day || a.start.localeCompare(b.start)),
    holidays: [...calendar.holidays].sort(),
  }));
export const servicePolicySnapshotSchema = z
  .object({ version: z.literal(1), calendar: serviceCalendarSchema, slaHours: slaHoursSchema })
  .strict();

export function createLegacyServicePolicySnapshot(hours: Record<TicketPriority, number>): ServicePolicySnapshot {
  return {
    version: 1,
    calendar: { mode: 'always', timeZone: DEFAULT_SERVICE_TIME_ZONE, week: [], holidays: [] },
    slaHours: slaHoursSchema.parse(hours),
  };
}
export function readServicePolicySnapshot(value: unknown): ServicePolicySnapshot | null {
  try {
    const parsed = servicePolicySnapshotSchema.safeParse(typeof value === 'string' ? JSON.parse(value) : value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export const readSnapshot = readServicePolicySnapshot;

function dateFormatter(timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
}
function localParts(at: number, formatter: Intl.DateTimeFormat) {
  const parts = Object.fromEntries(
    formatter
      .formatToParts(at)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}
function offsetAt(at: number, formatter: Intl.DateTimeFormat): number {
  const p = localParts(at, formatter);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000;
}
interface OffsetSegment {
  start: number;
  end: number;
  offset: number;
}

/** Partition UTC into actual offset periods, rather than choosing an arbitrary
 * occurrence of an ambiguous local hour. A gap contributes no working time;
 * a repeated hour contributes elapsed time whenever its local clock is open.
 * The surrounding 96-hour window also handles a skipped local calendar day.
 */
function offsetSegments(nominalDay: number, formatter: Intl.DateTimeFormat): OffsetSegment[] {
  const from = nominalDay - 36 * HOUR_MS,
    until = nominalDay + 60 * HOUR_MS;
  const result: OffsetSegment[] = [];
  let segmentStart = from,
    previous = from,
    offset = offsetAt(from, formatter);
  for (let probe = from + 6 * HOUR_MS; probe <= until; probe += 6 * HOUR_MS) {
    const nextOffset = offsetAt(probe, formatter);
    if (nextOffset !== offset) {
      let low = previous,
        high = probe;
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (offsetAt(middle, formatter) === offset) low = middle;
        else high = middle;
      }
      result.push({ start: segmentStart, end: high, offset });
      segmentStart = high;
      offset = nextOffset;
    }
    previous = probe;
  }
  result.push({ start: segmentStart, end: until, offset });
  return result;
}
function timeMinutes(value: string): number {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}
function workingIntervals(
  nominalDay: number,
  week: ServiceCalendar['week'],
  formatter: Intl.DateTimeFormat,
): [number, number][] {
  const segments = offsetSegments(nominalDay, formatter);
  const intervals: [number, number][] = [];
  for (const window of week) {
    const start = nominalDay + timeMinutes(window.start) * 60_000;
    const end = nominalDay + timeMinutes(window.end) * 60_000;
    for (const segment of segments) {
      const from = Math.max(start - segment.offset, segment.start),
        to = Math.min(end - segment.offset, segment.end);
      if (from < to) intervals.push([from, to]);
    }
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
    else merged.push([...interval]);
  }
  return merged;
}

/** Add service hours without changing the input or using the host time zone.
 * Business hours mean elapsed time inside the configured local-time windows.
 * Pending tickets are not paused; calendars affect resolution deadlines only.
 */
export function addSlaHours(startISO: string, hours: number, rawCalendar: ServiceCalendar): string {
  const started = Date.parse(startISO);
  if (!Number.isFinite(started) || !Number.isFinite(hours) || hours < 0 || hours > 8760)
    throw new SlaCalculationError('La fecha o el plazo de resolución no es válido.');
  const calendar = serviceCalendarSchema.parse(rawCalendar);
  let remaining = Math.ceil(hours * HOUR_MS);
  if (!remaining) return new Date(started).toISOString();
  if (calendar.mode === 'always') return new Date(started + remaining).toISOString();
  const formatter = dateFormatter(calendar.timeZone);
  const p = localParts(started, formatter);
  let day = Date.UTC(p.year, p.month - 1, p.day);
  const holidays = new Set(calendar.holidays);
  for (let count = 0; count < MAX_CALENDAR_DAYS; count++, day += DAY_MS) {
    const date = new Date(day).toISOString().slice(0, 10);
    if (holidays.has(date)) continue;
    const weekday = new Date(day).getUTCDay() || 7;
    const windows = calendar.week.filter(window => window.day === weekday);
    if (!windows.length) continue;
    for (const [start, end] of workingIntervals(day, windows, formatter)) {
      const from = Math.max(start, started);
      if (from >= end) continue;
      const available = end - from;
      if (remaining <= available) return new Date(from + remaining).toISOString();
      remaining -= available;
    }
  }
  throw new SlaCalculationError(
    'El plazo no cabe en los próximos diez años de este calendario. Amplía los horarios o reduce las horas del SLA.',
  );
}

export function calculateTicketDueAt(
  startISO: string,
  priority: TicketPriority,
  policy: ServicePolicySnapshot,
): string {
  return addSlaHours(startISO, policy.slaHours[priority], policy.calendar);
}
