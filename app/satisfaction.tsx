'use client';
import { daybookFetch } from '@/lib/browser-request';
import { isFinished } from '@/lib/ticket-status';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, LoaderCircle, Star } from 'lucide-react';
import {
  satisfactionDraftFor,
  satisfactionScoreLabel,
  type SatisfactionDraft,
  type TicketSatisfaction,
} from '@/lib/satisfaction-model';
import './satisfaction.css';
import { SkeletonList } from './estados';

export function TicketSatisfactionPanel({
  ticketId,
  memberId,
  version,
  status,
}: {
  ticketId: number;
  memberId: string;
  version: number;
  status: string;
}) {
  const [result, setResult] = useState<{ key: string; satisfaction: TicketSatisfaction | null; error: string } | null>(
    null,
  );
  const [draft, setDraft] = useState<SatisfactionDraft | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const saving = useRef(false),
    mounted = useRef(false);
  const operation = useRef<{ payload: string; id: string } | null>(null);
  const key = `${memberId}:${ticketId}:${version}:${status}:${revision}`;
  const current = result?.key === key ? result : null;
  useEffect(() => {
    mounted.current = true;
    if (!isFinished(status))
      return () => {
        mounted.current = false;
      };
    const controller = new AbortController();
    void daybookFetch(`/api/tickets/${ticketId}/satisfaction`, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'X-Daybook-Member-Id': memberId },
    })
      .then(async response => {
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || 'No se pudo consultar la evaluación.');
        if (!controller.signal.aborted) setResult({ key, satisfaction: value.satisfaction, error: '' });
      })
      .catch(failure => {
        if (!controller.signal.aborted)
          setResult({
            key,
            satisfaction: null,
            error: failure instanceof Error ? failure.message : 'No se pudo consultar la evaluación.',
          });
      });
    return () => {
      controller.abort();
      mounted.current = false;
    };
  }, [key, memberId, status, ticketId]);
  if (!isFinished(status)) return null;
  if (!current)
    return (
      <section className="ticket-satisfaction">
        <SkeletonList label="Consultando evaluación…" rows={1} lines={1} />
      </section>
    );
  if (current.error)
    return (
      <section className="ticket-satisfaction">
        <p role="alert" className="service-plus-error">
          {current.error}
        </p>
        <button className="secondary" type="button" onClick={() => setRevision(value => value + 1)}>
          Reintentar evaluación
        </button>
      </section>
    );
  const survey = current.satisfaction;
  if (!survey) return null;
  if (survey.submittedAt)
    return (
      <section className="ticket-satisfaction satisfaction-thanks" role="status">
        <CheckCircle2 size={24} />
        <div>
          <h2>Gracias por tu evaluación</h2>
          <p>
            {survey.score}/5 · {satisfactionScoreLabel(survey.score!)}. Tu opinión nos ayuda a mejorar.
          </p>
          {survey.comment && <p>{survey.comment}</p>}
        </div>
      </section>
    );
  if (!survey.available) return null;
  const { score, comment } = satisfactionDraftFor(draft, survey.id);
  const submit = async () => {
    if (!score || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    const payload = { satisfactionId: survey.id, score, comment };
    const encoded = JSON.stringify(payload);
    if (operation.current?.payload !== encoded) operation.current = { payload: encoded, id: crypto.randomUUID() };
    try {
      const response = await daybookFetch(`/api/tickets/${ticketId}/satisfaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Daybook-Member-Id': memberId },
        body: JSON.stringify({ ...payload, operationId: operation.current.id }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'No se pudo enviar tu evaluación.');
      if (mounted.current) setResult({ key, satisfaction: value.satisfaction, error: '' });
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'No se pudo enviar.');
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <section className="ticket-satisfaction" aria-labelledby={`satisfaction-${ticketId}`}>
      <div>
        <span className="eyebrow">TU OPINIÓN CUENTA</span>
        <h2 id={`satisfaction-${ticketId}`}>¿Cómo fue la atención?</h2>
        <p>Este ticket fue resuelto. Cuéntanos cómo te fue con el equipo de Daybook.</p>
      </div>
      <div className="satisfaction-stars" role="group" aria-label="Calificación de 1 a 5">
        <span className="sr-only">Selecciona una calificación</span>
        {[1, 2, 3, 4, 5].map(value => (
          <button
            key={value}
            type="button"
            aria-label={`${value} de 5: ${satisfactionScoreLabel(value)}`}
            aria-pressed={score === value}
            disabled={busy}
            className={value <= score ? 'selected' : ''}
            onClick={() => setDraft(previous => ({ ...satisfactionDraftFor(previous, survey.id), score: value }))}
          >
            <Star size={26} fill={value <= score ? 'currentColor' : 'none'} />
            <span>{value}</span>
          </button>
        ))}
      </div>
      <p className="satisfaction-selected" aria-live="polite">
        {score ? satisfactionScoreLabel(score) : 'Elige de 1 a 5 estrellas'}
      </p>
      <label>
        Comentario opcional
        <textarea
          maxLength={2000}
          rows={3}
          disabled={busy}
          value={comment}
          onChange={event =>
            setDraft(previous => ({ ...satisfactionDraftFor(previous, survey.id), comment: event.target.value }))
          }
          placeholder="¿Qué hicimos bien o qué podríamos mejorar?"
        />
      </label>
      <small>Tu evaluación será visible para el equipo de Daybook.</small>
      {error && (
        <p className="service-plus-error" role="alert">
          {error}
        </p>
      )}
      <div className="service-plus-actions">
        <button type="button" className="primary" disabled={busy || !score} onClick={() => void submit()}>
          {busy && <LoaderCircle size={15} className="spinning" />}Enviar evaluación
        </button>
      </div>
    </section>
  );
}
