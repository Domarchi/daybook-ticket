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
