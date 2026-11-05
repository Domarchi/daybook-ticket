import { workspaceFetch } from '@/lib/workspace-client';
export const PUSH_CHANGED_EVENT = 'daybook-ticket-push-changed';
export const PUSH_STORAGE_KEY = 'daybook.ticket.push.changed.v1';

export function supportsWebPush() {
  return typeof window !== 'undefined' && window.isSecureContext && 'Notification' in window
    && 'serviceWorker' in navigator && 'PushManager' in window;
}

export async function pushRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await workspaceFetch(path, {
      method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = result && typeof result === 'object' && 'error' in result ? result.error : null;
      throw new Error(typeof message === 'string' ? message : 'No se pudo actualizar la configuración de avisos.');
    }
    return result as T;
  } catch (failure) {
    if (controller.signal.aborted) throw new Error('La conexión tardó demasiado. Intenta de nuevo.');
    throw failure;
  } finally { clearTimeout(timeout); }
}

export function announcePushChange() {
  window.dispatchEvent(new Event(PUSH_CHANGED_EVENT));
  try { localStorage.setItem(PUSH_STORAGE_KEY, String(Date.now())); } catch { /* Other tabs also refresh on focus. */ }
}

export function publicPushKey(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}

export async function activePushRegistration() {
  const registration = await navigator.serviceWorker.register('/push-sw.js', { scope: '/', updateViaCache: 'none' });
  if (registration.active) return registration;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('El navegador no pudo preparar los avisos. Vuelve a intentarlo.')), 15_000); }),
    ]);
  } finally { clearTimeout(timeout); }
}

// Called only by the explicit sign-out action. Closing a tab must keep its subscription.
export async function disconnectPushOnSignOut() {
  if (!supportsWebPush()) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      // Start both operations while the current authenticated session still exists.
      await Promise.allSettled([
        pushRequest('/api/account/push', 'DELETE', { endpoint: subscription.endpoint }),
        subscription.unsubscribe(),
      ]);
    }
    const notifications = await registration?.getNotifications();
    notifications?.forEach(notification => notification.close());
    announcePushChange();
  } catch { /* Signing out still invalidates the server receipt authorization. */ }
}
