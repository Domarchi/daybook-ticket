import { workspaceStorageKey } from './workspace-client';
import { getDraftOperations } from './draft-operations';
const memory = new Map<string, Record<string, string>>();
const fields = ['subject', 'body', 'department', 'priority', 'requesterName', 'requesterEmail', 'requesterMemberId', 'assigneeMemberId'] as const;
export function readNewTicketDraft(scope: string): Record<string, string> {
  const cached = memory.get(workspaceStorageKey(scope));
  if (cached) return { ...cached };
  let value: unknown;
  try { value = JSON.parse(sessionStorage.getItem(workspaceStorageKey(`daybook.ticket.new-draft.v1.${scope}`)) || 'null'); } catch { /* Try the last submission if storage is unavailable or missing. */ }
  value ||= getDraftOperations().previous(scope)?.payload;
  if (!value || typeof value !== 'object') return {};
  const record: Record<string, string> = {};
  for (const key of fields) if (key in value && typeof (value as Record<string, unknown>)[key] === 'string') record[key] = (value as Record<string, string>)[key];
  memory.set(workspaceStorageKey(scope), record);
  return { ...record };
}
export function writeNewTicketDraft(scope: string, draft: Record<string, string>) {
  memory.set(workspaceStorageKey(scope), { ...draft });
  try { sessionStorage.setItem(workspaceStorageKey(`daybook.ticket.new-draft.v1.${scope}`), JSON.stringify(draft)); } catch { /* Preserve navigation drafts in this page. */ }
}
export function clearNewTicketDraft(scope: string) {
  memory.delete(workspaceStorageKey(scope));
  try { sessionStorage.removeItem(workspaceStorageKey(`daybook.ticket.new-draft.v1.${scope}`)); } catch { /* The successful submission is also cleared separately. */ }
}
