export const METRICS_TIME_ZONE = 'America/Santiago';

export interface MetricsQuery {
  includeTests?: boolean;
  from: string;
  to: string;
  fromInstant: string;
  untilInstant: string;
  companyId: string | null;
}
export interface AgentMetric {
  memberId: string;
  name: string;
  role: string;
  status: string;
  currentOpen: number;
  currentPending: number;
  publicReplies: number;
  firstResponseCount: number;
  averageFirstResponseHours: number | null;
  resolutions: number;
  measurableResolutions: number;
  averageResolutionHours: number | null;
  slaMet: number;
  slaBreached: number;
  slaCompliancePercent: number | null;
}
export interface AgentMetricsReport {
  period: MetricsQuery & { timeZone: string };
  generatedAt: string;
  agents: AgentMetric[];
  coverage: {
    unknownPublicReplies: number;
    unknownFirstResponseTickets: number;
    unattributedResolutions: number;
    historicalResolvedWithoutMeasurement: number;
  };
}
export class MetricsQueryError extends Error {}

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: METRICS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export function metricsDate(date: Date): string {
  const values = Object.fromEntries(dateFormatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function validDate(value: string): boolean {
  return (
    /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export function shiftMetricsDate(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/** Earliest instant of a Santiago date, including the DST day with no 00:00.
 * Searching civil dates avoids silently treating date filters as UTC or choosing
 * an impossible local midnight. No external timezone/calendar service is used.
 */
export function metricsDayStart(date: string): string {
  if (!validDate(date)) throw new MetricsQueryError('Introduce fechas válidas con formato año-mes-día.');
  const nominal = Date.parse(`${date}T00:00:00Z`);
  let low = nominal - 36 * 3600_000,
    high = nominal + 36 * 3600_000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (metricsDate(new Date(middle)) < date) low = middle + 1;
    else high = middle;
  }
  if (metricsDate(new Date(low)) !== date)
    throw new MetricsQueryError('La fecha no existe en el calendario seleccionado.');
  return new Date(low).toISOString();
}

export function parseMetricsQuery(params: URLSearchParams, now = new Date()): MetricsQuery {
  for (const key of params.keys()) {
    if (!['from', 'to', 'companyId', 'includeTests'].includes(key) || params.getAll(key).length !== 1)
      throw new MetricsQueryError('Los filtros de métricas no son válidos.');
  }
  const today = metricsDate(now);
  const to = params.get('to') || today;
  if (!validDate(to)) throw new MetricsQueryError('Introduce fechas válidas con formato año-mes-día.');
  const from = params.get('from') || shiftMetricsDate(to, -29);
  if (!validDate(from) || !validDate(to))
    throw new MetricsQueryError('Introduce fechas válidas con formato año-mes-día.');
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000 + 1;
  if (days < 1 || days > 366 || to > today)
    throw new MetricsQueryError('Selecciona un período de hasta 366 días, sin fechas futuras.');
  const companyId = params.get('companyId') || null;
  if (companyId && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(companyId))
    throw new MetricsQueryError('Selecciona una empresa válida.');
  const includeTests = params.get('includeTests');
  if (includeTests !== null && !['true', 'false'].includes(includeTests))
    throw new MetricsQueryError('El filtro de pruebas no es válido.');
  return {
    from,
    to,
    fromInstant: metricsDayStart(from),
    untilInstant: metricsDayStart(shiftMetricsDate(to, 1)),
    companyId,
    ...(includeTests !== null ? { includeTests: includeTests === 'true' } : {}),
  };
}

export function metricsCsvCell(value: string | number | null): string {
  const raw = value === null ? '' : String(value);
  const safe = /^[\s]*[=+@\-\t\r\n]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function agentMetricsCsv(report: AgentMetricsReport): string {
  const rows: (string | number | null)[][] = [
    ['Desde', report.period.from, 'Hasta', report.period.to, 'Zona horaria', report.period.timeZone],
    ['Datos de prueba', report.period.includeTests ? 'Incluidos' : 'Excluidos'],
    [
      'Agente',
      'Estado',
      'Abiertos actuales',
      'Pendientes actuales',
      'Respuestas públicas',
      'Primeras respuestas medidas',
      'Primera respuesta promedio (horas corridas)',
      'Resoluciones registradas',
      'Duraciones medidas',
      'Resolución promedio (horas corridas)',
      'Dentro del SLA',
      'Fuera del SLA',
      'Cumplimiento SLA (%)',
    ],
    ...report.agents.map(row => [
      row.name,
      row.status,
      row.currentOpen,
      row.currentPending,
      row.publicReplies,
      row.firstResponseCount,
      row.averageFirstResponseHours,
      row.resolutions,
      row.measurableResolutions,
      row.averageResolutionHours,
      row.slaMet,
      row.slaBreached,
      row.slaCompliancePercent,
    ]),
  ];
  return '\uFEFF' + rows.map(row => row.map(metricsCsvCell).join(',')).join('\r\n');
}
