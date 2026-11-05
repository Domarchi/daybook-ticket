'use client';
import type { PresenceActivity } from './ticket-presence-model';

export const TICKET_PRESENCE_ACTIVITY_EVENT = 'daybook:ticket-presence-activity';
let tabId: string | null = null;
/** Generated for this document's JS realm, not copied from auth or storage.
 * Duplicating a browser tab therefore cannot reuse an authentication token. */
export function ticketPresenceTabId(): string {
  tabId ??= crypto.randomUUID();
  return tabId;
}
export function notifyTicketPresenceActivity(ticketId: number, activity: Exclude<PresenceActivity, 'viewing'>): void {
  window.dispatchEvent(new CustomEvent(TICKET_PRESENCE_ACTIVITY_EVENT, { detail: { ticketId, activity } }));
}
