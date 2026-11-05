'use client';

import { useEffect, useState } from 'react';
import { ArrowDownToLine, RefreshCw, Star } from 'lucide-react';
import type { CustomerCompany, Member } from '@/lib/types';
import { metricsCsvCell, metricsDate, shiftMetricsDate } from '@/lib/agent-metrics-model';
import type { SatisfactionAggregate, SatisfactionReport } from '@/lib/satisfaction-model';
import './satisfaction.css';

const number = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });
const format = (value: number | null, suffix = '') => value === null ? 'Sin datos' : `${number.format(value)}${suffix}`;
function ResultsTable({ title, rows }: { title: string; rows: SatisfactionAggregate[] }) {
  return <section className="panel service-plus-panel"><div className="section-head"><h3>{title}</h3></div>{rows.length ? <div className="satisfaction-table-wrap"><table><thead><tr><th scope="col">Nombre</th><th scope="col">Solicitadas</th><th scope="col">Respondidas</th><th scope="col">Promedio</th><th scope="col">4–5 estrellas</th></tr></thead><tbody>{rows.map(row => <tr key={row.id || 'none'}><th scope="row">{row.name}</th><td>{row.invitations}</td><td>{row.responses}</td><td>{format(row.averageScore, '/5')}</td><td>{format(row.positivePercent, ' %')}</td></tr>)}</tbody></table></div> : <p className="service-plus-body service-plus-muted">Aún no hay cierres con una evaluación solicitada en este período.</p>}</section>;
}
export function SatisfactionReportPanel({ memberId, companies, members }: { memberId: string; companies: CustomerCompany[]; members: Member[] }) {
  const [today] = useState(() => metricsDate(new Date()));
  const [filters, setFilters] = useState(() => ({ from: shiftMetricsDate(today, -29), to: today, companyId: '', agentId: '' }));
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; report: SatisfactionReport | null; error: string } | null>(null);
  const query = new URLSearchParams(filters).toString(), key = `${memberId}:${query}:${revision}`;
  const current = result?.key === key ? result : null;
  const incomplete = !filters.from || !filters.to;
  useEffect(() => {
    if (incomplete) return;
    const controller = new AbortController();
    void fetch(`/api/satisfaction?${query}`, { cache: 'no-store', headers: { 'X-Daybook-Member-Id': memberId }, signal: controller.signal })
      .then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error || 'No se pudieron consultar las evaluaciones.'); if (!controller.signal.aborted) setResult({ key, report: value, error: '' }); })
      .catch(failure => { if (!controller.signal.aborted) setResult({ key, report: null, error: failure instanceof Error ? failure.message : 'No se pudieron consultar las evaluaciones.' }); });
    return () => controller.abort();
  }, [incomplete, key, memberId, query]);
  const report = current?.report;
  const exportSummary = () => {
    if (!report) return;
    const rows: (string | number | null)[][] = [['Desde', report.period.from, 'Hasta', report.period.to], ['Grupo', 'Nombre', 'Solicitadas', 'Respondidas', 'Promedio', '4-5 estrellas (%)'],
      ...report.agents.map(row => ['Agente', row.name, row.invitations, row.responses, row.averageScore, row.positivePercent]),
      ...report.companies.map(row => ['Empresa', row.name, row.invitations, row.responses, row.averageScore, row.positivePercent])];
    const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(row => row.map(metricsCsvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `satisfaccion-${report.period.from}-${report.period.to}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  return <section className="satisfaction-report" aria-labelledby="satisfaction-report-title">
    <div className="section-head"><div><span className="eyebrow">LA VOZ DE TUS CLIENTES</span><h2 id="satisfaction-report-title"><Star size={20}/>Satisfacción de la atención</h2></div><div className="service-plus-actions"><button type="button" className="secondary" disabled={!report} onClick={exportSummary}><ArrowDownToLine size={15}/>Exportar resumen CSV</button><button type="button" className="secondary" onClick={() => setRevision(value => value + 1)}><RefreshCw size={15}/>Actualizar evaluaciones</button></div></div>
    <div className="panel service-plus-body service-plus-filter-row"><label>Desde<input type="date" value={filters.from} max={filters.to || today} onChange={event => setFilters(value => ({ ...value, from: event.target.value }))}/></label><label>Hasta<input type="date" value={filters.to} min={filters.from} max={today} onChange={event => setFilters(value => ({ ...value, to: event.target.value }))}/></label><label>Empresa<select value={filters.companyId} onChange={event => setFilters(value => ({ ...value, companyId: event.target.value }))}><option value="">Todas las empresas</option>{companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><label>Agente que resolvió<select value={filters.agentId} onChange={event => setFilters(value => ({ ...value, agentId: event.target.value }))}><option value="">Todo el equipo</option>{members.filter(member => member.role !== 'client').map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label></div>
    <p className="service-plus-muted">Fechas del cierre en Santiago. Las evaluaciones conservan la empresa y la persona que resolvió ese ciclo. Los cierres anteriores a esta función no se reconstruyen.</p>
    {incomplete && <p role="status">Selecciona ambas fechas para consultar.</p>}{!incomplete && !current && <p role="status">Consultando evaluaciones…</p>}{current?.error && <p className="service-plus-error" role="alert">{current.error}</p>}
    {report && <><div className="satisfaction-summary"><article className="panel"><strong>{format(report.totals.averageScore, '/5')}</strong><span>Calificación promedio</span></article><article className="panel"><strong>{report.totals.responses}/{report.totals.invitations}</strong><span>Evaluaciones recibidas / solicitadas</span></article><article className="panel"><strong>{format(report.totals.positivePercent, ' %')}</strong><span>Evaluaciones de 4–5 estrellas</span></article></div><ResultsTable title="Por agente" rows={report.agents}/><ResultsTable title="Por empresa" rows={report.companies}/><section className="panel service-plus-panel"><div className="section-head"><h3>Opiniones recientes</h3><span>Hasta 50 evaluaciones</span></div>{report.recent.length ? <div className="satisfaction-opinions">{report.recent.map(row => <article key={row.id}><strong>Ticket #{row.ticketId} · {row.score}/5</strong><small>{row.agent} · {row.company}</small>{row.comment ? <p>{row.comment}</p> : <p className="service-plus-muted">Sin comentario adicional.</p>}</article>)}</div> : <p className="service-plus-body service-plus-muted">Todavía no hay respuestas de clientes en este período.</p>}</section></>}
  </section>;
}
