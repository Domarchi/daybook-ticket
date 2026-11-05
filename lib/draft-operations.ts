import { workspaceStorageKey } from './workspace-client';
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export class DraftOperations {
  private readonly values = new Map<string, { payload: string; id: string }>();
  constructor(private readonly storage: StoragePort | null, private readonly uuid = () => crypto.randomUUID()) {}
  previous(scope: string): { id: string; payload: unknown } | null {
    const key = workspaceStorageKey(`daybook.ticket.operation.v1.${scope}`);
    try {
      const stored = this.values.get(key) || JSON.parse(this.storage?.getItem(key) || 'null');
      if (stored && typeof stored.id === 'string' && typeof stored.payload === 'string') return { id: stored.id, payload: JSON.parse(stored.payload) };
    } catch { /* No recoverable previous attempt. */ }
    return null;
  }
  forPayload(scope: string, payload: unknown): string {
    const key = workspaceStorageKey(`daybook.ticket.operation.v1.${scope}`);
    const serialized = JSON.stringify(payload);
    let previous = this.values.get(key);
    if (!previous) {
      try {
        const raw: unknown = JSON.parse(this.storage?.getItem(key) || 'null');
        if (raw && typeof raw === 'object' && 'payload' in raw && typeof raw.payload === 'string' && 'id' in raw && typeof raw.id === 'string') previous = { payload: raw.payload, id: raw.id };
      } catch { /* In-memory retries still retain their ID. */ }
    }
    if (previous?.payload === serialized) return previous.id;
    const next = { payload: serialized, id: this.uuid() };
    this.values.set(key, next);
    try { this.storage?.setItem(key, JSON.stringify(next)); } catch { /* Retain the ID in memory. */ }
    return next.id;
  }
  clear(scope: string) {
    const key = workspaceStorageKey(`daybook.ticket.operation.v1.${scope}`);
    this.values.delete(key);
    try { this.storage?.removeItem(key); } catch { /* A changed payload receives a new ID. */ }
  }
}
let browserOperations: DraftOperations | undefined;
export function getDraftOperations() {
  if (typeof window === 'undefined') return new DraftOperations(null);
  if (!browserOperations) {
    let storage: Storage | null = null;
    try { storage = window.sessionStorage; } catch { /* Optional browser persistence. */ }
    browserOperations = new DraftOperations(storage);
  }
  return browserOperations;
}
