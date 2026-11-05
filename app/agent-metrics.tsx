'use client';

import { useEffect, useState } from 'react';
import { ArrowDownToLine, BarChart3, Clock3, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import type { CustomerCompany } from '@/lib/types';
import { agentMetricsCsv, metricsDate, shiftMetricsDate, type AgentMetricsReport } from '@/lib/agent-metrics-model';
import './agent-metrics.css';

const number = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });
const hours = (value: number | null) => value === null ? 'Sin datos' : `${number.format(value)} h`;
const percentage = (value: number | null) => value === null ? 'Sin datos' : `${number.format(value)} %`;

export function AgentMetricsPanel({ companies, memberId }: { companies: CustomerCompany[]; memberId?: string }) {
  const [today] = useState(() => metricsDate(new Date()));
  const [filters, setFilters] = useState(() => ({ from: shiftMetricsDate(today, -29), to: today, companyId: '' }));
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; data: AgentMetricsReport | null; error: string } | null>(null);
  const query = new URLSearchParams(filters).toString();
  const incomplete = !filters.from || !filters.to;
  const requestKey = `${memberId || ''}:${query}:${revision}`;
  const current = result?.key === requestKey ? result : null;
  const report = current?.data ?? null;
  const loading = !incomplete && current === null;
  useEffect(() => {
    if (incomplete) return;
    const controller = new AbortController();
    void fetch(`/api/metrics/agents?${query}`, { cache: 'no-store', signal: controller.signal,
      ...(memberId ? { headers: { 'X-Daybook-Member-Id': memberId } } : {}),
    })
      .then(async response => {
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || 'No se pudieron cargar las métricas.');
        if (!controller.signal.aborted) setResult({ key: requestKey, data: value, error: '' });
      })
      .catch(error => {
        if (!controller.signal.aborted) setResult({ key: requestKey, data: null, error: error instanceof Error ? error.message : 'No se pudieron cargar las métricas.' });
      });
    return () => controller.abort();
  }, [query, requestKey, incomplete, memberId]);

  const rows = report?.agents || [];
  const total = rows.reduce((sum, row) => ({
    open: sum.open + row.currentOpen + row.currentPending,
    replies: sum.replies + row.publicReplies,
    resolutions: sum.resolutions + row.resolutions,
    met: sum.met + row.slaMet,
    measured: sum.measured + row.slaMet + row.slaBreached,
  }), { open: 0, replies: 0, resolutions: 0, met: 0, measured: 0 });
  const exportCsv = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([agentMetricsCsv(report)], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `metricas-agentes-${report.period.from}-${report.period.to}.csv`;
    anchor.click(); URL.revokeObjectURL(url);
  };
  return <div className="agent-metrics">
    <div className="page-heading">
      <div><div className="eyebrow"><span className="tiny-line"/>EL SERVICIO, EN NÚMEROS</div><h1>Métricas del equipo</h1><p>Revisa la carga actual, las respuestas y el cumplimiento de cada agente.</p></div>
      <div className="heading-actions"><button className="secondary" type="button" disabled={!report} onClick={exportCsv}><ArrowDownToLine size={16}/>Exportar CSV</button><button className="secondary" type="button" aria-label="Actualizar métricas" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16}/>Actualizar</button></div>
    </div>
    <section className="panel agent-metrics-filters" aria-label="Filtros de métricas">
      <label>Desde<input type="date" min="2000-01-01" max={filters.to || today} value={filters.from} onChange={event => setFilters(value => ({ ...value, from: event.target.value }))}/></label>
      <label>Hasta<input type="date" min={filters.from || '2000-01-01'} max={today} value={filters.to} onChange={event => setFilters(value => ({ ...value, to: event.target.value }))}/></label>
      <label>Empresa<select value={filters.companyId} onChange={event => setFilters(value => ({ ...value, companyId: event.target.value }))}><option value="">Todas las empresas</option>{companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
      <p>Fechas de Santiago · hasta 366 días. Los tiempos se expresan en horas corridas.</p>
    </section>
    {incomplete && <p className="agent-metrics-no-activity" role="status">Selecciona una fecha de inicio y una fecha de término para consultar el período.</p>}
    {current?.error && <div className="error-banner" role="alert">{current.error}<button type="button" className="secondary" onClick={() => setRevision(value => value + 1)}>Reintentar</button></div>}
    {loading && <section className="panel agent-metrics-empty" role="status" aria-live="polite"><RefreshCw className="spinning" size={24}/><h2>Calculando las métricas</h2><p>Estamos consultando la actividad del período seleccionado.</p></section>}
    {report && <>
      <div className="agent-metrics-summary">
        <section className="panel"><Users size={19}/><strong>{total.open}</strong><span>Tickets asignados en curso</span><small>Carga actual, independiente del período</small></section>
        <section className="panel"><BarChart3 size={19}/><strong>{total.resolutions}</strong><span>Resoluciones registradas</span><small>Dentro del período seleccionado</small></section>
        <section className="panel"><ShieldCheck size={19}/><strong>{percentage(total.measured ? 100 * total.met / total.measured : null)}</strong><span>Cumplimiento del SLA</span><small>{total.measured ? `${total.met} de ${total.measured} resoluciones a tiempo` : 'Aún no hay resoluciones medidas'}</small></section>
      </div>
      <section className="panel">
        <div className="section-head"><h2>Resultados por agente</h2><span>{rows.length} integrantes</span></div>
        {rows.length === 0 ? <div className="agent-metrics-empty"><Users size={28}/><h3>Aún no hay integrantes para mostrar</h3><p>Las cuentas del equipo aparecerán aquí cuando estén disponibles.</p></div> : <>
          {total.replies === 0 && total.resolutions === 0 && <p className="agent-metrics-no-activity">No hay actividad medida en este período. La tabla conserva la carga actual del equipo.</p>}
          <div className="agent-metrics-table-wrap"><table><caption>Las respuestas y resoluciones corresponden al período; abiertos y pendientes muestran la carga actual.</caption><thead><tr><th scope="col">Agente</th><th scope="col">Abiertos</th><th scope="col">Pendientes</th><th scope="col">Respuestas públicas</th><th scope="col">Primera respuesta</th><th scope="col">Resoluciones</th><th scope="col">Tiempo de resolución</th><th scope="col">SLA cumplido</th></tr></thead><tbody>{rows.map(row => <tr key={row.memberId}><th scope="row"><strong>{row.name}</strong><small>{row.status === 'active' ? 'Activo' : row.status === 'invited' ? 'Invitación pendiente' : 'Acceso revocado'}{row.role === 'client' ? ' · Integrante anterior' : ''}</small></th><td>{row.currentOpen}</td><td>{row.currentPending}</td><td>{row.publicReplies}</td><td>{hours(row.averageFirstResponseHours)}<small>{row.firstResponseCount} {row.firstResponseCount === 1 ? 'medición' : 'mediciones'}</small></td><td>{row.resolutions}</td><td>{hours(row.averageResolutionHours)}<small>{row.measurableResolutions} {row.measurableResolutions === 1 ? 'medición' : 'mediciones'}</small></td><td>{percentage(row.slaCompliancePercent)}<small>{row.slaMet} a tiempo · {row.slaBreached} fuera de plazo</small></td></tr>)}</tbody></table></div>
        </>}
      </section>
      <section className="panel agent-metrics-notes" aria-labelledby="metrics-coverage-title"><Clock3 size={18}/><div><h2 id="metrics-coverage-title">Cómo leer estos resultados</h2><p>La primera respuesta se atribuye a quien envió la primera respuesta pública del equipo. Las notas internas no cuentan como respuesta al cliente.</p><p>El cumplimiento del SLA y la duración de resolución se calculan con las resoluciones registradas desde esta actualización, conservando el plazo que tenían al resolverse. Los tickets reabiertos pueden tener más de una resolución.</p><p>Al filtrar por empresa, las resoluciones mantienen la empresa que tenían al resolverse; las respuestas y la carga usan la empresa actual del ticket.</p>{report.coverage.historicalResolvedWithoutMeasurement > 0 && <p>{report.coverage.historicalResolvedWithoutMeasurement} tickets ya resueltos no tienen una medición histórica del SLA; no se recalifican.</p>}{(report.coverage.unknownPublicReplies > 0 || report.coverage.unknownFirstResponseTickets > 0 || report.coverage.unattributedResolutions > 0) && <p className="agent-metrics-coverage-warning">Datos excluidos por autoría incompleta: {report.coverage.unknownPublicReplies} respuestas públicas, {report.coverage.unknownFirstResponseTickets} primeras respuestas y {report.coverage.unattributedResolutions} resoluciones.</p>}</div></section>
    </>}
  </div>;
}
