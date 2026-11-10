import type { TicketAlert } from './types';

export const ALERT_VIEWER_HEADER = 'X-Daybook-Member-Id';
export function matchesAlertsViewer(expected: string | null, memberId: string): boolean {
  return expected === memberId;
}

export function isUnreadAlert(item: TicketAlert): boolean {
  return !item.historical && item.readAt === null;
}

/** Read state only moves forward; delayed polling cannot resurrect an acknowledged event. */
export function mergeAlertPages(current: TicketAlert[], incoming: TicketAlert[], append = false): TicketAlert[] {
  const previous = new Map(current.map(item => [item.id, item]));
  const merged = incoming.map(item => ({ ...item, readAt: item.readAt || previous.get(item.id)?.readAt || null }));
  if (!append) return merged;
  const updates = new Map(merged.map(item => [item.id, item]));
  const ids = new Set(current.map(item => item.id));
  return [...current.map(item => updates.get(item.id) || item), ...merged.filter(item => !ids.has(item.id))];
}
