'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { AlarmClock, Bell, CheckCheck, ChevronRight, LoaderCircle, MessageSquare, Monitor, Ticket, Volume2, VolumeX, X } from 'lucide-react';
import type { AlertControls } from '@/hooks/use-ticket-alerts';
import type { TicketAlert } from '@/lib/types';
import { SUPPORT_EVENT_LABELS } from '@/lib/notification-event-labels';
import { PushMenu } from './push-menu';
import './ticket-alerts.css';

const alertTitle = (item: TicketAlert) => item.event === 'ticket_created' ? 'Nuevo ticket' : item.event === 'reminder' ? 'Recordatorio' : item.event === 'escalation' || item.event === 'satisfaction_requested' || item.event === 'member_mentioned' || item.event === 'ticket_followed_update' ? SUPPORT_EVENT_LABELS[item.event] : 'Nuevo mensaje';
const ticketNumber = (id: number) => `#${String(id).padStart(4, '0')}`;
const alertDate = (value: string) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const dateGroup = (value: string) => {
  const date = new Date(value), today = new Date(), yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Hoy';
  if (date.toDateString() === yesterday.toDateString()) return 'Ayer';
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
};
const alertIcon = (item: TicketAlert, size: number) => item.event === 'ticket_created' ? <Ticket size={size} /> : item.event === 'reminder' ? <AlarmClock size={size} /> : <MessageSquare size={size} />;

export function TicketAlerts({ alerts, onOpen, disabled = false }: {
  alerts: AlertControls;
  onOpen: (ticketId: number) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const bell = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const headingId = useId();
  const unread = new Set(alerts.unreadIds);
  const count = alerts.unreadCount;
  const latest = alerts.latest;

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        bell.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const showTicket = (item: TicketAlert) => {
    if (disabled) return;
    onOpen(item.ticketId);
    if (unread.has(item.id)) alerts.markRead(item.id);
    if (alerts.latest?.id === item.id) alerts.dismissLatest();
    setOpen(false);
  };

  return <div className="ticket-alerts" ref={root}>
    <div className="ticket-alert-controls" aria-label="Avisos de tickets">
      <button type="button" data-sound-toggle className={`ticket-alert-control ${alerts.soundEnabled ? 'is-enabled' : ''}`} onClick={alerts.toggleSound} disabled={alerts.soundPending} aria-pressed={alerts.soundEnabled} aria-busy={alerts.soundPending}>
        {alerts.soundPending ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : alerts.soundEnabled ? <Volume2 size={16} aria-hidden="true" /> : <VolumeX size={16} aria-hidden="true" />}
        {alerts.soundPending ? 'Activando…' : alerts.soundEnabled ? 'Silenciar' : 'Activar sonido'}
      </button>
      {alerts.push.status === 'active' ? <PushMenu push={alerts.push} /> : alerts.push.status === 'inactive'
 ? <button type="button" className="ticket-alert-control ticket-push-enable" onClick={alerts.push.enable} disabled={alerts.push.busy} aria-busy={alerts.push.busy}>{alerts.push.busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Monitor size={16} aria-hidden="true" />}{alerts.push.busy ? 'Activando avisos…' : 'Activar avisos con la página cerrada'}</button>
        : alerts.push.status === 'loading' ? <span className="ticket-alert-desktop"><LoaderCircle size={14} className="spin" aria-hidden="true" />Preparando avisos…</span>
          : alerts.push.status === 'blocked' ? <span className="ticket-alert-desktop is-blocked"><Monitor size={15} aria-hidden="true" />Avisos bloqueados</span>
            : alerts.push.status === 'error' ? <button type="button" className="ticket-alert-control" disabled={alerts.push.busy} onClick={alerts.push.refresh}><Monitor size={16} aria-hidden="true" />Reintentar avisos</button> : null}
      <button ref={bell} type="button" className={`ticket-alert-control ticket-alert-bell ${open ? 'is-open' : ''}`} onClick={() => { if (!open) alerts.refresh(); setOpen(!open); }} aria-expanded={open} aria-controls={panelId} aria-label={`Avisos${count ? `, ${count} sin leer` : ''}`}>
        <Bell size={17} aria-hidden="true" /><span>Avisos</span>{count > 0 && <span className="ticket-alert-badge" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
      </button>
    </div>
    {alerts.audioError && <p className="ticket-alert-audio-error">{alerts.audioError}</p>}
    <div className="ticket-push-feedback" role="status" aria-live="polite">
      {alerts.push.status === 'unsupported' && <p>Este navegador no permite avisos con la página cerrada. Abre Daybook Ticket en Chrome, Edge, Firefox o Safari de tu computador.</p>}
      {alerts.push.status === 'unconfigured' && <p>Los avisos con la página cerrada aún no están disponibles. Los avisos dentro de Daybook siguen activos.</p>}
      {alerts.push.status === 'blocked' && <p>Permite las notificaciones en los ajustes de este sitio en tu navegador y vuelve a esta página.</p>}
      {alerts.push.notice && <p>{alerts.push.notice}</p>}
    </div>
    {alerts.push.error && <p className="ticket-alert-audio-error" role="alert">{alerts.push.error}</p>}

    {open && <section className="ticket-alert-panel" id={panelId} aria-labelledby={headingId} aria-busy={alerts.loading || alerts.saving}>
      <div className="ticket-alert-panel-heading"><div><h2 id={headingId}>Tus avisos</h2><p>{count ? `${count} sin leer` : 'Estás al día'}</p></div><button type="button" className="ticket-alert-icon-button" aria-label="Cerrar avisos" onClick={() => { setOpen(false); bell.current?.focus(); }}><X size={18} /></button></div>
      <div className="ticket-alert-filters" aria-label="Filtrar avisos">
        <button type="button" aria-pressed={alerts.filter === 'unread'} onClick={() => alerts.setFilter('unread')} disabled={alerts.saving}>Sin leer <span>{count}</span></button>
        <button type="button" aria-pressed={alerts.filter === 'all'} onClick={() => alerts.setFilter('all')} disabled={alerts.saving}>Todos</button>
      </div>
      {count > 0 && <button type="button" className="ticket-alert-read-all" onClick={alerts.markAllRead} disabled={alerts.saving}>{alerts.saving ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <CheckCheck size={16} aria-hidden="true" />}Marcar todos como leídos</button>}
      {alerts.error && <div className="ticket-alert-error" role="alert"><p>{alerts.error}</p><button type="button" onClick={alerts.refresh} disabled={alerts.loading || alerts.saving}>Reintentar</button></div>}
      {alerts.items.length ? <ul className="ticket-alert-list">{alerts.items.map((item, index) => <li key={item.id}>
        {(index === 0 || dateGroup(alerts.items[index - 1].createdAt) !== dateGroup(item.createdAt)) && <div className="ticket-alert-date-group">{dateGroup(item.createdAt)}</div>}
        <button type="button" className={`ticket-alert-item ${unread.has(item.id) ? 'is-unread' : ''}`} disabled={disabled} onClick={() => showTicket(item)} title="Abrir ticket en otra pestaña">
          <span className="ticket-alert-item-icon" aria-hidden="true">{alertIcon(item, 18)}</span>
          <span className="ticket-alert-item-copy"><span className="ticket-alert-item-kind">{alertTitle(item)} · {ticketNumber(item.ticketId)}{unread.has(item.id) && <><span className="ticket-alert-unread-dot" aria-hidden="true" /><span className="ticket-alert-sr-only">Sin leer</span></>}</span><strong>{item.subject}</strong><time dateTime={item.createdAt}>{alertDate(item.createdAt)}</time>{item.historical && <span className="ticket-alert-history-label">Historial previo · lectura desconocida</span>}</span>
          <ChevronRight size={16} className="ticket-alert-chevron" aria-hidden="true" />
        </button>
      </li>)}</ul> : <div className="ticket-alert-empty">{alerts.loading ? <LoaderCircle size={25} className="spin" aria-hidden="true" /> : <Bell size={25} aria-hidden="true" />}<strong>{alerts.loading ? 'Buscando avisos…' : alerts.filter === 'unread' ? 'Estás al día' : 'Aún no hay avisos'}</strong><p>{alerts.filter === 'unread' ? 'Los avisos nuevos sin leer aparecerán aquí.' : 'Los tickets y mensajes nuevos aparecerán aquí.'}</p></div>}
      {alerts.hasMore && <button type="button" className="ticket-alert-load-more" onClick={alerts.loadMore} disabled={alerts.loading || alerts.saving}>{alerts.loading ? <><LoaderCircle size={15} className="spin" aria-hidden="true" />Cargando…</> : 'Ver más avisos'}</button>}
      <p className="ticket-alert-persistence">Tu lectura se sincroniza entre tus dispositivos.</p>
    </section>}

    <div className="ticket-alert-announcement" role="status" aria-live="polite" aria-atomic="true">
      {latest && <div className="ticket-alert-toast" key={latest.id}>
        <span className="ticket-alert-toast-icon" aria-hidden="true">{alertIcon(latest, 21)}</span>
        <div className="ticket-alert-toast-copy"><span>{alertTitle(latest)} · {ticketNumber(latest.ticketId)}</span><strong>{latest.subject}</strong><button type="button" disabled={disabled} onClick={() => showTicket(latest)} title="Abrir ticket en otra pestaña">Abrir ticket<ChevronRight size={15} aria-hidden="true" /></button></div>
        <button type="button" className="ticket-alert-icon-button" aria-label="Cerrar aviso nuevo" onClick={alerts.dismissLatest}><X size={18} /></button>
      </div>}
    </div>
  </div>;
}
