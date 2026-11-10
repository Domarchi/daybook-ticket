import { ApiError } from './server';
import {
  calculateTicketDueAt,
  readServicePolicySnapshot,
  SlaCalculationError,
  type ServicePolicySnapshot,
} from './sla-policy';
import type { Ticket, TicketPriority } from './types';

export function storedTicketPolicy(ticket: Pick<Ticket, 'slaPolicySnapshot'>): ServicePolicySnapshot | null {
  const snapshot = readServicePolicySnapshot(ticket.slaPolicySnapshot);
  if (ticket.slaPolicySnapshot && !snapshot)
    throw new ApiError(409, 'La política histórica del ticket necesita revisión.');
  return snapshot;
}

export function resolutionDeadline(startedAt: string, priority: TicketPriority, policy: ServicePolicySnapshot): string {
  try {
    return calculateTicketDueAt(startedAt, priority, policy);
  } catch (error) {
    if (error instanceof SlaCalculationError) throw new ApiError(400, error.message);
    throw error;
  }
}
