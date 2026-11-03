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
      {alerts.push.status === 'active' ? <>
        <span className="ticket-alert-desktop"><Check size={14} aria-hidden="true" />Avisos en este equipo</span>
        <button type="button" className="ticket-alert-control" disabled={alerts.push.busy} onClick={alerts.push.test} aria-busy={alerts.push.busy}>{alerts.push.busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Monitor size={16} aria-hidden="true" />}Probar aviso</button>
        <button type="button" className="ticket-alert-control" disabled={alerts.push.busy} onClick={alerts.push.testLocal} aria-busy={alerts.push.busy} title="Comprobar que este computador puede mostrar notificaciones">Probar en este equipo</button>
        <button type="button" className="ticket-alert-control ticket-push-disable" disabled={alerts.push.busy} onClick={alerts.push.disable} aria-label="Desactivar avisos con la página cerrada">Desactivar</button>
      </> : alerts.push.status === 'inactive' ? <button type="button" className="ticket-alert-control ticket-push-enable" onClick={alerts.push.enable} disabled={alerts.push.busy} aria-busy={alerts.push.busy}>{alerts.push.busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Monitor size={16} aria-hidden="true" />}{alerts.push.busy ? 'Activando avisos…' : 'Activar avisos con la página cerrada'}</button>
        : alerts.push.status === 'loading' ? <span className="ticket-alert-desktop"><LoaderCircle size={14} className="spin" aria-hidden="true" />Preparando avisos…</span>
          : alerts.push.status === 'blocked' ? <span className="ticket-alert-desktop is-blocked"><Monitor size={15} aria-hidden="true" />Avisos bloqueados</span>
            : alerts.push.status === 'error' ? <button type="button" className="ticket-alert-control" disabled={alerts.push.busy} onClick={alerts.push.refresh}><Monitor size={16} aria-hidden="true" />Reintentar avisos</button> : null}
      <button ref={bell} type="button" className={`ticket-alert-control ticket-alert-bell ${open ? 'is-open' : ''}`} onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls={panelId} aria-label={`Avisos${count ? `, ${count} sin leer` : ''}`}>
        <Bell size={17} aria-hidden="true" /><span>Avisos</span>{count > 0 && <span className="ticket-alert-badge" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
      </button>
    </div>
    {alerts.audioError && <p className="ticket-alert-audio-error">{alerts.audioError}</p>}
    <div className="ticket-push-feedback" role="status" aria-live="polite">
      {alerts.push.status === 'unsupported' && <p>Este navegador no permite avisos con la página cerrada. Abre Daybook Ticket en Chrome, Edge, Firefox o Safari de tu computador.</p>}
      {alerts.push.status === 'unconfigured' && <p>Los avisos con la página cerrada aún no están disponibles. Los avisos dentro de Daybook siguen activos.</p>}
      {alerts.push.status === 'blocked' && <p>Permite las notificaciones en los ajustes de este sitio en tu navegador y vuelve a esta página.</p>}
      {alerts.push.status === 'active' && !alerts.push.notice && <p>Activos con la pestaña cerrada mientras mantengas tu sesión iniciada. El sonido depende de los ajustes de tu computador.</p>}
      {alerts.push.notice && <p>{alerts.push.notice}</p>}
    </div>
    {alerts.push.error && <p className="ticket-alert-audio-error" role="alert">{alerts.push.error}</p>}

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
