'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, LoaderCircle, Monitor } from 'lucide-react';
import type { WebPushControls } from '@/hooks/use-web-push';

/**
 * Desktop notifications, once active: one button in the alert bar that opens a small panel with
 * "Probar aviso", "Probar en este equipo" and "Desactivar" (they used to sit in the bar, four wide).
 * It closes on Escape (focus goes back to the button) or a click outside.
 */
export function PushMenu({ push }: { push: WebPushControls }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div className="ticket-push-menu" ref={root}>
    <button ref={button} type="button" className="ticket-alert-control is-enabled ticket-push-menu-button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}><Check size={14} aria-hidden="true" />Avisos en este equipo<ChevronDown size={14} aria-hidden="true" /></button>
    {open && <div className="ticket-push-panel" id={panelId} role="group" aria-label="Avisos con la página cerrada">
      <p>Activos con la pestaña cerrada mientras mantengas tu sesión iniciada. El sonido depende de los ajustes de tu computador.</p>
      <button type="button" className="ticket-alert-control" disabled={push.busy} onClick={push.test} aria-busy={push.busy}>{push.busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Monitor size={16} aria-hidden="true" />}Probar aviso</button>
      <button type="button" className="ticket-alert-control" disabled={push.busy} onClick={push.testLocal} aria-busy={push.busy} title="Comprobar que este computador puede mostrar notificaciones">Probar en este equipo</button>
      <button type="button" className="ticket-alert-control ticket-push-disable" disabled={push.busy} onClick={() => { setOpen(false); push.disable(); }} aria-label="Desactivar avisos con la página cerrada">Desactivar</button>
    </div>}
  </div>;
}
