'use client';
import {daybookFetch} from '@/lib/browser-request';

import { useEffect, useState } from 'react';
import { UsersRound } from 'lucide-react';
import { PRESENCE_HEARTBEAT_MS, currentPresenceActivity, presenceShouldRun, type PresenceActivity, type PresencePage, type PresencePerson } from '@/lib/ticket-presence-model';
import { TICKET_PRESENCE_ACTIVITY_EVENT, ticketPresenceTabId } from '@/lib/ticket-presence-client';
import './ticket-presence.css';

const activityLabel: Record<PresenceActivity, string> = { viewing: 'viendo', reply: 'preparando una respuesta', note: 'preparando una nota interna' };

export function TicketPresence({ ticketId, memberId }: { ticketId: number; memberId: string }) {
  const key = `${memberId}:${ticketId}`;
  const [state, setState] = useState<{ key: string; people: PresencePerson[]; phase: 'loading' | 'ready' | 'paused' }>({ key: '', people: [], phase: 'loading' });
  useEffect(() => {
    const tabId = ticketPresenceTabId(), path = `/api/tickets/${ticketId}/presence`;
    let disposed = false, blocked = false, paused = false, hasLease = false, controller: AbortController | null = null;
    let lastInteraction = Date.now(), lastTypedAt = 0, draftActivity: PresenceActivity = 'viewing';
    let nextWrite = 0, nextRead = 0, retryAt = 0, lastWrite = 0;
    const requestHeaders = { 'Content-Type': 'application/json', 'X-Daybook-Member-Id': memberId };
    const release = () => {
      if (!hasLease) return;
      hasLease = false;
      // Cleanup is best effort; failed network cleanup cannot extend the 45s lease.
      void daybookFetch(path, { method: 'DELETE', credentials: 'same-origin', headers: requestHeaders,
        body: JSON.stringify({ tabId }), keepalive: true, signal: AbortSignal.timeout(3000) }).catch(() => undefined);
    };
    const pause = () => {
      controller?.abort(); controller = null; release(); nextWrite = 0; nextRead = 0;
      if (!disposed && !paused) setState({ key, people: [], phase: 'paused' });
      paused = true;
    };
    const tick = async () => {
      if (disposed || blocked) return;
      const now = Date.now();
      if (!presenceShouldRun(document.visibilityState === 'visible', lastInteraction, now)) { pause(); return; }
      if (controller || now < retryAt || now < nextRead && now < nextWrite) return;
      const write = now >= nextWrite;
      const activity = currentPresenceActivity(draftActivity, lastTypedAt, now);
      const pending = new AbortController(); controller = pending;
      if (write) hasLease = true;
      try {
        const response = await daybookFetch(path, { method: write ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
          headers: requestHeaders, signal: pending.signal, ...(write ? { body: JSON.stringify({ tabId, activity }) } : {}) });
        if (!response.ok) {
          blocked = [401, 403, 404].includes(response.status);
          throw new Error('Presence unavailable');
        }
        const value = await response.json() as PresencePage;
        if (disposed || pending.signal.aborted) return;
        if (write) {
          lastWrite = now;
          // A keystroke may arrive while a viewing heartbeat is in flight.
          nextWrite = currentPresenceActivity(draftActivity, lastTypedAt, Date.now()) !== activity ? 0 : now + PRESENCE_HEARTBEAT_MS;
        }
        nextRead = now + 10_000;
        paused = false; setState({ key, people: value.people, phase: 'ready' });
      } catch {
        if (!disposed && !pending.signal.aborted) { retryAt = Date.now() + 30_000; pause(); }
      } finally { if (controller === pending) controller = null; }
    };
    const interact = () => { lastInteraction = Date.now(); void tick(); };
    const typing = (event: Event) => {
      const detail = (event as CustomEvent<{ ticketId?: number; activity?: string }>).detail;
      if (detail?.ticketId !== ticketId || !['reply', 'note'].includes(detail.activity || '')) return;
      const changed = draftActivity !== detail.activity;
      draftActivity = detail.activity as PresenceActivity; lastTypedAt = Date.now(); lastInteraction = lastTypedAt;
      if (changed || lastTypedAt - lastWrite >= 5000) nextWrite = 0;
      void tick();
    };
    const visibility = () => { if (document.visibilityState !== 'visible') pause(); else interact(); };
    const timer = setInterval(() => { void tick(); }, 1000);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pause);
    window.addEventListener('focus', interact);
    window.addEventListener('pointerdown', interact, { passive: true });
    window.addEventListener('keydown', interact);
    window.addEventListener('scroll', interact, { passive: true });
    window.addEventListener(TICKET_PRESENCE_ACTIVITY_EVENT, typing);
    void tick();
    return () => {
      disposed = true; clearInterval(timer); controller?.abort(); release();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pause); window.removeEventListener('focus', interact);
      window.removeEventListener('pointerdown', interact); window.removeEventListener('keydown', interact);
      window.removeEventListener('scroll', interact); window.removeEventListener(TICKET_PRESENCE_ACTIVITY_EVENT, typing);
    };
  }, [key, memberId, ticketId]);
  const current = state.key === key ? state : { people: [], phase: 'loading' };
  return <section className="ticket-presence" aria-label="Equipo activo en este ticket">
    <div className="ticket-presence-heading"><UsersRound size={17} aria-hidden="true"/><strong>Equipo en este ticket</strong></div>
    <div className="ticket-presence-status" role="status" aria-live="polite" aria-atomic="true">
      {current.phase === 'loading' ? <span>Consultando actividad…</span> : current.phase === 'paused' ? <span>Presencia en pausa.</span>
        : current.people.length ? <ul>{current.people.map(person => <li key={person.memberId} className={person.activity === 'viewing' ? '' : 'is-typing'}><span aria-hidden="true"/><strong>{person.name}</strong> {activityLabel[person.activity]}</li>)}</ul>
          : <span>No hay otra persona activa en este momento.</span>}
    </div>
  </section>;
}
