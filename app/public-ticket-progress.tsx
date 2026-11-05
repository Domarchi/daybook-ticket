'use client';
import {daybookFetch} from '@/lib/browser-request';

import { useEffect, useState } from 'react';
import { Check, Clock3, UserRound } from 'lucide-react';
import type { PublicTicketProgress as Progress } from '@/lib/ticket-presence-model';
import './public-ticket-progress.css';

const date = (value: string) => new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

export function PublicTicketProgress({ ticketId, memberId, version }: { ticketId: number; memberId: string; version: number }) {
  const key = `${memberId}:${ticketId}:${version}`;
  const [state, setState] = useState<{ key: string; value: Progress | null; failed: boolean }>({ key: '', value: null, failed: false });
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await daybookFetch(`/api/tickets/${ticketId}/progress`, { headers: { 'X-Daybook-Member-Id': memberId }, cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Progress unavailable');
        const value = await response.json() as Progress;
        if (!controller.signal.aborted) setState({ key, value, failed: false });
      } catch { if (!controller.signal.aborted) setState({ key, value: null, failed: true }); }
    })();
    return () => controller.abort();
  }, [key, ticketId, memberId]);
  const current = state.key === key ? state : { value: null, failed: false };
  const progress = current.value;
  if (!progress) return <section className="public-ticket-progress is-loading" aria-label="Seguimiento de tu caso" role="status">{current.failed ? 'El seguimiento se actualizará al volver a cargar tu caso.' : 'Actualizando el seguimiento de tu caso…'}</section>;
  const milestones = [
    { label: 'Solicitud recibida', at: progress.receivedAt, done: true },
    { label: 'Primera respuesta', at: progress.firstResponseAt, done: Boolean(progress.firstResponseAt) },
    { label: 'Caso resuelto', at: progress.resolvedAt, done: progress.status === 'resolved' },
  ];
  return <section className="public-ticket-progress" aria-label="Seguimiento de tu caso">
    <div className="public-progress-next"><span className="eyebrow">TU PRÓXIMO PASO</span><p>{progress.nextStep}</p></div>
    <div className="public-progress-details"><div><UserRound size={17} aria-hidden="true"/><span>Te acompaña<strong>{progress.responsibleName || 'Equipo de soporte'}</strong></span></div>
      {progress.deadlineAt && <div><Clock3 size={17} aria-hidden="true"/><span>Plazo vigente<time dateTime={progress.deadlineAt}>{date(progress.deadlineAt)}</time></span></div>}</div>
    <ol className="public-progress-timeline" aria-label="Avance de la solicitud">{milestones.map((milestone, index) => <li key={milestone.label} className={milestone.done ? 'is-complete' : ''}>
      <span className="public-progress-dot" aria-hidden="true">{milestone.done ? <Check size={13}/> : index + 1}</span><div><strong>{milestone.label}</strong>{milestone.at ? <time dateTime={milestone.at}>{date(milestone.at)}</time> : <span>{milestone.done ? 'Completado' : 'Por completar'}</span>}</div>
    </li>)}</ol>
  </section>;
}
