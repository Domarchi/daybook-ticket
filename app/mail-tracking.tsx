'use client';

import { useEffect, useState } from 'react';
import type { MailDeliveryItem } from '../lib/mail-delivery';
import './mail-tracking.css';

const EVENTS: Record<string, string> = { ticket_created: 'Ticket creado', agent_replied: 'Respuesta del equipo', client_replied: 'Respuesta del cliente', reminder: 'Recordatorio' };
const STATUS: Record<string, string> = { awaiting_configuration: 'Pendiente de configuración', queued: 'En cola', processing: 'Enviando', accepted: 'Aceptado por proveedor', failed: 'Envío fallido', unknown: 'Envío por confirmar', cancelled: 'Cancelado' };
const DELIVERY: Record<string, string> = { untracked: 'Sin confirmación de entrega', sent: 'Enviado al servidor', delayed: 'Entrega demorada', delivered: 'Entregado al servidor de correo', bounced: 'Rebotado', complained: 'Marcado como no deseado', failed: 'Entrega fallida', suppressed: 'Entrega bloqueada' };
const HISTORY: Record<string, string> = { 'email.sent': 'Enviado por el proveedor', 'email.delivery_delayed': 'Entrega demorada', 'email.delivered': 'Entregado al servidor de correo', 'email.bounced': 'Rebotado', 'email.complained': 'Marcado como no deseado', 'email.failed': 'Entrega fallida', 'email.suppressed': 'Entrega bloqueada' };
const date = (value: string) => new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

/** Staff-only surface; the API separately enforces fresh membership + ticket
 * access. No message bodies, activation links or private attachments are read. */
export function MailTracking({ ticketId, refreshKey = 0 }: { ticketId: number; refreshKey?: number }) {
  const [refresh, setRefresh] = useState(0);
  const [snapshot, setSnapshot] = useState<{ ticketId: number; messages: MailDeliveryItem[]; error: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let current = true;
    let inFlight = false;
    const controller = new AbortController();
    async function load() {
      if (inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      setLoading(true);
      try {
        const response = await fetch(`/api/tickets/${ticketId}/mail-delivery`, { cache: 'no-store', signal: controller.signal });
        const value = await response.json();
        if (!response.ok) throw new Error(typeof value?.error === 'string' ? value.error : 'No se pudo consultar la entrega.');
        if (current) setSnapshot({ ticketId, messages: value.messages, error: null });
      } catch (error) {
        if (current) setSnapshot(previous => ({ ticketId, messages: previous?.ticketId === ticketId ? previous.messages : [], error: error instanceof Error ? error.message : 'No se pudo consultar la entrega.' }));
      } finally { inFlight = false; if (current) setLoading(false); }
    }
    void load();
    const timer = setInterval(() => { void load(); }, 30_000);
    document.addEventListener('visibilitychange', load);
    return () => { current = false; controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', load); };
  }, [ticketId, refreshKey, refresh]);
  const active = snapshot?.ticketId === ticketId ? snapshot : null;
  return <section className="mail-tracking" aria-label="Seguimiento de correos">
    <header><div><h3>Correos de este ticket</h3><p>La confirmación de entrega indica recepción por el servidor de correo; no confirma lectura.</p></div><button type="button" onClick={() => setRefresh(value => value + 1)} disabled={loading} aria-label="Actualizar seguimiento de correos">{loading ? 'Actualizando…' : 'Actualizar'}</button></header>
    {active?.error && <p className="mail-tracking-error" role="alert">{active.error}</p>}
    {!active && <p className="mail-tracking-empty" role="status">Consultando correos…</p>}
    {active && !active.messages.length && !active.error && <p className="mail-tracking-empty">Aún no hay avisos por correo para este ticket.</p>}
    {!!active?.messages.length && <ul className="mail-tracking-list">{active.messages.map(message => <li key={message.id}>
      <div className="mail-tracking-heading"><strong>{EVENTS[message.event] ?? 'Aviso de soporte'}</strong><time dateTime={message.createdAt}>{date(message.createdAt)}</time></div>
      <p className="mail-tracking-recipient">{message.recipientEmail ?? 'Destinatario no disponible'}</p>
      <div className="mail-tracking-badges"><span>{STATUS[message.status] ?? 'En revisión'}</span><span data-delivery={message.deliveryStatus}>{DELIVERY[message.deliveryStatus] ?? 'Sin confirmación de entrega'}</span></div>
      {message.error && <p className="mail-tracking-error">{message.error}</p>}
      {message.nextAttemptAt && message.status === 'queued' && <p className="mail-tracking-help">Próximo intento desde {date(message.nextAttemptAt)}.</p>}
      {!!message.history.length && <details><summary>Ver historial de entrega ({message.history.length})</summary><ol>{message.history.map((event, index) => <li key={`${event.eventType}:${event.occurredAt}:${index}`}><span>{HISTORY[event.eventType] ?? 'Actualización de entrega'}</span><time dateTime={event.occurredAt}>{date(event.occurredAt)}</time></li>)}</ol></details>}
    </li>)}</ul>}
  </section>;
}
