/**
 * Feature 5: the report of a customer company for a month, through Bita.
 *
 * Bita does not compute anything new: it reuses the company report of the Reports screen (`company-reports.ts`),
 * which only aggregates counts (no conversations, requesters, notes or documents). The `informe_empresa` tool reads it
 * for the month asked, reduces it to an allow-list and lets the model explain it in a few lines. The downloadable PDF is
 * the official monthly report of that screen: the chat shows a button that creates and downloads it when the person
 * clicks, exactly as the Reports screen does. Bita itself writes nothing.
 */
import type { AccessContext } from './access';
import { metricsDate } from './agent-metrics-model';
import { getCompanyOperationalReport } from './company-reports';
import { monthlyReportPeriod, type CompanyOperationalReport } from './knowledge-model';
import { ApiError, db } from './server';

export const MAX_COMPANY_CANDIDATES = 15;
export const MAX_TRENDS = 5;
const MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;

export type CompanyReportInput = { empresa: string; mes: string | null };
export type CompanyReportAction = { kind: 'company_report'; companyId: string; companyName: string; month: string };

type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateCompanyReport(input: unknown): Validation<CompanyReportInput> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return { ok: false, error: 'La consulta debe ser un objeto.' };
  const { empresa, mes } = input as Record<string, unknown>;
  if (typeof empresa !== 'string' || !empresa.trim() || empresa.length > 120)
    return { ok: false, error: '«empresa» debe ser el nombre de la empresa, de hasta 120 caracteres.' };
  if (mes !== undefined && mes !== null && (typeof mes !== 'string' || !MONTH.test(mes)))
    return { ok: false, error: '«mes» debe tener la forma AAAA-MM, por ejemplo 2026-10.' };
  return { ok: true, value: { empresa: empresa.trim(), mes: (mes as string | undefined) ?? null } };
}

/** The month to report: the one asked or, by default, the current month in Santiago. Never a future month. */
export function reportMonth(asked: string | null, now: number): Validation<string> {
  const current = metricsDate(new Date(now)).slice(0, 7);
  const month = asked ?? current;
  if (month > current) return { ok: false, error: `No hay informe de ${month}: es un mes futuro.` };
  return { ok: true, value: month };
}

const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export type CompanyMatch =
  | { kind: 'one'; company: { id: string; name: string } }
  | { kind: 'many'; names: string[] }
  | { kind: 'none'; names: string[] };

/**
 * Finds the company by name, ignoring case, accents and punctuation. An exact name wins; otherwise every company
 * whose name contains what was asked (or is contained in it). More than one is a question back, never a guess.
 */
export function matchCompany(asked: string, companies: { id: string; name: string }[]): CompanyMatch {
  const wanted = fold(asked);
  const names = (list: { name: string }[]) => list.slice(0, MAX_COMPANY_CANDIDATES).map(company => company.name);
  if (!wanted) return { kind: 'none', names: names(companies) };
  const exact = companies.filter(company => fold(company.name) === wanted);
  if (exact.length === 1) return { kind: 'one', company: exact[0] };
  const partial = companies.filter(company => {
    const name = fold(company.name);
    return name.includes(wanted) || (name.length >= 3 && wanted.includes(name));
  });
  if (partial.length === 1) return { kind: 'one', company: partial[0] };
  if (partial.length > 1) return { kind: 'many', names: names(partial) };
  return { kind: 'none', names: names(companies) };
}

const percent = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10);
const top = (rows: { label: string; count: number }[]) =>
  rows.slice(0, MAX_TRENDS).map(row => ({ nombre: row.label.slice(0, 120), tickets: row.count }));

/** What the model sees of the report: counts and the top types and equipment. Daily rows and notes stay out. */
export function companyReportForModel(report: CompanyOperationalReport, month: string) {
  const summary = report.summary;
  return {
    empresa: report.companyName,
    mes: month,
    periodo: { desde: report.period.from, hasta: report.period.to },
    entradas_del_mes: summary.created,
    resueltos_del_mes: summary.resolutions,
    sla: {
      cumplidos: summary.slaMet,
      incumplidos: summary.slaBreached,
      porcentaje_cumplimiento: percent(summary.slaCompliancePercent),
    },
    respuestas_publicas_del_equipo: summary.publicReplies,
    carga_actual: {
      abiertos: summary.currentOpen,
      pendientes: summary.currentPending,
      vencidos: summary.currentOverdue,
    },
    tipos_mas_frecuentes: top(report.byType),
    equipos_mas_frecuentes: top(report.byAsset),
    sin_tipo: summary.untyped,
    sin_equipo: summary.withoutAsset,
    incluye_tickets_de_prueba: false,
    aviso:
      'La carga actual es de hoy; entradas, resueltos y SLA son del período. El SLA solo cuenta resoluciones con su plazo registrado.',
  };
}

async function companiesOf(access: AccessContext) {
  return (
    await db()
      .prepare(
        'SELECT id,name FROM "customerCompanies" WHERE "ownerId"=$1 AND "organizationId"=$2 ORDER BY name,id LIMIT 500',
      )
      .bind(access.ownerId, access.organizationId)
      .all<{ id: string; name: string }>()
  ).results;
}

export type CompanyReportResult =
  | { ok: true; data: ReturnType<typeof companyReportForModel>; action: CompanyReportAction }
  | { ok: false; error: string };

/** The `informe_empresa` tool: find the company, read its report for the month. Reads only. */
export async function readCompanyReport(
  access: AccessContext,
  input: CompanyReportInput,
  now: number,
): Promise<CompanyReportResult> {
  const month = reportMonth(input.mes, now);
  if (!month.ok) return month;
  const match = matchCompany(input.empresa, await companiesOf(access));
  if (match.kind === 'many')
    return {
      ok: false,
      error: `Hay varias empresas que coinciden con «${input.empresa.slice(0, 60)}»: ${match.names.join(', ')}. Pregunta cuál.`,
    };
  if (match.kind === 'none')
    return {
      ok: false,
      error: match.names.length
        ? `No encontré la empresa «${input.empresa.slice(0, 60)}». Empresas registradas: ${match.names.join(', ')}.`
        : 'No hay empresas registradas en este espacio.',
    };
  let report: CompanyOperationalReport;
  try {
    report = await getCompanyOperationalReport(
      access,
      monthlyReportPeriod(match.company.id, month.value, false, new Date(now)),
      new Date(now),
    );
  } catch (failure) {
    // The reports belong to the knowledge feature (paused: 503); without it the Reports screen has none either.
    if (failure instanceof ApiError && [403, 404, 503].includes(failure.status))
      return { ok: false, error: 'Los informes por empresa no están disponibles en este espacio.' };
    throw failure;
  }
  return {
    ok: true,
    data: companyReportForModel(report, month.value),
    action: {
      kind: 'company_report',
      companyId: match.company.id,
      companyName: match.company.name,
      month: month.value,
    },
  };
}
