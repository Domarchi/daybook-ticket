'use client';
import { daybookFetch } from '@/lib/browser-request';
import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, PackageCheck } from 'lucide-react';
import {
  DELAY_REASONS,
  STAGE_LABELS,
  delayReasonLabel,
  stageChangeProblem,
  stageOptions,
  trackingSteps,
  type FulfillmentStage,
} from '../lib/fulfillment-model';
import { describeFulfillmentEvent, formatDay } from '../lib/fulfillment-display';
import type { FulfillmentView } from '../lib/fulfillment';
import type { DeskRun } from './desk-parts/shared';
import './fulfillment-panel.css';

async function call<T>(memberId: string, path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await daybookFetch(path, {
    method,
    cache: 'no-store',
    headers: { 'X-Daybook-Member-Id': memberId, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result && typeof result === 'object' && 'error' in result ? result.error : null;
    throw new Error(typeof message === 'string' ? message : 'No se pudo completar la operación.');
  }
  return result as T;
}

/** The tracking line: done, current and pending steps, like a parcel being followed. */
export function TrackingLine({
  stage,
  cancelledFrom,
}: {
  stage: FulfillmentStage;
  cancelledFrom?: FulfillmentStage | null;
}) {
  return (
    <ol className="tracking-line" aria-label="Avance del requerimiento">
      {trackingSteps(stage, cancelledFrom).map(step => (
        <li
          key={step.stage}
          className={`is-${step.state}${step.stage === 'cancelled' ? ' is-cancelled' : ''}`}
          aria-current={step.state === 'current' ? 'step' : undefined}
        >
          <span aria-hidden="true" />
          {step.label}
          <span className="sr-only">
            {step.state === 'done' ? ' (hecho)' : step.state === 'current' ? ' (etapa actual)' : ' (pendiente)'}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** "Seguimiento del requerimiento" inside a ticket, for the staff (F6-B2). */
export function FulfillmentPanel({
  memberId,
  ticketId,
  refreshKey,
  busy,
  run,
}: {
  memberId: string;
  ticketId: number;
  refreshKey?: string | number;
  busy: boolean;
  run: DeskRun;
}) {
  const [view, setView] = useState<FulfillmentView | null>(null);
  const [reload, setReload] = useState(0);
  const [delaying, setDelaying] = useState(false);
  const [target, setTarget] = useState<FulfillmentStage | ''>('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    let cancelled = false;
    call<FulfillmentView>(memberId, `/api/tickets/${ticketId}/fulfillment`)
      .then(value => {
        if (!cancelled) setView(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [memberId, ticketId, refreshKey, reload]);

  if (!view || (!view.fulfillment && !view.canStart)) return null;
  const act = async (action: () => Promise<unknown>, message: string) => {
    const done = await run(action, message);
    if (done) {
      setReload(value => value + 1);
      setTarget('');
      setReason('');
      setDelaying(false);
    }
    return done;
  };
  const path = `/api/tickets/${ticketId}/fulfillment`;

  if (!view.fulfillment)
    return (
      <section className="fulfillment-panel" aria-labelledby={`fulfillment-${ticketId}`}>
        <h3 id={`fulfillment-${ticketId}`}>
          <PackageCheck size={17} aria-hidden="true" />
          Seguimiento del requerimiento
        </h3>
        <p className="fulfillment-help">
          Este ticket pide algo. Síguelo por etapas para que el cliente vea el avance y los retrasos.
        </p>
        <form
          className="fulfillment-inline"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const expectedOn = String(new FormData(event.currentTarget).get('expectedOn') ?? '');
            void act(
              () => call(memberId, path, 'POST', { expectedOn: expectedOn || null }),
              'Requerimiento en seguimiento',
            );
          }}
        >
          <label>
            Fecha comprometida (opcional)
            <input type="date" name="expectedOn" min={view.today} disabled={busy} />
          </label>
          <button className="primary" disabled={busy}>
            Seguir como requerimiento
          </button>
        </form>
      </section>
    );

  const current = view.fulfillment;
  const options = stageOptions(current.stage).filter(stage => stage !== 'delivered');
  const needsReason = target !== '' && stageChangeProblem(current.stage, target, '') !== null;
  return (
    <section className="fulfillment-panel" aria-labelledby={`fulfillment-${ticketId}`}>
      <h3 id={`fulfillment-${ticketId}`}>
        <PackageCheck size={17} aria-hidden="true" />
        Seguimiento del requerimiento
        {current.overdue && (
          <span className="fulfillment-late">
            <AlertTriangle size={13} aria-hidden="true" />
            Atrasado
          </span>
        )}
      </h3>
      <TrackingLine stage={current.stage} cancelledFrom={current.cancelledFrom} />
      <dl className="fulfillment-facts">
        <div>
          <dt>Etapa</dt>
          <dd>{STAGE_LABELS[current.stage]}</dd>
        </div>
        <div>
          <dt>Fecha comprometida</dt>
          <dd>{current.expectedOn ? formatDay(current.expectedOn) : 'Sin fecha'}</dd>
        </div>
        {current.delayReason && (
          <div>
            <dt>Último retraso</dt>
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

      {options.length > 0 && (
        <>
          <form
            className="fulfillment-inline"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              if (!target) return;
              void act(
                () =>
                  call(memberId, path, 'PATCH', {
                    action: 'stage',
                    expectedVersion: current.version,
                    stage: target,
                    reason: reason.trim() || null,
                  }),
                `Requerimiento: ${STAGE_LABELS[target]}`,
              );
            }}
          >
            <label>
              Mover a
              <select
                value={target}
                onChange={event => setTarget(event.target.value as FulfillmentStage | '')}
                disabled={busy}
              >
                <option value="">Elige la etapa</option>
                {options.map(stage => (
                  <option key={stage} value={stage}>
                    {STAGE_LABELS[stage]}
                  </option>
                ))}
              </select>
            </label>
            {needsReason && (
              <label className="fulfillment-wide">
                Motivo (lo verá el cliente)
                <input
                  value={reason}
                  onChange={event => setReason(event.target.value)}
                  maxLength={500}
                  required
                  disabled={busy}
                />
              </label>
            )}
            <button className="secondary" disabled={busy || !target}>
              Cambiar etapa
            </button>
          </form>

          {!current.expectedOn && (
            <form
              className="fulfillment-inline"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                const expectedOn = String(new FormData(event.currentTarget).get('expectedOn') ?? '');
                void act(
                  () => call(memberId, path, 'PATCH', { action: 'date', expectedVersion: current.version, expectedOn }),
                  'Fecha comprometida guardada',
                );
              }}
            >
              <label>
                Fecha comprometida
                <input type="date" name="expectedOn" min={view.today} required disabled={busy} />
              </label>
              <button className="secondary" disabled={busy}>
                Guardar fecha
              </button>
            </form>
          )}

          {delaying ? (
            <form
              className="fulfillment-inline fulfillment-delay"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                const values = new FormData(event.currentTarget);
                void act(
                  () =>
                    call(memberId, path, 'PATCH', {
                      action: 'delay',
                      expectedVersion: current.version,
                      reason: String(values.get('reason') ?? ''),
                      note: String(values.get('note') ?? '').trim() || null,
                      newExpectedOn: String(values.get('newExpectedOn') ?? ''),
                    }),
                  'Retraso informado',
                );
              }}
            >
              <label>
                Motivo del retraso
                <select name="reason" required defaultValue="" disabled={busy}>
                  <option value="" disabled>
                    Elige el motivo
                  </option>
                  {DELAY_REASONS.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Nueva fecha comprometida
                <input type="date" name="newExpectedOn" min={view.today} required disabled={busy} />
              </label>
              <label className="fulfillment-wide">
                Nota para el cliente (obligatoria si el motivo es «Otro»)
                <input name="note" maxLength={500} disabled={busy} />
              </label>
              <div className="fulfillment-actions">
                <button type="button" className="secondary" disabled={busy} onClick={() => setDelaying(false)}>
                  Cancelar
                </button>
                <button className="primary" disabled={busy}>
                  Informar retraso
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="text-button" disabled={busy} onClick={() => setDelaying(true)}>
              Informar retraso
            </button>
          )}
        </>
      )}

      {view.events.length > 0 && (
        <details className="fulfillment-history">
          <summary>Historial del seguimiento ({view.events.length})</summary>
          <ol>
            {view.events.map(event => (
              <li key={event.id}>
                <span>{describeFulfillmentEvent(event.action, event.afterValue)}</span>
                <small>
                  {event.actorName} ·{' '}
                  {new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' }).format(
                    new Date(event.createdAt),
                  )}
                </small>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
