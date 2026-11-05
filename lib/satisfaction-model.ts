export interface TicketSatisfaction {
  id: string; ticketId: number; resolvedAt: string; score: number | null;
  comment: string | null; submittedAt: string | null; available: boolean;
}
/** An explicit false pauses future invitations/submissions while preserving history. */
export function satisfactionIsEnabled(value?: string): boolean { return value?.trim().toLowerCase() !== 'false'; }
export interface SatisfactionAggregate {
  id: string | null; name: string; invitations: number; responses: number;
  averageScore: number | null; positivePercent: number | null;
}
export interface SatisfactionReport {
  period: { from: string; to: string; companyId: string | null };
  totals: { invitations: number; responses: number; averageScore: number | null; positivePercent: number | null };
  agents: SatisfactionAggregate[]; companies: SatisfactionAggregate[];
  recent: { id: string; ticketId: number; score: number; comment: string | null; submittedAt: string; agent: string; company: string }[];
}
export function canSubmitSatisfaction(input: { viewerRole: string; viewerMemberId: string; requesterMemberId: string | null; invitationRequesterId: string; status: string; latestResolutionKey: string | null; resolutionKey: string; submittedAt: string | null }): boolean {
  return input.viewerRole === 'client' && input.viewerMemberId === input.requesterMemberId
    && input.viewerMemberId === input.invitationRequesterId && input.status === 'resolved'
    && input.latestResolutionKey === input.resolutionKey && input.submittedAt === null;
}
export function satisfactionScoreLabel(score: number): string {
  return ['', 'Muy insatisfecho', 'Insatisfecho', 'Regular', 'Satisfecho', 'Muy satisfecho'][score] || 'Sin calificación';
}
export interface SatisfactionDraft { surveyId: string; score: number; comment: string }
/** A ticket version may change for a private note; only the actual survey cycle owns the draft. */
export function satisfactionDraftFor(draft: SatisfactionDraft | null, surveyId: string): SatisfactionDraft {
  return draft?.surveyId === surveyId ? draft : { surveyId, score: 0, comment: '' };
}
