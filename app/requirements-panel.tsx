'use client';
import { daybookFetch } from '@/lib/browser-request';
import { navigateDesk } from '@/lib/desk-url';
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { STAGE_LABELS, delayReasonLabel } from '../lib/fulfillment-model';
import { formatDay } from '../lib/fulfillment-display';
import { REQUIREMENTS } from '../lib/ticket-category-model';
import type { FulfillmentListFilter, FulfillmentListItem } from '../lib/fulfillment';
import { DeskLink } from './desk-parts/shared';
import './fulfillment-panel.css';

const FILTERS: { id: FulfillmentListFilter; label: string }[] = [
  { id: 'active', label: 'En curso' },
  { id: 'requested', label: 'Solicitados' },
  { id: 'in_progress', label: 'En gestión' },
  { id: 'ready', label: 'Listos para entregar' },
  { id: 'overdue', label: 'Atrasados' },
  { id: 'closed', label: 'Cerrados' },
];
type Listing = { items: FulfillmentListItem[]; counts: Record<FulfillmentListFilter, number>; today: string };
const number = (id: number) => `#${String(id).padStart(4, '0')}`;
const requirementName = (id: string | null) => REQUIREMENTS.find(item => item.id === id)?.label ?? 'Requerimiento';

/** "Requerimientos": every followed requirement by stage, with the committed date and whether it is late (F6-B2). */
export function RequirementsPanel({ memberId, refreshKey }: { memberId: string; refreshKey?: string }) {
  const [filter, setFilter] = useState<FulfillmentListFilter>('active');
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
  return (
    <div className="requirements-panel">
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
        {!data && loading && <p className="panel-help">Cargando requerimientos…</p>}
        {data && !data.items.length && (
          <p className="panel-help">
            {filter === 'active'
              ? 'No hay requerimientos en curso. Desde un ticket clasificado como requerimiento, usa «Seguir como requerimiento».'
              : 'No hay requerimientos en esta lista.'}
          </p>
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
