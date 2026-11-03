'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Bell, Check, CheckCheck, ChevronRight, LoaderCircle, MessageSquare, Monitor, Ticket, Volume2, VolumeX, X } from 'lucide-react';
import type { AlertControls } from '@/hooks/use-ticket-alerts';
import type { TicketAlert } from '@/lib/types';
import './ticket-alerts.css';

const alertTitle = (item: TicketAlert) => item.event === 'ticket_created' ? 'Nuevo ticket' : 'Nuevo mensaje';
const ticketNumber = (id: number) => `#${String(id).padStart(4, '0')}`;
const alertDate = (value: string) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

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
  const count = unread.size;
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
    alerts.markRead(item.id);
    if (alerts.latest?.id === item.id) alerts.dismissLatest();
    setOpen(false);
  };

  return <div className="ticket-alerts" ref={root}>
    <div className="ticket-alert-controls" aria-label="Avisos de tickets">
      <button type="button" data-sound-toggle className={`ticket-alert-control ${alerts.soundEnabled ? 'is-enabled' : ''}`} onClick={alerts.toggleSound} disabled={alerts.soundPending} aria-pressed={alerts.soundEnabled} aria-busy={alerts.soundPending}>
        {alerts.soundPending ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : alerts.soundEnabled ? <Volume2 size={16} aria-hidden="true" /> : <VolumeX size={16} aria-hidden="true" />}
        {alerts.soundPending ? 'Activando…' : alerts.soundEnabled ? 'Silenciar' : 'Activar sonido'}
      </button>
      {alerts.desktopPermission === 'default' && <button type="button" className="ticket-alert-control" onClick={alerts.requestDesktop}><Monitor size={16} aria-hidden="true" />Avisos de escritorio</button>}
      {alerts.desktopPermission === 'granted' && <span className="ticket-alert-desktop"><Check size={14} aria-hidden="true" />Escritorio activo</span>}
      {alerts.desktopPermission === 'denied' && <span className="ticket-alert-desktop is-blocked" title="Puedes habilitarlos desde los permisos de este sitio en tu navegador."><Monitor size={15} aria-hidden="true" />Escritorio bloqueado</span>}
      <button ref={bell} type="button" className={`ticket-alert-control ticket-alert-bell ${open ? 'is-open' : ''}`} onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls={panelId} aria-label={`Avisos${count ? `, ${count} sin leer` : ''}`}>
        <Bell size={17} aria-hidden="true" /><span>Avisos</span>{count > 0 && <span className="ticket-alert-badge" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
      </button>
    </div>
    {alerts.audioError && <p className="ticket-alert-audio-error">{alerts.audioError}</p>}

    {open && <section className="ticket-alert-panel" id={panelId} aria-labelledby={headingId}>
      <div className="ticket-alert-panel-heading"><div><h2 id={headingId}>Tus avisos</h2><p>{count ? `${count} sin leer` : 'Estás al día'}</p></div><button type="button" className="ticket-alert-icon-button" aria-label="Cerrar avisos" onClick={() => { setOpen(false); bell.current?.focus(); }}><X size={18} /></button></div>
      {count > 0 && <button type="button" className="ticket-alert-read-all" onClick={alerts.markAllRead}><CheckCheck size={16} aria-hidden="true" />Marcar todos como leídos</button>}
      {alerts.items.length ? <ul className="ticket-alert-list">{alerts.items.slice(0, 20).map(item => <li key={item.id}>
        <button type="button" className={`ticket-alert-item ${unread.has(item.id) ? 'is-unread' : ''}`} disabled={disabled} onClick={() => showTicket(item)} title="Abrir ticket en otra pestaña">
          <span className="ticket-alert-item-icon" aria-hidden="true">{item.event === 'ticket_created' ? <Ticket size={18} /> : <MessageSquare size={18} />}</span>
          <span className="ticket-alert-item-copy"><span className="ticket-alert-item-kind">{alertTitle(item)} · {ticketNumber(item.ticketId)}{unread.has(item.id) && <><span className="ticket-alert-unread-dot" aria-hidden="true" /><span className="ticket-alert-sr-only">Sin leer</span></>}</span><strong>{item.subject}</strong><time dateTime={item.createdAt}>{alertDate(item.createdAt)}</time></span>
          <ChevronRight size={16} className="ticket-alert-chevron" aria-hidden="true" />
        </button>
      </li>)}</ul> : <div className="ticket-alert-empty"><Bell size={25} aria-hidden="true" /><strong>Aún no hay avisos</strong><p>Los tickets y mensajes nuevos aparecerán aquí.</p></div>}
    </section>}

    <div className="ticket-alert-announcement" role="status" aria-live="polite" aria-atomic="true">
      {latest && <div className="ticket-alert-toast" key={latest.id}>
        <span className="ticket-alert-toast-icon" aria-hidden="true">{latest.event === 'ticket_created' ? <Ticket size={21} /> : <MessageSquare size={21} />}</span>
        <div className="ticket-alert-toast-copy"><span>{alertTitle(latest)} · {ticketNumber(latest.ticketId)}</span><strong>{latest.subject}</strong><button type="button" disabled={disabled} onClick={() => showTicket(latest)} title="Abrir ticket en otra pestaña">Abrir ticket<ChevronRight size={15} aria-hidden="true" /></button></div>
        <button type="button" className="ticket-alert-icon-button" aria-label="Cerrar aviso nuevo" onClick={alerts.dismissLatest}><X size={18} /></button>
      </div>}
    </div>
  </div>;
}
