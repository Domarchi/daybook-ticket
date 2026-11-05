'use client';
import { workspaceStorageKey } from '@/lib/workspace-client';
import {daybookFetch} from '@/lib/browser-request';


import { useCallback, useEffect, useRef, useState } from 'react';
import type { AlertsPage, TicketAlert, Workspace } from '@/lib/types';
import { TicketAlertTracker } from '@/lib/alert-tracker';
import { deliverAlertOnce } from '@/lib/alert-delivery';
import { ALERT_VIEWER_HEADER, isUnreadAlert, mergeAlertPages } from '@/lib/alerts-state';
import { useWebPush, type WebPushControls } from './use-web-push';

export interface AlertControls {
  items: TicketAlert[];
  unreadIds: string[];
  unreadCount: number;
  filter: 'all' | 'unread';
  loading: boolean;
  saving: boolean;
  error: string;
  hasMore: boolean;
  latest: TicketAlert | null;
  soundEnabled: boolean;
  soundPending: boolean;
  push: WebPushControls;
  audioError: string;
  toggleSound: () => void;
  dismissLatest: () => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  setFilter: (filter: 'all' | 'unread') => void;
  loadMore: () => void;
  refresh: () => void;
}

const INITIAL = {
  items: [] as TicketAlert[], unreadIds: [] as string[], latest: null as TicketAlert | null,
  soundEnabled: false, soundPending: false, audioError: '',
  unreadCount: 0, filter: 'all' as 'all' | 'unread', loading: false, saving: false, error: '',
  nextCursor: null as string | null,
};
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
  const [pushAccount, setPushAccount] = useState<string | null>(null);
  const push = useWebPush(pushAccount);
  const pushActive = useRef(false);
  useEffect(() => { pushActive.current = push.status === 'active'; }, [push.status]);
  const tracker = useRef(new TicketAlertTracker());
  const account = useRef<string | null>(null);
  const preferenceKey = useRef<string | null>(null);
  const wantsSound = useRef(false);
  const audio = useRef<AudioContext | null>(null);
  const activating = useRef<string | null>(null);
  const mounted = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const listRequest = useRef<AbortController | null>(null);
  const listRevision = useRef(0);
  const filter = useRef<'all' | 'unread'>('all');
  const loadedCount = useRef(20);
  const cursor = useRef<string | null>(null);
  const pendingMutations = useRef(0);
  const mutationQueue = useRef(Promise.resolve());
  const acknowledgedAt = useRef('');
  const appliedAt = useRef('');

  const applyPage = useCallback((page: AlertsPage, append = false) => {
    if (appliedAt.current && page.snapshotAt < appliedAt.current) {
      setState(previous => ({ ...previous, loading: false }));
      return;
    }
    appliedAt.current = page.snapshotAt;
    tracker.current.acknowledge(page.items.filter(item => !isUnreadAlert(item)).map(item => item.id));
    cursor.current = page.nextCursor;
    setState(previous => {
      const items = mergeAlertPages(previous.items, page.items, append).filter(item => filter.current === 'all' || isUnreadAlert(item));
      return { ...previous, items, unreadIds: items.filter(isUnreadAlert).map(item => item.id), unreadCount: page.unreadCount,
        nextCursor: page.nextCursor, loading: false, error: '' };
    });
  }, []);

  const refreshList = useCallback(async (append = false) => {
    if (!account.current || pendingMutations.current) return;
    const forAccount = account.current, forFilter = filter.current;
    if (append && !cursor.current) return;
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    const revision = ++listRevision.current;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const firstCursor = append ? cursor.current : null;
    setState(previous => ({ ...previous, loading: true, error: '' }));
    try {
      const desired = append ? 20 : Math.max(20, loadedCount.current);
      let nextCursor = firstCursor;
      let combined: TicketAlert[] = [];
      let page: AlertsPage;
      do {
        const params = new URLSearchParams({ filter: forFilter, limit: '20' });
        if (nextCursor) params.set('cursor', nextCursor);
        const response = await daybookFetch(`/api/alerts?${params}`, { cache: 'no-store', signal: controller.signal, headers: { [ALERT_VIEWER_HEADER]: forAccount.split(':')[0] } });
        const result = await response.json();
        if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'No se pudieron actualizar tus avisos.');
        page = result as AlertsPage;
        combined = mergeAlertPages(combined, page.items, true);
        nextCursor = page.nextCursor;
      } while (!append && nextCursor && combined.length < desired);
      if (!mounted.current || account.current !== forAccount || filter.current !== forFilter || revision !== listRevision.current || controller.signal.aborted) return;
      applyPage({ ...page, items: combined }, append);
      loadedCount.current = append ? loadedCount.current + combined.length : Math.max(20, combined.length);
    } catch (failure) {
      if (mounted.current && account.current === forAccount && revision === listRevision.current) {
        setState(previous => ({ ...previous, loading: false, error: failure instanceof Error && failure.name !== 'AbortError' ? failure.message : 'No se pudieron actualizar tus avisos. Vuelve a intentarlo.' }));
      }
    } finally {
      clearTimeout(timeout);
      if (listRequest.current === controller) listRequest.current = null;
    }
  }, [applyPage]);

  const markRead = useCallback((change: { ids: string[] } | { all: true }) => {
    const forAccount = account.current;
    if (!forAccount) return;
    pendingMutations.current++;
    listRequest.current?.abort();
    listRevision.current++;
    setState(previous => ({ ...previous, saving: true, loading: false, error: '' }));
    mutationQueue.current = mutationQueue.current.catch(() => {}).then(async () => {
      if (account.current !== forAccount) return;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await daybookFetch('/api/alerts', { method: 'PATCH', headers: { 'Content-Type': 'application/json', [ALERT_VIEWER_HEADER]: forAccount.split(':')[0] }, body: JSON.stringify(change), signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'No se pudo guardar la lectura.');
        if (!mounted.current || account.current !== forAccount) return;
        const page = result as AlertsPage;
        acknowledgedAt.current = page.snapshotAt;
        loadedCount.current = 20;
        applyPage(page);
        setState(previous => ({ ...previous, latest: previous.latest && ('all' in change || change.ids.includes(previous.latest.id)) ? null : previous.latest }));
      } catch (failure) {
        if (mounted.current && account.current === forAccount) setState(previous => ({ ...previous, error: failure instanceof Error && failure.name !== 'AbortError' ? failure.message : 'No se pudo guardar la lectura. Vuelve a intentarlo.' }));
      } finally { clearTimeout(timeout); }
    }).finally(() => {
      pendingMutations.current = Math.max(0, pendingMutations.current - 1);
      if (mounted.current && account.current === forAccount && !pendingMutations.current) {
        setState(previous => ({ ...previous, saving: false }));
        if (filter.current === 'unread') void refreshList();
      }
    });
  }, [applyPage, refreshList]);

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

  const receive = useCallback((workspace: Workspace) => {
    const viewerKey = workspace.viewer ? `${workspace.viewer.id}:${workspace.viewer.role}` : null;
    const changedAccount = account.current !== viewerKey;
    const page = workspace.alertsPage;
    const items = workspace.alerts;
    const fresh = tracker.current.receive(viewerKey, items);
    if (changedAccount) {
      account.current = viewerKey;
      setPushAccount(viewerKey);
      preferenceKey.current = workspace.viewer ? workspaceStorageKey(`daybook.ticket.sound.v1.${workspace.viewer.id}`) : null;
      wantsSound.current = false;
      try { wantsSound.current = Boolean(preferenceKey.current && localStorage.getItem(preferenceKey.current) === 'on'); } catch { /* Sound can still be enabled for this session. */ }
      if (audio.current) void audio.current.close().catch(() => {});
      audio.current = null;
      clearTimeout(toastTimer.current);
      listRequest.current?.abort();
      listRevision.current++;
      filter.current = 'all';
      loadedCount.current = 20;
      acknowledgedAt.current = '';
      appliedAt.current = page?.snapshotAt || '';
      cursor.current = page?.nextCursor || null;
      setState({ ...INITIAL, items, unreadIds: items.filter(isUnreadAlert).map(item => item.id), unreadCount: page?.unreadCount || 0, nextCursor: page?.nextCursor || null });
      return;
    }
    if (!viewerKey) return;
    const latest = fresh.filter(isUnreadAlert).at(-1);
    const availableIds = new Set(items.map(item => item.id));
    const canApply = !pendingMutations.current && (!page || !acknowledgedAt.current || page.snapshotAt > acknowledgedAt.current);
    if (canApply && page) {
      if (filter.current === 'all' && loadedCount.current <= 20) applyPage(page);
      else if (!listRequest.current) void refreshList();
    }
    setState(previous => ({
      ...previous,
      latest: latest || (previous.latest && availableIds.has(previous.latest.id) ? previous.latest : null),
      soundEnabled: wantsSound.current && audio.current?.state === 'running',
    }));
    if (!latest) return;
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => { if (mounted.current) setState(previous => ({ ...previous, latest: null })); }, 12_000);
    if (wantsSound.current && audio.current?.state === 'running' && (!pushActive.current || document.visibilityState === 'visible')) {
      void deliverAlertOnce(viewerKey, 'sound', fresh.map(item => item.id),
        () => mounted.current && account.current === viewerKey && wantsSound.current && audio.current?.state === 'running' && (!pushActive.current || document.visibilityState === 'visible'),
        () => { if (audio.current) chime(audio.current); });
    }
  }, [applyPage, refreshList]);

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
      listRequest.current?.abort();
      if (audio.current) void audio.current.close().catch(() => {});
    };
  }, [enableSound]);

  useEffect(() => {
    const title = 'Daybook Ticket — Servicios Daybook';
    document.title = state.unreadCount ? `(${state.unreadCount}) ${title}` : title;
    return () => { document.title = title; };
  }, [state.unreadCount]);

  return {
    ...state, push, receive, toggleSound, hasMore: state.nextCursor !== null,
    dismissLatest: () => setState(previous => ({ ...previous, latest: null })),
    markRead: id => markRead({ ids: [id] }),
    markAllRead: () => markRead({ all: true }),
    setFilter: next => {
      if (filter.current === next) return;
      filter.current = next;
      loadedCount.current = 20;
      cursor.current = null;
      setState(previous => ({ ...previous, filter: next, items: [], unreadIds: [], nextCursor: null }));
      void refreshList();
    },
    loadMore: () => { if (!listRequest.current) void refreshList(true); },
    refresh: () => { void refreshList(); },
  };
}
