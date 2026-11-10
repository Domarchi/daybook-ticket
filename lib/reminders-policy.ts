export const REMINDER_GRACE_MS = 30 * 60_000;
export const REMINDER_DAILY_MS = 24 * 60 * 60_000;
export const REMINDER_REASONS = ['unanswered', 'due_soon', 'overdue'] as const;
export type ReminderReason = (typeof REMINDER_REASONS)[number];

export interface ReminderClock {
  status: string;
  dueAt: string;
  unansweredSince: string | null;
  unansweredMessageId: number | null;
}
export interface ReminderHistory {
  unansweredSent: boolean;
  dueSoonSent: boolean;
  overdueSent: boolean;
  lastEnqueuedAt: string | null;
}

/** Reasons describe current conditions, never the number of missed scheduler runs. */
export function activeReminderReasons(ticket: ReminderClock, now: Date): ReminderReason[] {
  if (ticket.status === 'resolved') return [];
  const at = now.getTime();
  const due = Date.parse(ticket.dueAt);
  const waiting = Date.parse(ticket.unansweredSince || '');
  const reasons: ReminderReason[] = [];
  if (ticket.unansweredMessageId && Number.isFinite(waiting) && at >= waiting + 2 * 60 * 60_000)
    reasons.push('unanswered');
  if (Number.isFinite(due) && at >= due - 60 * 60_000 && at < due) reasons.push('due_soon');
  if (Number.isFinite(due) && at >= due) reasons.push('overdue');
  return reasons;
}

export function nextReminderReasons(ticket: ReminderClock, history: ReminderHistory, now: Date): ReminderReason[] {
  const active = activeReminderReasons(ticket, now);
  const first = active.some(reason =>
    reason === 'unanswered'
      ? !history.unansweredSent
      : reason === 'due_soon'
        ? !history.dueSoonSent
        : !history.overdueSent,
  );
  const last = Date.parse(history.lastEnqueuedAt || '');
  const daily = Number.isFinite(last) && now.getTime() >= last + REMINDER_DAILY_MS;
  // A single grouped escalation or daily reminder, never one for each missed day.
  return first || daily ? active : [];
}

export interface ReminderStaff {
  id: string;
  role: string;
  status: string;
  userId?: string | null;
}
export function reminderRecipients(staff: ReminderStaff[], assigneeId: string | null, configured: string[]): string[] {
  const active = staff.filter(
    member => member.status === 'active' && Boolean(member.userId) && ['owner', 'admin', 'agent'].includes(member.role),
  );
  const assigned = active.find(member => member.id === assigneeId);
  if (assigned) return [assigned.id];
  const selected = new Set(configured);
  return active.filter(member => selected.has(member.id)).map(member => member.id);
}

export function parseReminderReasons(value: string): ReminderReason[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? REMINDER_REASONS.filter(reason => parsed.includes(reason)) : [];
  } catch {
    return [];
  }
}

export const REMINDER_REASON_LABELS: Record<ReminderReason, string> = {
  unanswered: 'El cliente espera una respuesta hace dos horas o más',
  due_soon: 'Queda una hora o menos para el vencimiento',
  overdue: 'El ticket está vencido',
};
