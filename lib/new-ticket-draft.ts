import { workspaceStorageKey } from './workspace-client';
import { getDraftOperations } from './draft-operations';
const memory = new Map<string, Record<string, string>>();
const fields = [
  'subject',
  'body',
  'department',
  'priority',
  'requesterName',
  'requesterEmail',
  'requesterMemberId',
  'assigneeMemberId',
  'requirement',
] as const;
export function readNewTicketDraft(scope: string): Record<string, string> {
  const cached = memory.get(workspaceStorageKey(scope));
  if (cached) return { ...cached };
  let value: unknown;
  try {
    value = JSON.parse(sessionStorage.getItem(workspaceStorageKey(`daybook.ticket.new-draft.v1.${scope}`)) || 'null');
  } catch {
    /* Try the last submission if storage is unavailable or missing. */
  }
  value ||= getDraftOperations().previous(scope)?.payload;
  if (!value || typeof value !== 'object') return {};
  const record: Record<string, string> = {};
  for (const key of fields)
    if (key in value && typeof (value as Record<string, unknown>)[key] === 'string')
      record[key] = (value as Record<string, string>)[key];
  memory.set(workspaceStorageKey(scope), record);
  return { ...record };
}
export function writeNewTicketDraft(scope: string, draft: Record<string, string>) {
  memory.set(workspaceStorageKey(scope), { ...draft });
  try {
    sessionStorage.setItem(workspaceStorageKey(`daybook.ticket.new-draft.v1.${scope}`), JSON.stringify(draft));
  } catch {
    /* Preserve navigation drafts in this page. */
  }
}
export function clearNewTicketDraft(scope: string) {
  memory.delete(workspaceStorageKey(scope));
  organizationMemory.delete(workspaceStorageKey(scope));
  getDraftOperations().clear(scope);
  try {
    sessionStorage.removeItem(workspaceStorageKey(`daybook.ticket.new-organization.v1.${scope}`));
  } catch {
    /* Optional storage. */
  }
  try {
    sessionStorage.removeItem(workspaceStorageKey(`daybook.ticket.new-draft.v1.${scope}`));
  } catch {
    /* The successful submission is also cleared separately. */
  }
}

export type NewTicketOrganizationDraft = {
  requestTypeId?: string | null;
  fieldValues?: Record<string, string | boolean | null>;
};
const organizationMemory = new Map<string, NewTicketOrganizationDraft>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Versioned server definitions are deliberately absent: only bounded submitted
 * identifiers and scalar values may live in a browser draft. */
export function parseNewTicketOrganization(value: unknown): NewTicketOrganizationDraft | null {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return null;
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some(key => !['requestTypeId', 'fieldValues'].includes(key))) return null;
  const result: NewTicketOrganizationDraft = {};
  if (Object.hasOwn(source, 'requestTypeId')) {
    if (source.requestTypeId !== null && (typeof source.requestTypeId !== 'string' || !uuid.test(source.requestTypeId)))
      return null;
    result.requestTypeId = source.requestTypeId as string | null;
  }
  if (Object.hasOwn(source, 'fieldValues')) {
    const raw = source.fieldValues;
    if (
      !raw ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) ||
      Object.keys(raw).length > 20
    )
      return null;
    const entries = Object.entries(raw);
    if (
      entries.some(
        ([key, item]) =>
          !uuid.test(key) ||
          (typeof item !== 'string' && typeof item !== 'boolean' && item !== null) ||
          (typeof item === 'string' && item.length > 4000),
      )
    )
      return null;
    result.fieldValues = Object.fromEntries(entries) as Record<string, string | boolean | null>;
  }
  return result;
}
export function readNewTicketOrganization(scope: string): NewTicketOrganizationDraft {
  const cached = organizationMemory.get(workspaceStorageKey(scope));
  if (cached) return structuredClone(cached);
  let value: NewTicketOrganizationDraft | null = null;
  try {
    const stored = sessionStorage.getItem(workspaceStorageKey(`daybook.ticket.new-organization.v1.${scope}`));
    if (stored !== null) {
      value = stored.length <= 100000 ? parseNewTicketOrganization(JSON.parse(stored)) : null;
      if (value) {
        organizationMemory.set(workspaceStorageKey(scope), value);
        return structuredClone(value);
      }
    }
  } catch {
    /* Try the uncertain receipt if the explicit draft is unavailable. */
  }
  const attempt = getDraftOperations().previous(scope)?.payload,
    base = readNewTicketDraft(scope);
  if (attempt && typeof attempt === 'object' && !Array.isArray(attempt)) {
    const source = attempt as Record<string, unknown>;
    const normalized = (record: Record<string, unknown>) =>
      Object.fromEntries(
        fields
          .filter(key => typeof record[key] === 'string' && record[key] !== '' && record[key] !== '__auto__')
          .map(key => [key, record[key]]),
      );
    if (
      typeof source.body === 'string' &&
      source.body === base.body &&
      JSON.stringify(normalized(source)) === JSON.stringify(normalized(base))
    )
      value = parseNewTicketOrganization({
        ...('requestTypeId' in source ? { requestTypeId: source.requestTypeId } : {}),
        ...('fieldValues' in source ? { fieldValues: source.fieldValues } : {}),
      });
  }
  const result = value ?? {};
  organizationMemory.set(workspaceStorageKey(scope), result);
  if (value)
    try {
      sessionStorage.setItem(
        workspaceStorageKey(`daybook.ticket.new-organization.v1.${scope}`),
        JSON.stringify(result),
      );
    } catch {
      /* Retain the recovered metadata in this page. */
    }
  return structuredClone(result);
}
export function writeNewTicketOrganization(scope: string, value: NewTicketOrganizationDraft) {
  const parsed = parseNewTicketOrganization(value);
  if (!parsed) throw new Error('Los campos del borrador no son válidos.');
  organizationMemory.set(workspaceStorageKey(scope), parsed);
  try {
    sessionStorage.setItem(workspaceStorageKey(`daybook.ticket.new-organization.v1.${scope}`), JSON.stringify(parsed));
  } catch {
    /* Keep the scoped current-page draft. */
  }
}
