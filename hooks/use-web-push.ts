'use client';

import { workspaceHome } from '@/lib/workspace-model';
import { currentWorkspaceId } from '@/lib/workspace-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  activePushRegistration,
  announcePushChange,
  publicPushKey,
  PUSH_CHANGED_EVENT,
  PUSH_STORAGE_KEY,
  pushRequest,
  supportsWebPush,
} from '@/lib/push-client';

type PushStatus = 'loading' | 'unsupported' | 'unconfigured' | 'blocked' | 'inactive' | 'active' | 'error';
export interface WebPushControls {
  status: PushStatus;
  busy: boolean;
  error: string;
  notice: string;
  enable: () => void;
  disable: () => void;
  test: () => void;
  testLocal: () => void;
  refresh: () => void;
}
interface PushState {
  status: PushStatus;
  busy: boolean;
  error: string;
  notice: string;
  publicKey: string | null;
  subscriptionId: string | null;
}
const INITIAL: PushState = {
  status: 'loading',
  busy: false,
  error: '',
  notice: '',
  publicKey: null,
  subscriptionId: null,
};

export function useWebPush(account: string | null): WebPushControls {
  const [state, setState] = useState<PushState>(INITIAL);
  const activeAccount = useRef<string | null>(null);
  const mounted = useRef(false);
  const operation = useRef(false);
  const generation = useRef(0);
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    if (!activeAccount.current || operation.current) return;
    const version = ++requestVersion.current;
    const forGeneration = generation.current;
    const current = () =>
      mounted.current &&
      forGeneration === generation.current &&
      version === requestVersion.current &&
      !operation.current;
    if (!supportsWebPush()) {
      if (current()) setState({ ...INITIAL, status: 'unsupported' });
      return;
    }
    try {
      const config = await pushRequest<{ configured: boolean; publicKey: string | null }>('/api/push');
      const permission = Notification.permission;
      if (!config.configured || !config.publicKey) {
        if (current()) setState({ ...INITIAL, status: 'unconfigured' });
        return;
      }
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      const saved = subscription
        ? await pushRequest<{ enabled: boolean; subscriptionId: string | null }>('/api/push', 'PATCH', {
            endpoint: subscription.endpoint,
          })
        : null;
      if (current())
        setState(previous => ({
          ...previous,
          publicKey: config.publicKey,
          subscriptionId: saved?.enabled ? saved.subscriptionId : null,
          status:
            permission === 'denied' ? 'blocked' : permission === 'granted' && saved?.enabled ? 'active' : 'inactive',
          error: '',
        }));
      // Fetch new worker versions without prompting or enrolling this account.
      if (registration) void registration.update().catch(() => {});
    } catch (failure) {
      if (current())
        setState(previous => ({
          ...previous,
          status: 'error',
          error: failure instanceof Error ? failure.message : 'No se pudo comprobar el estado de los avisos.',
        }));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    activeAccount.current = account;
    generation.current += 1;
    operation.current = false;
    setState(INITIAL);
    void refresh();
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === PUSH_STORAGE_KEY) void refresh();
    };
    window.addEventListener('focus', visible);
    window.addEventListener(PUSH_CHANGED_EVENT, visible);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', visible);
    return () => {
      mounted.current = false;
      generation.current += 1;
      window.removeEventListener('focus', visible);
      window.removeEventListener(PUSH_CHANGED_EVENT, visible);
      window.removeEventListener('storage', storage);
      document.removeEventListener('visibilitychange', visible);
      // Deliberately do not unsubscribe when the page closes or the component unmounts.
    };
  }, [account, refresh]);

  const enable = useCallback(async () => {
    if (!activeAccount.current || operation.current || !state.publicKey || !supportsWebPush()) return;
    operation.current = true;
    requestVersion.current += 1;
    const forGeneration = generation.current;
    const expectedMemberId = activeAccount.current.split(':')[0];
    const current = () => mounted.current && forGeneration === generation.current;
    setState(previous => ({ ...previous, busy: true, error: '', notice: '' }));
    let createdSubscription: PushSubscription | null = null;
    try {
      // Keep this before the first await: browsers require a direct user gesture.
      const permission = await Notification.requestPermission();
      if (!current()) return;
      if (permission !== 'granted') {
        setState(previous => ({
          ...previous,
          status: permission === 'denied' ? 'blocked' : 'inactive',
          notice: permission === 'default' ? 'No se activaron los avisos. Puedes intentarlo cuando quieras.' : '',
        }));
        return;
      }
      const registration = await activePushRegistration();
      if (!current()) return;
      let subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const saved = await pushRequest<{ enabled: boolean; subscriptionId: string | null }>('/api/push', 'PATCH', {
          endpoint: subscription.endpoint,
        });
        if (!current()) return;
        if (!saved.enabled) {
          // Other workspaces may use the same native browser subscription.

          subscription = null;
        }
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicPushKey(state.publicKey),
        });
        createdSubscription = subscription;
      }
      if (!current()) {
        await createdSubscription?.unsubscribe();
        return;
      }
      const result = await pushRequest<{ subscriptionId: string }>('/api/push', 'POST', {
        subscription: subscription.toJSON(),
        expectedMemberId,
      });
      if (!current()) {
        await createdSubscription?.unsubscribe();
        return;
      }
      setState(previous => ({
        ...previous,
        status: 'active',
        subscriptionId: result.subscriptionId,
        notice: 'Avisos activados en este navegador. Puedes cerrar la pestaña; mantén tu sesión iniciada.',
      }));
      announcePushChange();
    } catch (failure) {
      if (createdSubscription) await createdSubscription.unsubscribe().catch(() => false);
      if (current())
        setState(previous => ({
          ...previous,
          status: Notification.permission === 'denied' ? 'blocked' : 'inactive',
          error: failure instanceof Error ? failure.message : 'No se pudieron activar los avisos en este navegador.',
        }));
    } finally {
      if (current()) {
        operation.current = false;
        setState(previous => ({ ...previous, busy: false }));
      }
    }
  }, [state.publicKey]);

  const disable = useCallback(async () => {
    if (!activeAccount.current || operation.current || !supportsWebPush()) return;
    operation.current = true;
    requestVersion.current += 1;
    const forGeneration = generation.current;
    const current = () => mounted.current && forGeneration === generation.current;
    setState(previous => ({ ...previous, busy: true, error: '', notice: '' }));
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      if (!current()) return;
      if (subscription) {
        await pushRequest('/api/push', 'DELETE', { endpoint: subscription.endpoint });
        // Other workspaces may use the same native browser subscription.
      }
      const notifications = await registration?.getNotifications();
      notifications
        ?.filter(notification => {
          try {
            return new URL(notification.data?.url, location.origin).pathname === workspaceHome(currentWorkspaceId());
          } catch {
            return false;
          }
        })
        .forEach(notification => notification.close());
      if (current()) {
        setState(previous => ({
          ...previous,
          status: 'inactive',
          subscriptionId: null,
          notice: 'Los avisos con la página cerrada están desactivados en este navegador.',
        }));
        announcePushChange();
      }
    } catch (failure) {
      if (current())
        setState(previous => ({
          ...previous,
          error: failure instanceof Error ? failure.message : 'No se pudieron desactivar los avisos. Intenta de nuevo.',
        }));
    } finally {
      if (current()) {
        operation.current = false;
        setState(previous => ({ ...previous, busy: false }));
      }
    }
  }, []);

  const test = useCallback(async () => {
    if (!activeAccount.current || operation.current || !state.subscriptionId) return;
    operation.current = true;
    const forGeneration = generation.current;
    const current = () => mounted.current && forGeneration === generation.current;
    setState(previous => ({ ...previous, busy: true, error: '', notice: '' }));
    try {
      await pushRequest('/api/push/test', 'POST', { subscriptionId: state.subscriptionId });
      if (current())
        setState(previous => ({
          ...previous,
          notice:
            'Prueba enviada. Comprueba el centro de notificaciones de tu computador. El sonido depende de sus ajustes.',
        }));
    } catch (failure) {
      if (current())
        setState(previous => ({
          ...previous,
          error: failure instanceof Error ? failure.message : 'No se pudo enviar el aviso de prueba.',
        }));
    } finally {
      if (current()) {
        operation.current = false;
        setState(previous => ({ ...previous, busy: false }));
      }
    }
  }, [state.subscriptionId]);

  const testLocal = useCallback(async () => {
    if (!activeAccount.current || operation.current || state.status !== 'active' || !supportsWebPush()) return;
    operation.current = true;
    requestVersion.current += 1;
    const forGeneration = generation.current;
    const current = () => mounted.current && forGeneration === generation.current;
    setState(previous => ({ ...previous, busy: true, error: '', notice: '' }));
    try {
      if (Notification.permission !== 'granted')
        throw new Error('Permite las notificaciones de Daybook Ticket en los ajustes de tu navegador.');
      const registration = await navigator.serviceWorker.getRegistration('/');
      if (!current()) return;
      if (!registration?.active)
        throw new Error('Vuelve a cargar Daybook Ticket para preparar los avisos y repite la prueba.');
      // This explicit test isolates the computer's notification settings from remote delivery.
      await registration.showNotification('Daybook Ticket', {
        body: 'Esta es una prueba de notificaciones en tu computador.',
        tag: 'daybook-local-test',
        icon: '/icons/daybook-192.png',
        silent: false,
        data: { url: workspaceHome(currentWorkspaceId()) },
      });
      if (current())
        setState(previous => ({
          ...previous,
          notice: 'Prueba local solicitada. Si no aparece, revisa las notificaciones del navegador en tu computador.',
        }));
    } catch (failure) {
      if (current())
        setState(previous => ({
          ...previous,
          status: Notification.permission === 'denied' ? 'blocked' : previous.status,
          error:
            failure instanceof Error
              ? failure.message
              : 'No se pudo mostrar la prueba local. Revisa los permisos de notificación de tu navegador.',
        }));
    } finally {
      if (current()) {
        operation.current = false;
        setState(previous => ({ ...previous, busy: false }));
      }
    }
  }, [state.status]);

  return {
    status: state.status,
    busy: state.busy,
    error: state.error,
    notice: state.notice,
    enable,
    disable,
    test,
    testLocal,
    refresh,
  };
}
