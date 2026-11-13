'use client';
import { daybookFetch } from '@/lib/browser-request';
import { navigateDesk } from '@/lib/desk-url';
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { STAGE_LABELS, delayReasonLabel } from '../lib/fulfillment-model';
import { formatDay, fulfillmentCsv } from '../lib/fulfillment-display';
import { REQUIREMENTS } from '../lib/ticket-category-model';
import type { FulfillmentListFilter, FulfillmentListItem, FulfillmentSummary } from '../lib/fulfillment';
import { ClipboardList, Download } from 'lucide-react';
import { EmptyState, SkeletonList } from './estados';
import { DeskLink } from './desk-parts/shared';
import './fulfillment-panel.css';

const FILTERS: { id: FulfillmentListFilter; label: string }[] = [
  { id: 'active', label: 'En curso' },
  { id: 'requested', label: 'Solicitados' },
  { id: 'in_progress', label: 'En gestión' },
  { id: 'ready', label: 'Listos para entregar' },
  { id: 'overdue', label: 'Atrasados' },
  { id: 'closed', label: 'Cerrados' },
  { id: 'all', label: 'Todos' },
];
type Listing = {
  items: FulfillmentListItem[];
  counts: Record<FulfillmentListFilter, number>;
  summary: FulfillmentSummary;
  today: string;
};
const number = (id: number) => `#${String(id).padStart(4, '0')}`;
const requirementName = (id: string | null) => REQUIREMENTS.find(item => item.id === id)?.label ?? 'Requerimiento';

/** "Requerimientos": every followed requirement by stage, with the committed date and whether it is late (F6-B2). */
export function RequirementsPanel({ memberId, refreshKey }: { memberId: string; refreshKey?: string }) {
  const [filter, setFilter] = useState<FulfillmentListFilter>('active');
  const [exportError, setExportError] = useState('');
  const key = `${filter}:${refreshKey ?? ''}`;
  const [state, setState] = useState<{ key: string; data: Listing | null; error: string }>({
    key: '',
    data: null,
    error: '',
  });
  useEffect(() => {
    const controller = new AbortController();
    daybookFetch(`/api/fulfillments?filter=${filter}`, {
      cache: 'no-store',
      headers: { 'X-Daybook-Member-Id': memberId },
      signal: controller.signal,
    })
      .then(async response => {
        const body = (await response.json().catch(() => ({}))) as Listing & { error?: string };
        if (!response.ok) throw new Error(body.error || 'No se pudo cargar la lista.');
        setState({ key, data: body, error: '' });
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setState(previous => ({ ...previous, key, error: error.message }));
      });
    return () => controller.abort();
  }, [memberId, filter, key]);
  const loading = state.key !== key;

  const data = state.data;
  const exportCsv = async () => {
    setExportError('');
    try {
      const response = await daybookFetch('/api/fulfillments?filter=all', {
        cache: 'no-store',
        headers: { 'X-Daybook-Member-Id': memberId },
      });
      const body = (await response.json().catch(() => ({}))) as Listing & { error?: string };
      if (!response.ok) throw new Error(body.error || 'No se pudo exportar.');
      const url = URL.createObjectURL(
        new Blob(['\uFEFF' + fulfillmentCsv(body.items)], { type: 'text/csv;charset=utf-8' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `requerimientos-${body.today}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError((error as Error).message);
    }
  };
  return (
    <div className="requirements-panel">
      {data && (
        <section className="requirements-summary" aria-label="Resumen de requerimientos">
          <div>
            <strong>{data.summary.delivered}</strong>
            <span>entregados</span>
          </div>
          <div>
            <strong>
              {data.summary.averageDeliveryDays === null
                ? '—'
                : `${data.summary.averageDeliveryDays.toLocaleString('es-CL')} días`}
            </strong>
            <span>tiempo medio de entrega</span>
          </div>
          <div>
            <strong>{data.summary.overduePercent === null ? '—' : `${data.summary.overduePercent} %`}</strong>
            <span>de los abiertos, atrasados</span>
          </div>
          <div>
            <strong>
              {data.summary.topDelayReasons.length
                ? data.summary.topDelayReasons.map(item => `${item.label} (${item.count})`).join(', ')
                : 'Sin retrasos'}
            </strong>
            <span>motivos de retraso más comunes</span>
          </div>
          <button type="button" className="secondary" onClick={() => void exportCsv()}>
            <Download size={15} aria-hidden="true" />
            Exportar CSV
          </button>
        </section>
      )}
      {exportError && (
        <p className="equipment-error" role="alert">
          {exportError}
        </p>
      )}
      <div className="requirements-filters" role="group" aria-label="Mostrar requerimientos">
        {FILTERS.map(item => (
          <button
            key={item.id}
            type="button"
            className={filter === item.id ? 'active' : ''}
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
            <span>{data ? data.counts[item.id] : '·'}</span>
          </button>
        ))}
      </div>
      {state.error && (
        <p className="equipment-error" role="alert">
          {state.error}
        </p>
      )}
      <section className="panel requirements-list" aria-labelledby="requirements-list-title" aria-busy={loading}>
        <div className="section-head">
          <h2 id="requirements-list-title">{FILTERS.find(item => item.id === filter)?.label}</h2>
        </div>
        {!data && loading && <SkeletonList label="Cargando requerimientos…" rows={3} lines={1} />}
        {data && !data.items.length && (
          <EmptyState
            icon={<ClipboardList size={22} />}
            title={filter === 'active' ? 'Sin requerimientos en curso' : 'Sin requerimientos'}
            text={
              filter === 'active'
                ? 'Desde un ticket clasificado como requerimiento, usa «Seguir como requerimiento».'
                : 'No hay requerimientos en esta lista.'
            }
          />
        )}
        {data && data.items.length > 0 && (
          <ul className="requirements-rows">
            {data.items.map(item => (
              <li key={item.ticketId} className={item.overdue ? 'is-late' : ''}>
                <DeskLink
                  className="requirements-main"
                  to={{ ticketId: item.ticketId }}
                  onNavigate={() => navigateDesk({ ticketId: item.ticketId })}
                >
                  <strong>
                    {number(item.ticketId)} · {item.subject}
                  </strong>
                  <span>
                    {item.requesterName} · {requirementName(item.requirement)}
                  </span>
                </DeskLink>
                <div className="requirements-state">
                  <span className="requirements-stage">{STAGE_LABELS[item.stage]}</span>
                  <span>{item.expectedOn ? `Para el ${formatDay(item.expectedOn)}` : 'Sin fecha comprometida'}</span>
                  {item.overdue && (
                    <span className="fulfillment-late">
                      <AlertTriangle size={13} aria-hidden="true" />
                      Atrasado
                    </span>
                  )}
                  {item.delayReason && <small>Retraso: {delayReasonLabel(item.delayReason)}</small>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
