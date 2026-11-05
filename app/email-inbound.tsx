'use client';

import { useCallback, useEffect, useState } from 'react';
import { Mail, RefreshCw } from 'lucide-react';
import './email-inbound.css';

type Receipt = { providerId: string; status: 'processed' | 'ignored'; reasonCode: string | null; ticketId: number | null; createdAt: string };
type State = { configured: boolean; domain?: string | null; address: string | null; recent?: Receipt[] };
const REASONS: Record<string, string> = {
  authentication_required: 'El remitente no superó la autenticación de correo.', automatic_message: 'Respuesta automática o lista de distribución.',
  empty_message: 'Sin texto nuevo para incorporar.', attachments_use_portal: 'Contiene archivos: debe enviarse desde el portal.',
  inactive_client: 'La cuenta cliente ya no está activa.', sender_changed: 'Cambió la cuenta o el correo autorizado.',
  hourly_limit: 'Límite de 60 mensajes por hora alcanzado.', ticket_access_revoked: 'La cuenta perdió acceso a este ticket.',
};

export function EmailInboundPanel({ memberId, administrator = false }: { memberId: string; administrator?: boolean }) {
  const [state, setState] = useState<State | null>(null), [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/email-inbound', { cache: 'no-store', signal: controller.signal, headers: { 'X-Daybook-Member-Id': memberId } })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || 'No se pudo consultar el correo entrante.'); return result as State; })
      .then(result => { if (!controller.signal.aborted) { setState(result); setError(''); setLoading(false); } })
      .catch(failure => { if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : 'No se pudo consultar el correo entrante.'); setLoading(false); } });
    return () => controller.abort();
  }, [memberId, revision]);
  return <section className="email-inbound-panel" aria-labelledby={`email-inbound-${memberId}`}>
    <div className="email-inbound-heading"><h2 id={`email-inbound-${memberId}`}><Mail size={18}/>Soporte por correo</h2><button type="button" className="icon-button" aria-label="Actualizar correo entrante" onClick={refresh}><RefreshCw size={16}/></button></div>
    {loading && <p role="status">Consultando correo entrante…</p>}
    {error && <p role="alert">{error}</p>}
    {state && (state.configured ? <>
      <p>{administrator ? 'El correo entrante está conectado. Cada cliente activo tiene una dirección privada para crear solicitudes; las respuestas usan la dirección única del aviso recibido.' : 'Crea una solicitud escribiendo desde tu correo registrado a esta dirección privada. Para responder un ticket, responde al aviso del equipo.'}</p>
      {state.address && <a className="email-inbound-address" href={`mailto:${state.address}`}>{state.address}</a>}
      <p className="email-inbound-help">Solo se incorpora texto nuevo de correos autenticados. Envía los archivos desde el portal. Conserva tu dirección privada y usa la cuenta con la que ingresas a Daybook.</p>
      {administrator && <div className="email-inbound-audit"><h3>Últimos correos recibidos</h3>{state.recent?.length ? <ul>{state.recent.map(receipt => <li key={receipt.providerId}><strong>{receipt.status === 'processed' ? `Incorporado al ticket #${receipt.ticketId}` : 'Correo no incorporado'}</strong><span>{new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Santiago' }).format(new Date(receipt.createdAt))}</span>{receipt.reasonCode && <p>{REASONS[receipt.reasonCode] || 'El correo requiere revisión.'}</p>}</li>)}</ul> : <p>Aún no hay correos recibidos en este espacio.</p>}</div>}
    </> : <p>{administrator ? 'La recepción está preparada. Falta conectar el dominio de recepción y el webhook del proveedor antes de activarla.' : 'Por ahora, crea y responde tus solicitudes desde este portal. Tu equipo avisará cuando puedas hacerlo también por correo.'}</p>)}
  </section>;
}
