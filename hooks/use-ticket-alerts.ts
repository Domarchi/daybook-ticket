'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TicketAlert, Workspace } from '@/lib/types';
import { TicketAlertTracker } from '@/lib/alert-tracker';
import { deliverAlertOnce } from '@/lib/alert-delivery';

type DesktopPermission = NotificationPermission | 'unsupported';
export interface AlertControls {
  items: TicketAlert[];
  unreadIds: string[];
  latest: TicketAlert | null;
  soundEnabled: boolean;
  soundPending: boolean;
  desktopPermission: DesktopPermission;
  audioError: string;
  toggleSound: () => void;
  requestDesktop: () => void;
  dismissLatest: () => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
}

const INITIAL = {
  items: [] as TicketAlert[], unreadIds: [] as string[], latest: null as TicketAlert | null,
  soundEnabled: false, soundPending: false, desktopPermission: 'unsupported' as DesktopPermission, audioError: '',
};
function desktopPermission(): DesktopPermission {
  return 'Notification' in window && window.isSecureContext ? Notification.permission : 'unsupported';
}

// A short, quiet two-note chime, generated locally without external audio files.
function chime(context: AudioContext) {
  if (context.state !== 'running') return;
  [660, 880].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + index * 0.14;
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.06, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(start);
    oscillator.stop(start + 0.3);
  });
}

export function useTicketAlerts(): AlertControls & { receive: (workspace: Workspace) => void } {
  const [state, setState] = useState(INITIAL);
  const tracker = useRef(new TicketAlertTracker());
  const account = useRef<string | null>(null);
  const preferenceKey = useRef<string | null>(null);
  const wantsSound = useRef(false);
  const audio = useRef<AudioContext | null>(null);
  const activating = useRef<string | null>(null);
  const desktopUnsupported = useRef(false);
  const mounted = useRef(false);
  const desktop = useRef<Notification | null>(null);
  const desktopTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const enableSound = useCallback(async (preview: boolean) => {
    if (!account.current || activating.current === account.current) return;
    const forAccount = account.current;
    activating.current = forAccount;
    let resumeTimeout: ReturnType<typeof setTimeout> | undefined;
    setState(previous => ({ ...previous, soundPending: true, audioError: '' }));
    try {
      if (!('AudioContext' in window)) throw new Error('Este navegador no admite sonido. Los avisos visuales siguen activos.');
      const context = audio.current?.state !== 'closed' && audio.current ? audio.current : new AudioContext();
      audio.current = context;
      // resume() is called synchronously from a click/key gesture before awaiting.
      await Promise.race([
        context.resume(),
        new Promise<never>((_, reject) => { resumeTimeout = setTimeout(() => reject(new Error('El navegador bloqueó el audio. Vuelve a pulsar Activar sonido.')), 4_000); }),
      ]);
      if (!mounted.current || account.current !== forAccount) return;
      if (context.state !== 'running') throw new Error('Pulsa Activar sonido para permitir el audio en este navegador.');
      wantsSound.current = true;
      try { if (preferenceKey.current) localStorage.setItem(preferenceKey.current, 'on'); } catch { /* Private browsing can disable storage. */ }
      setState(previous => ({ ...previous, soundEnabled: true }));
      if (preview) chime(context);
    } catch (failure) {
      if (mounted.current && account.current === forAccount) {
        wantsSound.current = false;
        setState(previous => ({ ...previous, soundEnabled: false, audioError: failure instanceof Error ? failure.message : 'No se pudo activar el sonido. Los avisos visuales siguen activos.' }));
      }
    } finally {
      clearTimeout(resumeTimeout);
      if (activating.current === forAccount) activating.current = null;
      if (mounted.current && account.current === forAccount) setState(previous => ({ ...previous, soundPending: false }));
    }
  }, []);

  const toggleSound = useCallback(() => {
    if (state.soundEnabled) {
      wantsSound.current = false;
      try { if (preferenceKey.current) localStorage.setItem(preferenceKey.current, 'off'); } catch { /* The current session can still be muted. */ }
      setState(previous => ({ ...previous, soundEnabled: false, audioError: '' }));
    } else { void enableSound(true); }
  }, [enableSound, state.soundEnabled]);

  const requestDesktop = useCallback(async () => {
    if (desktopUnsupported.current || desktopPermission() === 'unsupported') return;
    const forAccount = account.current;
    try {
      const permission = await Notification.requestPermission();
      if (mounted.current && account.current === forAccount) setState(previous => ({ ...previous, desktopPermission: permission }));
    } catch {
      desktopUnsupported.current = true;
      if (mounted.current && account.current === forAccount) setState(previous => ({ ...previous, desktopPermission: 'unsupported' }));
    }
  }, []);

  const receive = useCallback((workspace: Workspace) => {
    const viewerKey = workspace.viewer ? `${workspace.viewer.id}:${workspace.viewer.role}` : null;
    const changedAccount = account.current !== viewerKey;
    const items = workspace.alerts;
    const fresh = tracker.current.receive(viewerKey, items);
    if (changedAccount) {
      account.current = viewerKey;
      preferenceKey.current = workspace.viewer ? `daybook.ticket.sound.v1.${workspace.viewer.id}` : null;
      wantsSound.current = false;
      try { wantsSound.current = Boolean(preferenceKey.current && localStorage.getItem(preferenceKey.current) === 'on'); } catch { /* Sound can still be enabled for this session. */ }
      if (audio.current) void audio.current.close().catch(() => {});
      audio.current = null;
      desktop.current?.close();
      clearTimeout(desktopTimer.current);
      clearTimeout(toastTimer.current);
      setState({ ...INITIAL, items, desktopPermission: desktopUnsupported.current ? 'unsupported' : desktopPermission() });
      return;
    }
    if (!viewerKey) return;
    const latest = fresh.at(-1);
    const availableIds = new Set(items.map(item => item.id));
    setState(previous => ({
      ...previous,
      items,
      unreadIds: [...new Set([...previous.unreadIds, ...fresh.map(item => item.id)])].filter(id => availableIds.has(id)),
      latest: latest || (previous.latest && availableIds.has(previous.latest.id) ? previous.latest : null),
      desktopPermission: desktopUnsupported.current ? 'unsupported' : desktopPermission(),
      soundEnabled: wantsSound.current && audio.current?.state === 'running',
    }));
    if (!latest) return;
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => { if (mounted.current) setState(previous => ({ ...previous, latest: null })); }, 12_000);
    if (wantsSound.current && audio.current?.state === 'running') {
      void deliverAlertOnce(viewerKey, 'sound', fresh.map(item => item.id),
        () => mounted.current && account.current === viewerKey && wantsSound.current && audio.current?.state === 'running',
        () => { if (audio.current) chime(audio.current); });
    }
    if (document.visibilityState === 'hidden' && !desktopUnsupported.current && desktopPermission() === 'granted') {
      void deliverAlertOnce(viewerKey, 'desktop', fresh.map(item => item.id),
        () => mounted.current && account.current === viewerKey && document.visibilityState === 'hidden' && !desktopUnsupported.current && desktopPermission() === 'granted',
        () => { try {
        desktop.current?.close();
        clearTimeout(desktopTimer.current);
        const notification = new Notification('Daybook Ticket', {
          body: fresh.length > 1 ? `${fresh.length} avisos nuevos en tus tickets.` : `${latest.event === 'ticket_created' ? 'Nuevo ticket' : 'Nuevo mensaje'} · #${String(latest.ticketId).padStart(4, '0')}`,
          tag: `daybook-ticket-${viewerKey}`,
          silent: true,
        });
        notification.onclick = () => {
          if (account.current === viewerKey) {
            window.open(`/?ticket=${latest.ticketId}`, '_blank', 'noopener,noreferrer');
            setState(previous => ({ ...previous, unreadIds: previous.unreadIds.filter(id => id !== latest.id), latest: previous.latest?.id === latest.id ? null : previous.latest }));
          }
          notification.close();
        };
        desktop.current = notification;
        desktopTimer.current = setTimeout(() => notification.close(), 15_000);
      } catch {
        desktopUnsupported.current = true;
        setState(previous => ({ ...previous, desktopPermission: 'unsupported' }));
      } });
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    // A remembered preference still needs a browser gesture after a fresh load.
    const unlock = (event: Event) => {
      if ((event.target as Element | null)?.closest?.('[data-sound-toggle]')) return;
      if (wantsSound.current && audio.current?.state !== 'running') void enableSound(false);
    };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
    const preferenceChanged = (event: StorageEvent) => {
      if (!preferenceKey.current || event.key !== preferenceKey.current) return;
      wantsSound.current = event.newValue === 'on';
      setState(previous => ({ ...previous, soundEnabled: wantsSound.current && audio.current?.state === 'running' }));
    };
    window.addEventListener('storage', preferenceChanged);
    return () => {
      mounted.current = false;
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
      window.removeEventListener('storage', preferenceChanged);
      clearTimeout(toastTimer.current);
      clearTimeout(desktopTimer.current);
      desktop.current?.close();
      if (audio.current) void audio.current.close().catch(() => {});
    };
  }, [enableSound]);

  useEffect(() => {
    const title = 'Daybook Ticket — Servicios Daybook';
    document.title = state.unreadIds.length ? `(${state.unreadIds.length}) ${title}` : title;
    return () => { document.title = title; };
  }, [state.unreadIds.length]);

  return {
    ...state, receive, toggleSound, requestDesktop,
    dismissLatest: () => setState(previous => ({ ...previous, latest: null })),
    markRead: id => setState(previous => ({ ...previous, unreadIds: previous.unreadIds.filter(value => value !== id), latest: previous.latest?.id === id ? null : previous.latest })),
    markAllRead: () => setState(previous => ({ ...previous, unreadIds: [], latest: null })),
  };
}
