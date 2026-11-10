'use client';
import { daybookFetch } from '@/lib/browser-request';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mail, RefreshCw } from 'lucide-react';
import './email-inbound.css';

type Receipt = {
  providerId: string;
  status: 'processed' | 'ignored';
  reasonCode: string | null;
  ticketId: number | null;
  createdAt: string;
};
type JobStatus = 'pending' | 'processing' | 'retry' | 'processed' | 'rejected' | 'failed';
type Job = {
  providerId: string;
  status: JobStatus;
  reasonCode: string | null;
  ticketId: number | null;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  nextAttemptAt: string | null;
  retryable: boolean;
  manualRetries: number;
};
type State = {
  configured: boolean;
  domain?: string | null;
  address: string | null;
  recent?: Receipt[];
  jobs?: Job[];
  health?: {
    counts: Record<JobStatus, number>;
    oldestPendingAt: string | null;
    lastProcessedAt: string | null;
    lastFailureAt: string | null;
  };
};
const STATUSES: Record<JobStatus, string> = {
  pending: 'Pendiente',
  processing: 'Incorporando',
  retry: 'Reintento programado',
  processed: 'Incorporado',
  rejected: 'No incorporado',
  failed: 'Necesita atención',
};
const date = (value: string) =>
  new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Santiago' }).format(
    new Date(value),
  );
const REASONS: Record<string, string> = {
  authentication_required: 'El remitente no superó la autenticación de correo.',
  automatic_message: 'Respuesta automática o lista de distribución.',
  empty_message: 'Sin texto nuevo para incorporar.',
  attachments_use_portal: 'Contiene archivos: debe enviarse desde el portal.',
  inactive_client: 'La cuenta cliente ya no está activa.',
  sender_changed: 'Cambió la cuenta o el correo autorizado.',
  hourly_limit: 'Límite de 60 mensajes por hora alcanzado.',
  ticket_access_revoked: 'La cuenta perdió acceso a este ticket.',
  provider_unavailable: 'El proveedor no está disponible. Se volverá a intentar.',
  storage_unavailable: 'El almacenamiento privado no está disponible. Se volverá a intentar.',
  pending_attachment_quota:
    'La cuenta tiene demasiados archivos pendientes. La incorporación se conserva para reintentar.',
  attachment_invalid: 'Algún archivo no cumple los formatos o la validación de contenido.',
  attachment_limit: 'Se admiten hasta 5 archivos de 10 MiB cada uno.',
  attachment_changed: 'Los metadatos de un archivo cambiaron. Se requiere revisión.',
  invalid_inline_logo_url: 'No se pudo verificar la dirección de descarga del proveedor.',
  inline_logo_too_large: 'La descarga del proveedor superó el límite permitido.',
  processing_unavailable: 'No se pudo terminar la incorporación. Se volverá a intentar.',
  retry_exhausted: 'Se agotaron los intentos automáticos.',
};

export function EmailInboundPanel({ memberId, administrator = false }: { memberId: string; administrator?: boolean }) {
  const [state, setState] = useState<State | null>(null),
    [error, setError] = useState('');
  const [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const [retrying, setRetrying] = useState<string | null>(null);
  const retryKeys = useRef(new Map<string, string>());
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    void daybookFetch('/api/email-inbound', {
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'X-Daybook-Member-Id': memberId },
    })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'No se pudo consultar el correo entrante.');
        return result as State;
      })
      .then(result => {
        if (!controller.signal.aborted) {
          setState(result);
          setError('');
          setLoading(false);
        }
      })
      .catch(failure => {
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : 'No se pudo consultar el correo entrante.');
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [memberId, revision]);
  const active = state?.health
    ? state.health.counts.pending + state.health.counts.processing + state.health.counts.retry
    : 0;
  useEffect(() => {
    if (!administrator || !active) return;
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, 10000);
    return () => clearInterval(timer);
  }, [active, administrator, refresh]);
  const retry = async (providerId: string) => {
    if (retrying) return;
    const operationId = retryKeys.current.get(providerId) || crypto.randomUUID();
    retryKeys.current.set(providerId, operationId);
    setRetrying(providerId);
    setError('');
    try {
      const response = await daybookFetch(`/api/email-inbound/${providerId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Daybook-Member-Id': memberId },
        body: JSON.stringify({ operationId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo reintentar el ingreso.');
      retryKeys.current.delete(providerId);
      refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo reintentar el ingreso.');
    } finally {
      setRetrying(null);
    }
  };
  return (
    <section className="email-inbound-panel" aria-labelledby={`email-inbound-${memberId}`}>
      <div className="email-inbound-heading">
        <h2 id={`email-inbound-${memberId}`}>
          <Mail size={18} />
          Soporte por correo
        </h2>
        <button type="button" className="icon-button" aria-label="Actualizar correo entrante" onClick={refresh}>
          <RefreshCw size={16} />
        </button>
      </div>
      {loading && <p role="status">Consultando correo entrante…</p>}
      {error && <p role="alert">{error}</p>}
      {state &&
        (state.configured ? (
          <>
            <p>
              {administrator
                ? 'El correo entrante está conectado. Cada cliente activo tiene una dirección privada para crear solicitudes; las respuestas usan la dirección única del aviso recibido.'
                : 'Crea una solicitud escribiendo desde tu correo registrado a esta dirección privada. Para responder un ticket, responde al aviso del equipo.'}
            </p>
            {state.address && (
              <a className="email-inbound-address" href={`mailto:${state.address}`}>
                {state.address}
              </a>
            )}
            <p className="email-inbound-help">
              Se incorpora el texto nuevo y hasta 5 archivos de 10 MiB: imágenes, PDF, TXT, CSV, DOCX y XLSX sin macros.
              Conserva tu dirección privada y usa la cuenta con la que ingresas a Daybook.
            </p>
          </>
        ) : (
          <p>
            {administrator
              ? 'La recepción está preparada. Falta conectar el dominio de recepción y el webhook del proveedor antes de activarla.'
              : 'Por ahora, crea y responde tus solicitudes desde este portal. Tu equipo avisará cuando puedas hacerlo también por correo.'}
          </p>
        ))}
      {administrator && state?.health && (
        <div className="email-inbound-health" aria-label="Salud de recepción">
          <div className="email-inbound-counts">
            <span>
              <strong>{active}</strong> pendientes
            </span>
            <span>
              <strong>{state.health.counts.failed}</strong> requieren atención
            </span>
            <span>
              <strong>{state.health.counts.processed}</strong> incorporados
            </span>
          </div>
          {!state.configured && active > 0 && (
            <p role="status">Los ingresos pendientes se conservan mientras la recepción está en pausa.</p>
          )}
          {state.health.lastProcessedAt && <p>Última incorporación: {date(state.health.lastProcessedAt)}.</p>}
          {state.health.oldestPendingAt && (
            <p>El ingreso pendiente más antiguo llegó el {date(state.health.oldestPendingAt)}.</p>
          )}
          <h3>Últimos ingresos</h3>
          {state.jobs?.length ? (
            <ul className="email-inbound-jobs">
              {state.jobs.map(job => (
                <li key={job.providerId}>
                  <div>
                    <strong>
                      {STATUSES[job.status]}
                      {job.ticketId ? ` · ticket #${job.ticketId}` : ''}
                    </strong>
                    <span>
                      {date(job.createdAt)} · {job.attempts} intentos
                    </span>
                    {job.reasonCode && (
                      <p>{REASONS[job.reasonCode] || 'El ingreso requiere revisión; no se incorporó parcialmente.'}</p>
                    )}
                    {job.nextAttemptAt && <p>Reintento disponible desde: {date(job.nextAttemptAt)}.</p>}
                  </div>
                  {state.configured && job.retryable && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={retrying !== null}
                      onClick={() => void retry(job.providerId)}
                    >
                      {retrying === job.providerId ? 'Programando…' : 'Reintentar incorporación'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>Aún no hay ingresos registrados por el nuevo procesamiento.</p>
          )}
        </div>
      )}
      {administrator && Boolean(state?.recent?.length) && (
        <details className="email-inbound-audit">
          <summary>Recibos de incorporación conservados</summary>
          <ul>
            {state!.recent!.map(receipt => (
              <li key={receipt.providerId}>
                <strong>
                  {receipt.status === 'processed'
                    ? `Incorporado al ticket #${receipt.ticketId}`
                    : 'Correo no incorporado'}
                </strong>
                <span>{date(receipt.createdAt)}</span>
                {receipt.reasonCode && <p>{REASONS[receipt.reasonCode] || 'El correo requiere revisión.'}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
