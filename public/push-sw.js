/* Daybook Ticket: background notifications only. No pages or private data are cached. */
'use strict';

self.addEventListener('install', event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });

const recentEvents = new Set();
let deliveryQueue = Promise.resolve();

function seenDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('daybook-ticket-push-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('seen', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Storage unavailable'));
  });
}

async function alreadySeen(id) {
  if (recentEvents.has(id)) return true;
  try {
    const database = await seenDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const request = database.transaction('seen').objectStore('seen').get(id);
        request.onsuccess = () => resolve(Boolean(request.result));
        request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  } catch { return false; }
}

async function remember(id) {
  recentEvents.add(id);
  while (recentEvents.size > 200) recentEvents.delete(recentEvents.values().next().value);
  try {
    const database = await seenDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('seen', 'readwrite');
        const store = transaction.objectStore('seen');
        store.put({ id, at: Date.now() });
        const request = store.getAll();
        request.onsuccess = () => {
          const ordered = request.result.sort((a, b) => b.at - a.at);
          ordered.slice(200).forEach(item => store.delete(item.id));
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally { database.close(); }
  } catch { /* A stable notification tag still replaces duplicate delivered events. */ }
}

function safeTicketUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin || url.pathname !== '/' || url.hash) return null;
    if (url.search && !/^\?ticket=[1-9]\d*$/.test(url.search)) return null;
    return url.href;
  } catch { return null; }
}

async function deliver(event) {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  if (!payload || typeof payload.subscriptionId !== 'string' || payload.subscriptionId.length > 100) return;
  if (payload.test !== true && (typeof payload.eventId !== 'string' || payload.eventId.length > 100)) return;
  const eventKey = payload.test === true ? null : `${payload.subscriptionId}:${payload.eventId}`;
  if (eventKey && await alreadySeen(eventKey)) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let notification;
  try {
    // Recheck the live login and ticket access before showing anything on a shared computer.
    const response = await fetch('/api/push/receipt', {
      method: 'POST', credentials: 'include', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscriptionId: payload.subscriptionId, ...(payload.test === true ? { test: true } : { eventId: payload.eventId }) }),
    });
    if (!response.ok) return;
    notification = await response.json();
  } catch { return; }
  finally { clearTimeout(timeout); }
  const url = safeTicketUrl(notification.url);
  if (!url || typeof notification.title !== 'string' || notification.title.length > 120
    || typeof notification.body !== 'string' || notification.body.length > 300
    || typeof notification.tag !== 'string' || notification.tag.length > 200) return;

  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const deskVisible = windows.some(client => {
    try { return client.visibilityState === 'visible' && new URL(client.url).pathname === '/'; }
    catch { return false; }
  });
  await self.registration.showNotification(notification.title, {
    body: notification.body,
    tag: notification.tag,
    icon: '/icons/daybook-192.png',
    badge: '/icons/daybook-192.png',
    silent: deskVisible,
    data: { url },
  });
  if (eventKey) await remember(eventKey);
}

self.addEventListener('push', event => {
  // Serialize deliveries so provider retries cannot ring twice in the same worker.
  deliveryQueue = deliveryQueue.then(() => deliver(event)).catch(() => {});
  event.waitUntil(deliveryQueue);
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = safeTicketUrl(event.notification.data?.url);
  if (url) {
    // A new tab preserves any reply the person is composing in an existing tab.
    event.waitUntil(self.clients.openWindow(url));
  }
});
