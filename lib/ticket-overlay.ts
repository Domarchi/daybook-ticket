import type { Ticket } from './types';

/**
 * Optimistic ticket changes. A change shows on screen the moment it is made; the server answer then
 * confirms it or takes it back. Two things keep that honest:
 *
 *  - every change gets a sequence number per field, so a late answer for an older change can neither
 *    undo nor confirm a newer one;
 *  - the last ticket the server returned (`confirmed`) is kept until the regular refresh delivers a
 *    version at least as new, so the screen never flickers back to the old value in between and the
 *    next change that needs `expectedVersion` (assignment) sends the right one.
 */
export type TicketPatch = Partial<Pick<Ticket, 'status' | 'priority' | 'department' | 'requesterMemberId'>>;
export type PendingField = { value: unknown; seq: number };
export type Overlay = { confirmed: Ticket | null; pending: Partial<Record<keyof Ticket, PendingField>> };

export const emptyOverlay: Overlay = { confirmed: null, pending: {} };

/** The parts of a server-confirmed ticket that the screen adopts. */
const CONFIRMED_FIELDS = ['isTest', 'subject', 'status', 'priority', 'department', 'requesterMemberId', 'requesterName', 'requesterEmail', 'customerCompanyId', 'assignee', 'assigneeMemberId', 'version', 'updatedAt', 'dueAt', 'slaStartedAt', 'slaPolicySnapshot'] as const;

export function confirmedView(base: Ticket, confirmed: Ticket): Ticket {
  const next: Record<string, unknown> = { ...base };
  for (const key of CONFIRMED_FIELDS) if (key in confirmed) next[key] = confirmed[key];
  return next as unknown as Ticket;
}

/** What to draw: the loaded ticket, then the newest confirmed answer, then changes still in flight. */
export function applyOverlay(base: Ticket, overlay: Overlay | undefined): Ticket {
  if (!overlay) return base;
  let ticket = base;
  if (overlay.confirmed && overlay.confirmed.id === base.id && overlay.confirmed.version > base.version) ticket = confirmedView(base, overlay.confirmed);
  const entries = Object.entries(overlay.pending) as [keyof Ticket, PendingField][];
  if (entries.length === 0) return ticket;
  const next: Record<string, unknown> = { ...ticket };
  for (const [key, field] of entries) next[key] = field.value;
  return next as unknown as Ticket;
}

export function beginChange(overlay: Overlay | undefined, patch: TicketPatch, seq: number): Overlay {
  const current = overlay ?? emptyOverlay;
  const pending = { ...current.pending };
  for (const [key, value] of Object.entries(patch)) pending[key as keyof Ticket] = { value, seq };
  return { ...current, pending };
}

/** Success (with the ticket the server returned) or failure (without): the change stops being pending. */
export function settleChange(overlay: Overlay | undefined, keys: string[], seq: number, confirmed?: Ticket): Overlay {
  const current = overlay ?? emptyOverlay;
  const pending = { ...current.pending };
  for (const key of keys) if (pending[key as keyof Ticket]?.seq === seq) delete pending[key as keyof Ticket];
  const newest = confirmed && (!current.confirmed || confirmed.version > current.confirmed.version) ? confirmed : current.confirmed;
  return { confirmed: newest, pending };
}

/** Adopts a ticket the server returned for another kind of change (assignment) without touching pending fields. */
export function adoptConfirmed(overlay: Overlay | undefined, confirmed: Ticket): Overlay {
  return settleChange(overlay, [], 0, confirmed);
}

export function isSaving(overlay: Overlay | undefined, key: keyof Ticket): boolean {
  return Boolean(overlay?.pending[key]);
}

/** The values a change replaced, so the same change can be offered back as "Deshacer". */
export function previousValues(ticket: Ticket, patch: TicketPatch): TicketPatch {
  const previous: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) previous[key] = ticket[key as keyof Ticket];
  return previous as TicketPatch;
}

/**
 * Undo is offered for everything except resolving or reopening a resolved ticket: resolving creates a
 * satisfaction request that cannot be recalled, and putting it back would repeat that.
 */
export function canUndo(patch: TicketPatch, previous: TicketPatch): boolean {
  return patch.status !== 'resolved' && previous.status !== 'resolved';
}

const FIELD_MESSAGES: Record<string, string> = { status: 'Estado actualizado', priority: 'Prioridad actualizada', department: 'Departamento actualizado', requesterMemberId: 'Cuenta del cliente actualizada' };
export function changeMessage(patch: TicketPatch): string {
  if (patch.status === 'resolved') return 'Ticket resuelto';
  const keys = Object.keys(patch);
  return keys.length === 1 ? FIELD_MESSAGES[keys[0]] ?? 'Ticket actualizado' : 'Ticket actualizado';
}
