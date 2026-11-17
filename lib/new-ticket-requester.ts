/**
 * What choosing another client does to the company fields of a new ticket (the request type and its values,
 * which belong to the client's company). They stay while the company stays the same; with another company they
 * are cleared, and when something was already filled in the form says so instead of clearing it in silence.
 */
export function companyFieldsAfterRequesterChange(
  previousCompanyId: string | null | undefined,
  nextCompanyId: string | null | undefined,
  value: { requestTypeId?: string | null; fieldValues?: Record<string, unknown> },
): { clear: boolean; announce: boolean } {
  if ((previousCompanyId || '') === (nextCompanyId || '')) return { clear: false, announce: false };
  const filled = Boolean(value.requestTypeId || Object.keys(value.fieldValues || {}).length);
  return { clear: true, announce: filled };
}
