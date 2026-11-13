import { classifyTicketText, type ClassificationInput } from './ticket-classifier';

/**
 * The stored form of the classifier's suggestion, in the column order of CATEGORY_INSERT_COLUMNS.
 * Computed on the server inside the creation transaction; the request payload (and its idempotency) is unchanged.
 */
export const CATEGORY_INSERT_COLUMNS =
  '"faultGroup","faultElement","requirement","categorySource","categoryConfidence"';
export function suggestedCategoryValues(
  input: ClassificationInput,
): [string | null, string | null, string | null, 'bot', string] {
  const result = classifyTicketText(input);
  return [result.fault?.group ?? null, result.fault?.element ?? null, result.requirement, 'bot', result.confidence];
}
/**
 * When the person says what they are asking for (a requirement from the portal, F6-B3), that choice is the
 * classification: chosen by a person, so the classifier never overwrites it.
 */
export function requestedCategoryValues(requirement: string): [null, null, string, 'manual', null] {
  return [null, null, requirement, 'manual', null];
}
