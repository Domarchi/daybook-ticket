import type { MemberRole, TicketPriority } from './types';

/** The priority a ticket starts with when nobody on the team chose one (the portal, inbound mail). */
export const DEFAULT_TICKET_PRIORITY: TicketPriority = 'normal';

/**
 * The priority a new ticket is saved with. The team sets priority: a client creating from the portal gets the
 * default whatever the request carries, so a hand-made request cannot jump the queue or shorten its own SLA.
 * Staff keep choosing it. The SLA deadline is computed from this value, never from the raw request.
 */
export function creationPriority(role: MemberRole, requested: TicketPriority | undefined): TicketPriority {
  if (role === 'client') return DEFAULT_TICKET_PRIORITY;
  return requested ?? DEFAULT_TICKET_PRIORITY;
}
