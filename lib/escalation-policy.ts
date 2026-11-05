export type EscalationReason = 'unanswered' | 'overdue';
export interface EscalationPolicy {
  enabled: boolean;
  unansweredMinutes: number;
  overdueMinutes: number;
  recipientMemberIds: string[];
  activatedAt: string | null;
  version: number;
}
export const DEFAULT_ESCALATION_POLICY: EscalationPolicy = {
  enabled: false, unansweredMinutes: 240, overdueMinutes: 60,
  recipientMemberIds: [], activatedAt: null, version: 0,
};
export interface EscalationClock {
  status: string; dueAt: string;
  unansweredSince: string | null; unansweredMessageId: number | null;
}
export function activeEscalationReasons(ticket: EscalationClock, policy: EscalationPolicy, now: Date): EscalationReason[] {
  if (!policy.enabled || !policy.activatedAt || !['open', 'pending'].includes(ticket.status)) return [];
  const reasons: EscalationReason[] = [];
  const unanswered = Date.parse(ticket.unansweredSince || '');
  const due = Date.parse(ticket.dueAt);
  if (ticket.unansweredMessageId && Number.isFinite(unanswered)
    && now.getTime() >= unanswered + policy.unansweredMinutes * 60_000) reasons.push('unanswered');
  if (Number.isFinite(due) && now.getTime() >= due + policy.overdueMinutes * 60_000) reasons.push('overdue');
  return reasons;
}
export function escalationRecipients(staff: { id: string; role: string; status: string; userId?: string | null }[], assignedId: string | null, configuredIds: string[]): string[] {
  const configured = new Set(configuredIds);
  return staff.filter(member => member.id !== assignedId && configured.has(member.id) && member.status === 'active'
    && Boolean(member.userId) && ['owner', 'admin', 'agent'].includes(member.role)).map(member => member.id);
}
export function escalationStageKey(input: { activationAt: string; cycleMessageId: number; reason: EscalationReason; unansweredMessageId: number | null; recipientMemberId: string }): string {
  return [input.activationAt, input.cycleMessageId, input.reason, input.reason === 'unanswered' ? input.unansweredMessageId : '', input.recipientMemberId].join(':');
}
export const ESCALATION_LABELS: Record<EscalationReason, string> = {
  unanswered: 'El cliente sigue esperando una respuesta y necesita apoyo de otro encargado',
  overdue: 'El ticket superó el plazo de resolución y necesita apoyo de otro encargado',
};
