type Channel = 'sound' | 'desktop';
type DeliveryStorage = Pick<Storage, 'getItem' | 'setItem'>;
export interface AlertDeliveryDependencies {
  storage?: DeliveryStorage;
  withLock?: (name: string, action: () => void) => Promise<void>;
}

const MAX_IDS = 200;
const localSeen = new Map<string, string[]>();

function browserDependencies(): AlertDeliveryDependencies {
  const dependencies: AlertDeliveryDependencies = {};
  try { if (typeof window !== 'undefined') dependencies.storage = window.localStorage; } catch { /* Storage can be blocked. */ }
  try {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      dependencies.withLock = async (name, action) => { await navigator.locks.request(name, { mode: 'exclusive' }, action); };
    }
  } catch { /* Older or restricted browsers can still alert in this tab. */ }
  return dependencies;
}

/** Deliver at most once across tabs where Web Locks and storage are available. */
export async function deliverAlertOnce(
  viewerKey: string,
  channel: Channel,
  ids: string[],
  canDeliver: () => boolean,
  deliver: () => void,
  dependencies: AlertDeliveryDependencies = browserDependencies(),
): Promise<void> {
  if (!ids.length) return;
  const key = `daybook.ticket.alert-delivery.v1.${encodeURIComponent(viewerKey)}.${channel}`;
  let attempted = false;
  const attempt = () => {
    attempted = true;
    try {
      // Eligibility can change while another tab holds the lock (mute/logout).
      if (!canDeliver()) return;
      let stored: string[] = [];
      try {
        const parsed: unknown = JSON.parse(dependencies.storage?.getItem(key) || '[]');
        if (Array.isArray(parsed)) stored = parsed.filter((id): id is string => typeof id === 'string').slice(-MAX_IDS);
      } catch { /* Fall back to memory for this tab. */ }
      const seen = new Set([...stored, ...(localSeen.get(key) || [])]);
      if (!ids.some(id => !seen.has(id))) return;

      // A failed sound/notification must remain available to another eligible tab.
      deliver();
      for (const id of ids) seen.add(id);
      const remembered = [...seen].slice(-MAX_IDS);
      localSeen.delete(key);
      localSeen.set(key, remembered);
      if (localSeen.size > 32) localSeen.delete(localSeen.keys().next().value!);
      try { dependencies.storage?.setItem(key, JSON.stringify(remembered)); } catch { /* Memory still prevents repeats within this tab. */ }
    } catch { /* Delivery errors must not interrupt the ticket conversation. */ }
  };

  if (dependencies.withLock) {
    try { await dependencies.withLock(key, attempt); }
    catch { if (!attempted) attempt(); }
  } else {
    // Synchronous read/deliver/write is best effort across tabs without Web Locks.
    attempt();
  }
}
