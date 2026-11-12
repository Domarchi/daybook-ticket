'use client';
/**
 * A change Bita proposes, under her answer (feature 6). It shows exactly what will change and does nothing until the
 * person presses "Confirmar"; then it calls the same routes as the ticket page, with their permissions and version
 * checks, and the change is recorded in the ticket's history under the person's name. "Descartar" just hides it.
 * Bita never calls these routes herself: only this click does.
 */
import { readDaybookJson } from '@/lib/browser-json';
import { daybookFetch } from '@/lib/browser-request';
import type { ActionOffer } from '@/lib/assistant-ui';
import { Check, LoaderCircle, X } from 'lucide-react';
import { useRef, useState } from 'react';

const isObjectResponse = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** The request the ticket page itself would send for this change. */
export function confirmationRequest(
  offer: ActionOffer,
  operationId: string,
  version: number = offer.version,
): { path: string; init: RequestInit } {
  const change = offer.change;
  if (change.type === 'note')
    return {
      path: `/api/tickets/${offer.ticketId}/messages`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operationId, kind: 'note', body: change.body, bodyFormat: 'plain' }),
      },
    };
  const body =
    change.type === 'assign'
      ? { assigneeMemberId: change.memberId }
      : change.type === 'status'
        ? { status: change.to }
        : {
            category: {
              faultGroup: change.faultGroup,
              faultElement: change.faultElement,
              requirement: change.requirement,
            },
          };
  return {
    path: `/api/tickets/${offer.ticketId}`,
    init: {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, expectedVersion: version }),
    },
  };
}

function Detail({ offer }: { offer: ActionOffer }) {
  const change = offer.change;
  if (change.type === 'assign')
    return (
      <p>
        Responsable: {change.fromName || 'sin asignar'} → <strong>{change.memberName}</strong>
      </p>
    );
  if (change.type === 'status')
    return (
      <p>
        Estado: {change.fromLabel} → <strong>{change.toLabel}</strong>
      </p>
    );
  if (change.type === 'category')
    return (
      <p>
        Categoría: {change.fromLabel} → <strong>{change.toLabel}</strong>
      </p>
    );
  return (
    <>
      <p>Nota interna (solo la ve el equipo):</p>
      <blockquote>{change.body}</blockquote>
    </>
  );
}

/** The ticket's version after a change the person confirmed here, when the route returned it. */
export function versionAfter(result: Record<string, unknown>): number | null {
  const ticket = result.ticket;
  if (!ticket || typeof ticket !== 'object') return null;
  const version = (ticket as { version?: unknown }).version;
  return Number.isSafeInteger(version) ? Number(version) : null;
}

export function BitaActionCard({
  offer,
  knownVersion,
  onDone,
  onOpenTicket,
}: {
  offer: ActionOffer;
  /** The version left by a change confirmed in this chat, so a second proposal on the same ticket does not trip on
   * the first one. A change made by anybody else still makes the route answer 409. */
  knownVersion?: number;
  onDone: (ticketId: number, version: number | null) => void;
  onOpenTicket: (id: number) => void;
}) {
  const [state, setState] = useState<'pending' | 'busy' | 'done' | 'failed' | 'dismissed'>('pending');
  const [note, setNote] = useState('');
  const operationId = useRef<string | null>(null);

  const confirm = async () => {
    if (state === 'busy' || state === 'done') return;
    setState('busy');
    setNote('');
    try {
      // One operation id per card: a retry after a cut connection never adds the note twice.
      operationId.current ??= crypto.randomUUID();
      const version = Math.max(offer.version, knownVersion ?? 0);
      const { path, init } = confirmationRequest(offer, operationId.current, version);
      const result = await readDaybookJson(await daybookFetch(path, init), { validate: isObjectResponse });
      setState('done');
      setNote('Hecho. Queda en el historial del ticket a tu nombre.');
      onDone(offer.ticketId, versionAfter(result));
    } catch (failure) {
      setState('failed');
      setNote(failure instanceof Error ? failure.message : 'No se pudo hacer el cambio.');
    }
  };

  if (state === 'dismissed')
    return (
      <p className="bita-action-dismissed" role="status">
        Descartaste: {offer.summary}.
      </p>
    );
  return (
    <section className={`bita-action ${state}`} aria-label={`Propuesta de Bita: ${offer.summary}`}>
      <p className="bita-action-title">
        <strong>{offer.summary}</strong>{' '}
        <button
          type="button"
          className="bita-link"
          aria-label={`Abrir el ticket ${offer.ticketId}`}
          onClick={() => onOpenTicket(offer.ticketId)}
        >
          #{offer.ticketId}
        </button>{' '}
        {offer.subject}
      </p>
      <Detail offer={offer} />
      {state === 'done' ? (
        <p className="bita-action-note" role="status">
          <Check size={14} /> {note}
        </p>
      ) : (
        <>
          <div className="bita-action-buttons">
            <button type="button" className="primary" onClick={() => void confirm()} disabled={state === 'busy'}>
              {state === 'busy' ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}
              {state === 'busy' ? 'Guardando…' : 'Confirmar'}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setState('dismissed')}
              disabled={state === 'busy'}
            >
              <X size={15} /> Descartar
            </button>
          </div>
          {state === 'failed' ? (
            <p className="bita-action-note failed" role="alert">
              {note}
            </p>
          ) : (
            <p className="bita-action-note">Bita no hace nada hasta que confirmes.</p>
          )}
        </>
      )}
    </section>
  );
}
