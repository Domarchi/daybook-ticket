import type { MailDeliveryItem } from '@/lib/mail-delivery';
import { SUPPORT_EVENT_LABELS } from '@/lib/notification-event-labels';

const EVENTS: Record<string, string> = { ticket_created: 'Ticket creado', agent_replied: 'Respuesta del equipo', client_replied: 'Respuesta del cliente', reminder: 'Recordatorio', ...SUPPORT_EVENT_LABELS };
const STATUS: Record<string, string> = { awaiting_configuration: 'Pendiente de configuración', queued: 'En cola', processing: 'Enviando', accepted: 'Aceptado por proveedor', failed: 'Envío fallido', unknown: 'Envío por confirmar', cancelled: 'Cancelado' };
const DELIVERY: Record<string, string> = { untracked: 'Sin confirmación de entrega', sent: 'Enviado al servidor', delayed: 'Entrega demorada', delivered: 'Entregado al servidor de correo', bounced: 'Rebotado', complained: 'Marcado como no deseado', failed: 'Entrega fallida', suppressed: 'Entrega bloqueada' };
const HISTORY: Record<string, string> = { 'email.sent': 'Enviado por el proveedor', 'email.delivery_delayed': 'Entrega demorada', 'email.delivered': 'Entregado al servidor de correo', 'email.bounced': 'Rebotado', 'email.complained': 'Marcado como no deseado', 'email.failed': 'Entrega fallida', 'email.suppressed': 'Entrega bloqueada' };
const date = (value: string) => new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

/** Presentation only: delivery state and safe metadata never include message bodies or frozen payloads. */
export function MailTrackingList({ messages }: { messages: MailDeliveryItem[] }) {
  return <ul className="mail-tracking-list">{messages.map(message => <li key={message.id}>
    <div className="mail-tracking-heading"><strong>{EVENTS[message.event] ?? 'Aviso de soporte'}</strong><time dateTime={message.createdAt}>{date(message.createdAt)}</time></div>
    <p className="mail-tracking-recipient">{message.recipientEmail ?? 'Destinatario no disponible'}</p>
    <div className="mail-tracking-badges"><span>{STATUS[message.status] ?? 'En revisión'}</span><span data-delivery={message.deliveryStatus}>{DELIVERY[message.deliveryStatus] ?? 'Sin confirmación de entrega'}</span></div>
    {message.error && <p className="mail-tracking-error">{message.error}</p>}
    {message.nextAttemptAt && message.status === 'queued' && <p className="mail-tracking-help">Próximo intento desde {date(message.nextAttemptAt)}.</p>}
    {!!message.history.length && <details><summary>Ver historial de entrega ({message.history.length})</summary><ol>{message.history.map((event, index) => <li key={`${event.eventType}:${event.occurredAt}:${index}`}><span>{HISTORY[event.eventType] ?? 'Actualización de entrega'}</span><time dateTime={event.occurredAt}>{date(event.occurredAt)}</time></li>)}</ol></details>}
  </li>)}</ul>;
}
