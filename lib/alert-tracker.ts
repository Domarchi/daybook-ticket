import type { TicketAlert } from './types';
import { isUnreadAlert } from './alerts-state';

/** Tracks arrivals for one signed-in account/role without replaying its history. */
export class TicketAlertTracker {
  private viewerKey: string | null = null;
  private readonly seen = new Set<string>();

  /** A saved read received ahead of an older poll must never announce again. */
  acknowledge(ids: string[]): void {
    for (const id of ids) this.seen.add(id);
  }

  receive(viewerKey: string | null, items: TicketAlert[]): TicketAlert[] {
    if (viewerKey === null) {
      this.viewerKey = null;
      this.seen.clear();
      return [];
    }

    if (this.viewerKey !== viewerKey) {
      this.viewerKey = viewerKey;
      this.seen.clear();
      for (const item of items) this.seen.add(item.id);
      return [];
    }

    const fresh: TicketAlert[] = [];
    for (const item of items) {
      if (this.seen.has(item.id)) continue;
      this.seen.add(item.id);
      if (isUnreadAlert(item)) fresh.push(item);
    }

    // Keep IDs for the session, including those outside the latest feed window.
    // A later reappearance must not play the same alert again.
    return fresh.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
  }
}
