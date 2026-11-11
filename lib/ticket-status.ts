/**
 * Ticket states. Four are shown to people, but only three are stored:
 *
 *   Sin asignar  = open, nobody responsible          (derived)
 *   En proceso   = open, someone responsible         (derived)
 *   Solucionado  = resolved                          (stored)
 *   Cerrado      = closed, set by a person           (stored, final until someone reopens it)
 *
 * "pending" ("En espera") is retired. It is never written any more, but old rows, backups and exports can still
 * carry it, so it is accepted when reading and treated as open work.
 */
export type TicketStatus = 'open' | 'pending' | 'resolved' | 'closed';
export type WritableTicketStatus = Exclude<TicketStatus, 'pending'>;
export const WRITABLE_TICKET_STATUSES = ['open', 'resolved', 'closed'] as const;

export type StatusView = 'unassigned' | 'in_progress' | 'resolved' | 'closed';
export const STATUS_VIEW_LABELS: Record<StatusView, string> = {
  unassigned: 'Sin asignar',
  in_progress: 'En proceso',
  resolved: 'Solucionado',
  closed: 'Cerrado',
};
/** The visible state of a ticket, from the two facts that decide it. */
export function statusView(ticket: { status: string; assigneeMemberId?: string | null }): StatusView {
  if (ticket.status === 'closed') return 'closed';
  if (ticket.status === 'resolved') return 'resolved';
  return ticket.assigneeMemberId ? 'in_progress' : 'unassigned';
}
export function statusLabel(ticket: { status: string; assigneeMemberId?: string | null }): string {
  return STATUS_VIEW_LABELS[statusView(ticket)];
}
/** For lists that know the status but not who is responsible: open work is just "Abierto". */
export function statusLabelCoarse(status: string): string {
  return status === 'closed'
    ? STATUS_VIEW_LABELS.closed
    : status === 'resolved'
      ? STATUS_VIEW_LABELS.resolved
      : 'Abierto';
}
/** Existing colours are reused: amber for waiting for someone, blue for work under way, green, and a new neutral grey. */
export const STATUS_VIEW_CLASS: Record<StatusView, string> = {
  unassigned: 'pending',
  in_progress: 'open',
  resolved: 'resolved',
  closed: 'closed',
};

/** Work is finished (the SLA clock stops, no reminders, not in the active queues). */
export function isFinished(status: string): boolean {
  return status === 'resolved' || status === 'closed';
}
export function isActive(status: string): boolean {
  return !isFinished(status);
}
/** SQL fragments. `${alias}.status` must be a column of tickets. */
export const FINISHED_SQL = `('resolved','closed')`;
export function activeSql(column = 'status'): string {
  return `${column} NOT IN ${FINISHED_SQL}`;
}

/**
 * What a status change may do. Closing is a deliberate step after solving; a closed ticket only goes back to open.
 * Returns the message to show when the change is not allowed.
 */
export function statusChangeProblem(from: string, to: string): string | null {
  if (from === to) return null;
  if (to === 'closed' && from !== 'resolved') return 'Marca primero el ticket como solucionado para poder cerrarlo.';
  if (from === 'closed' && to !== 'open') return 'Un ticket cerrado solo puede reabrirse.';
  return null;
}

/** The options of a status control: the first one keeps the stored value "open" but is named from the responsible. */
export function statusOptions(ticket: {
  status: string;
  assigneeMemberId?: string | null;
}): { value: WritableTicketStatus; label: string }[] {
  const open = ticket.assigneeMemberId ? STATUS_VIEW_LABELS.in_progress : STATUS_VIEW_LABELS.unassigned;
  const all: { value: WritableTicketStatus; label: string }[] = [
    { value: 'open', label: open },
    { value: 'resolved', label: STATUS_VIEW_LABELS.resolved },
    { value: 'closed', label: STATUS_VIEW_LABELS.closed },
  ];
  return all.filter(option => !statusChangeProblem(ticket.status, option.value) || option.value === 'open');
}

/** Queues of the inbox. The old "open" and "pending" are still understood (saved filters) and mean active work. */
export const TICKET_QUEUES = [
  'all',
  'open',
  'pending',
  'unassigned',
  'inprogress',
  'resolved',
  'closed',
  'mine',
  'overdue',
] as const;
export type TicketQueue = (typeof TICKET_QUEUES)[number];
export function isTicketQueue(value: unknown): value is TicketQueue {
  return typeof value === 'string' && (TICKET_QUEUES as readonly string[]).includes(value);
}
