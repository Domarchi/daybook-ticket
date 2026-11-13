'use client';
import { daybookFetch } from '@/lib/browser-request';
import { useEffect, useState } from 'react';
import { AlertTriangle, PackageCheck } from 'lucide-react';
import { STAGE_LABELS, STAGE_DESCRIPTIONS, delayReasonLabel, isFinalStage } from '../lib/fulfillment-model';
import { describeFulfillmentEvent, formatDay } from '../lib/fulfillment-display';
import { REQUIREMENTS } from '../lib/ticket-category-model';
import type { FulfillmentView, OwnFulfillment } from '../lib/fulfillment';
import { TrackingLine } from './fulfillment-panel';
import './fulfillment-panel.css';

const number = (id: number) => `#${String(id).padStart(4, '0')}`;
const requirementName = (id: string | null) => REQUIREMENTS.find(item => item.id === id)?.label ?? 'Requerimiento';

function useJson<T>(memberId: string, path: string, refreshKey: string | number | undefined): T | null {
  const key = `${memberId}:${path}:${refreshKey ?? ''}`;
  const [state, setState] = useState<{ key: string; value: T | null }>({ key: '', value: null });
  useEffect(() => {
    const controller = new AbortController();
    daybookFetch(path, { cache: 'no-store', headers: { 'X-Daybook-Member-Id': memberId }, signal: controller.signal })
      .then(async response => {
        if (response.ok) setState({ key, value: (await response.json()) as T });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [memberId, path, key]);
  return state.key === key ? state.value : null;
}

/** "Mis requerimientos" in the client portal: what was asked for, where it is and when it is expected. */
export function ClientRequirementsList({
  memberId,
  refreshKey,
  onOpen,
}: {
  memberId: string;
  refreshKey?: string | number;
  onOpen: (ticketId: number) => void;
}) {
  const data = useJson<{ items: OwnFulfillment[] }>(memberId, '/api/fulfillments/mine', refreshKey);
  if (!data?.items.length) return null;
  return (
    <section className="own-equipment client-requirements" aria-labelledby="client-requirements-title">
      <h2 id="client-requirements-title">
        <PackageCheck size={17} aria-hidden="true" />
        Mis requerimientos
      </h2>
      <ul>
        {data.items.map(item => (
          <li key={item.ticketId} className={item.overdue ? 'is-late' : ''}>
            <button type="button" onClick={() => onOpen(item.ticketId)}>
              <strong>
                {number(item.ticketId)} · {item.subject}
              </strong>
              <span>
                {requirementName(item.requirement)} · {STAGE_LABELS[item.stage]}
                {!isFinalStage(item.stage) && item.expectedOn ? ` · para el ${formatDay(item.expectedOn)}` : ''}
              </span>
              {item.overdue && (
                <span className="fulfillment-late">
                  <AlertTriangle size={13} aria-hidden="true" />
                  Atrasado
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The tracking line of a requirement inside a portal ticket, with dates and delay reasons. */
export function ClientRequirementTracking({
  memberId,
  ticketId,
  refreshKey,
}: {
  memberId: string;
  ticketId: number;
  refreshKey?: string | number;
}) {
  const view = useJson<FulfillmentView>(memberId, `/api/tickets/${ticketId}/fulfillment`, refreshKey);
  const current = view?.fulfillment;
  if (!view || !current) return null;
  return (
    <section className="fulfillment-panel client-tracking" aria-labelledby={`client-tracking-${ticketId}`}>
      <h2 id={`client-tracking-${ticketId}`}>
        <PackageCheck size={17} aria-hidden="true" />
        Seguimiento de tu requerimiento
        {current.overdue && (
          <span className="fulfillment-late">
            <AlertTriangle size={13} aria-hidden="true" />
            Atrasado
          </span>
        )}
      </h2>
      <TrackingLine stage={current.stage} cancelledFrom={current.cancelledFrom} />
      <p className="fulfillment-help">{STAGE_DESCRIPTIONS[current.stage]}</p>
      <dl className="fulfillment-facts">
        {!isFinalStage(current.stage) && (
          <div>
            <dt>Fecha comprometida</dt>
            <dd>{current.expectedOn ? formatDay(current.expectedOn) : 'Te avisaremos cuando la tengamos'}</dd>
          </div>
        )}
        {current.delayReason && !isFinalStage(current.stage) && (
          <div>
            <dt>Motivo del retraso</dt>
            <dd>
              {delayReasonLabel(current.delayReason)}
              {current.delayNote ? ` · ${current.delayNote}` : ''}
            </dd>
          </div>
        )}
        {current.stage === 'cancelled' && current.cancelReason && (
          <div>
            <dt>Motivo de cancelación</dt>
            <dd>{current.cancelReason}</dd>
          </div>
        )}
      </dl>
      {view.events.length > 0 && (
        <ol className="client-tracking-history" aria-label="Historial del requerimiento">
          {view.events
            .slice()
            .reverse()
            .map(event => (
              <li key={event.id}>
                <time dateTime={event.createdAt}>
                  {new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' }).format(
                    new Date(event.createdAt),
                  )}
                </time>
                <span>{describeFulfillmentEvent(event.action, event.afterValue)}</span>
              </li>
            ))}
        </ol>
      )}
    </section>
  );
}
