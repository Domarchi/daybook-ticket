'use client';
import { currentWorkspaceId } from '@/lib/workspace-client';
import { workspaceHome } from '@/lib/workspace-model';
import { workspaceFetch } from '@/lib/workspace-client';


import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, type Workspace } from '@/lib/types';

const EMPTY: Workspace = { viewer: null, members: [], companies: [], savedReplies: [], mailStatus: null, tickets: [], messages: [], alerts: [], articles: [], settings: DEFAULT_SETTINGS, demoLoaded: false };
const INTERVAL = 5_000;
export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';
type Feed = Pick<Workspace, 'viewer' | 'tickets' | 'messages' | 'alerts' | 'alertsPage' | 'ticketCounts' | 'ticketDepartments' | 'ticketPage'>;

class ReadError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function read<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await workspaceFetch(path, { signal, cache: 'no-store' });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new ReadError(typeof result.error === 'string' ? result.error : 'No se pudo actualizar la conversación.', response.status);
  }
  return response.json();
}

export function useWorkspace(onSnapshot: (workspace: Workspace) => void) {
  const [data, setData] = useState<Workspace>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [connection, setConnection] = useState<ConnectionStatus>('connecting');
  const snapshot = useRef(EMPTY);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const denied = useRef(false);

  const refresh = useCallback(async (full = true): Promise<Workspace> => {
    // A refresh after saving must supersede any read started before that save.
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const previousViewerId = snapshot.current.viewer?.id;
    const timeout = setTimeout(() => controller.abort(new Error('La conexión tardó demasiado.')), 15_000);
    const commit = (next: Workspace) => {
      snapshot.current = next;
      setData(next);
      onSnapshot(next);
    };
    try {
      let next: Workspace;
      if (full || !snapshot.current.viewer) {
        next = await read<Workspace>('/api/workspace', controller.signal);
      } else {
        const feed = await read<Feed>('/api/tickets/updates', controller.signal);
        const previous = snapshot.current;
        if (feed.viewer?.id !== previous.viewer?.id) {
          // Another tab changed accounts. Never carry a previous user's drafts over.
          if (mounted.current && active.current === controller) {
            denied.current = true;
            commit(EMPTY);
            window.location.replace('/login');
          }
          throw new DOMException('La sesión cambió.', 'AbortError');
        }
        if (feed.viewer?.role !== previous.viewer?.role || feed.viewer?.customerCompanyId !== previous.viewer?.customerCompanyId || feed.viewer?.companyAccess !== previous.viewer?.companyAccess) {
          if (mounted.current && active.current === controller) commit(EMPTY);
          next = await read<Workspace>('/api/workspace', controller.signal);
        } else {
          next = { ...previous, ...feed };
        }
      }
      if (!mounted.current || active.current !== controller || controller.signal.aborted) {
        throw new DOMException('La lectura fue reemplazada.', 'AbortError');
      }
      if (previousViewerId && next.viewer?.id !== previousViewerId) {
        denied.current = true;
        commit(EMPTY);
        window.location.replace('/login');
        throw new DOMException('La sesión cambió.', 'AbortError');
      }
      commit(next);
      denied.current = false;
      setLoadError('');
      setConnection('live');
      return next;
    } catch (failure) {
      if (mounted.current && active.current === controller && !(failure instanceof Error && failure.name === 'AbortError')) {
        if (failure instanceof ReadError && failure.status===428) {
          denied.current=true; commit(EMPTY); const id=currentWorkspaceId();window.location.replace(`${id==='daybook'?'/security':`/w/${id}/security`}?return_to=${encodeURIComponent(workspaceHome(id,Number(new URLSearchParams(window.location.search).get('ticket'))))}`);
        } else if (failure instanceof ReadError && (failure.status === 401 || failure.status === 403 || failure.status===423)) {
          denied.current = true;
          commit(EMPTY);
          setLoadError('Tu sesión terminó o tu acceso cambió. Vuelve a iniciar sesión.');
        } else {
          setConnection(navigator.onLine ? 'reconnecting' : 'offline');
          if (!snapshot.current.viewer) setLoadError('No se pudo cargar tu espacio. Reintentaremos al recuperar la conexión.');
        }
      }
      throw failure;
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) {
        active.current = null;
        if (mounted.current) setLoading(false);
      }
    }
  }, [onSnapshot]);

  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let failures = 0;
    const available = () => navigator.onLine;
    const schedule = () => {
      clearTimeout(timer);
      if (!stopped && !denied.current && available()) {
        const interval = document.visibilityState === 'hidden' ? 15_000 : INTERVAL;
        timer = setTimeout(tick, Math.min(interval * 2 ** failures, 60_000));
      }
    };
    const tick = async () => {
      clearTimeout(timer);
      if (stopped || denied.current || !available()) return;
      if (active.current) { schedule(); return; }
      try {
        await refresh(false);
        failures = 0;
      } catch (failure) {
        if (!(failure instanceof Error && failure.name === 'AbortError')) failures = Math.min(failures + 1, 3);
      } finally { schedule(); }
    };
    const resume = () => { if (available()) { failures = 0; if (document.visibilityState === 'hidden') schedule(); else void tick(); } else clearTimeout(timer); };
    const offline = () => { clearTimeout(timer); setConnection('offline'); };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', offline);
    // Initial loading is also retried automatically after a temporary failure.
    timer = setTimeout(() => {
      if (navigator.onLine) void tick();
      else { setConnection('offline'); setLoading(false); setLoadError('Sin conexión. Tu espacio se abrirá cuando vuelvas a conectarte.'); }
    }, 0);
    return () => {
      stopped = true;
      mounted.current = false;
      clearTimeout(timer);
      active.current?.abort();
      active.current = null;
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', offline);
    };
  }, [refresh]);

  return { data, loading, loadError, connection, refresh };
}
