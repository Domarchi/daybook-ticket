'use client';
import {daybookFetch} from '@/lib/browser-request';


import { useEffect, useState } from 'react';
import type { MailDeliveryItem } from '../lib/mail-delivery';
import { MailTrackingList } from './mail-delivery-list';
import './mail-tracking.css';


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
        const response = await daybookFetch(`/api/tickets/${ticketId}/mail-delivery`, { cache: 'no-store', signal: controller.signal });
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
    {!!active?.messages.length && <MailTrackingList messages={active.messages}/>}
  </section>;
}
