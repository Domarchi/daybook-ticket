/**
 * Classifying tickets created before the classifier existed (they show «Sin clasificar»). Pure: the suggestion and
 * the words for it. lib/ticket-backfill.ts reads and writes. A person reviews the list first and applies only what
 * they tick; a ticket somebody classified in the meantime is never touched.
 */
import { classifyTicketText } from './ticket-classifier';
import { faultLabel, requirementLabel, type FaultCategory, type RequirementId } from './ticket-category-model';

/** One review screen; more than this is done in rounds. */
export const BACKFILL_LIMIT = 200;

export type BackfillSource = { id: number; subject: string; body: string | null };
export type BackfillSuggestion = {
  ticketId: number;
  fault: FaultCategory | null;
  requirement: RequirementId | null;
  confidence: 'high' | 'low';
  matched: string[];
};

/** The same suggestion a new ticket gets: subject plus the first request message. */
export function backfillSuggestion(source: BackfillSource): BackfillSuggestion {
  const result = classifyTicketText({ subject: source.subject, body: source.body });
  return {
    ticketId: source.id,
    fault: result.fault,
    requirement: result.requirement,
    confidence: result.confidence,
    matched: result.matched,
  };
}

/** The stored columns, in the order faultGroup, faultElement, requirement, categoryConfidence. */
export function backfillColumns(suggestion: BackfillSuggestion): [string | null, string | null, string | null, string] {
  return [
    suggestion.fault?.group ?? null,
    suggestion.fault?.element ?? null,
    suggestion.requirement,
    suggestion.confidence,
  ];
}

/** "Equipos y periféricos · Impresora / Sin requerimiento", as the ticket history writes a category. */
export function describeSuggestion(suggestion: Pick<BackfillSuggestion, 'fault' | 'requirement'>): string {
  return `${faultLabel(suggestion.fault)} / ${requirementLabel(suggestion.requirement)}`;
}

/** Distinct positive ids, at most one screen. `null` when the list is not usable. */
export function backfillIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  if (!value.every(id => Number.isSafeInteger(id) && id > 0)) return null;
  const ids = [...new Set(value as number[])];
  return ids.length <= BACKFILL_LIMIT ? ids : null;
}
