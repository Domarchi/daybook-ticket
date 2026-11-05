import { currentWorkspaceId,workspaceStorageKey } from './workspace-client';
export type DraftKind = 'reply' | 'note';
export type DraftScope = { memberId: string; role: string; ticketId: number };
export type TicketDraft = { kind: DraftKind; reply: string; note: string; recoveredLegacy: boolean };
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function ticketDraftKey(scope: DraftScope) {
  return workspaceStorageKey(`daybook.ticket.draft.v2.${encodeURIComponent(scope.memberId)}.${encodeURIComponent(scope.role)}.${scope.ticketId}`);
}

function emptyDraft(): TicketDraft {
  return { kind: 'reply', reply: '', note: '', recoveredLegacy: false };
}

function parseDraft(raw: string | null, client: boolean): TicketDraft | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('reply' in value) || typeof value.reply !== 'string' || !('note' in value) || typeof value.note !== 'string') return null;
    return {
      kind: !client && 'kind' in value && value.kind === 'note' ? 'note' : 'reply',
      reply: value.reply,
      note: client ? '' : value.note,
      recoveredLegacy: !client && 'recoveredLegacy' in value && value.recoveredLegacy === true,
    };
  } catch { return null; }
}

/** Keeps a session fallback when browser storage is unavailable. Scope always includes the role. */
export class TicketDraftStore {
  private readonly memory = new Map<string, TicketDraft>();
  private readonly legacyKeys = new Map<string, string>();
  persistent: boolean;

  constructor(private readonly storage: DraftStorage | null) {
    this.persistent = storage !== null;
  }

  read(scope: DraftScope, legacyEmail?: string): TicketDraft {
    const key = ticketDraftKey(scope);
    const cached = this.memory.get(key);
    if (cached) return { ...cached };
    let draft = emptyDraft();
    try {
      const saved = parseDraft(this.storage?.getItem(key) ?? null, scope.role === 'client');
      if (saved) draft = saved;
      else if (legacyEmail && scope.role !== 'client' && currentWorkspaceId()==='daybook') {
        const legacyKey = `vexor.draft.v1.${legacyEmail}.${scope.ticketId}`;
        const legacy = this.storage?.getItem(legacyKey);
        if (legacy) {
          // Old drafts have no audience. Never assume their contents are public.
          draft = { ...emptyDraft(), kind: 'note', note: legacy, recoveredLegacy: true };
          this.legacyKeys.set(key, legacyKey);
        }
      }
    } catch { this.persistent = false; }
    this.memory.set(key, draft);
    if (draft.recoveredLegacy) this.write(scope, draft);
    return { ...draft };
  }

  write(scope: DraftScope, draft: TicketDraft): TicketDraft {
    const key = ticketDraftKey(scope);
    const next = scope.role === 'client' ? { ...draft, kind: 'reply' as const, note: '', recoveredLegacy: false } : { ...draft };
    this.memory.set(key, next);
    try {
      if (this.storage) {
        this.storage.setItem(key, JSON.stringify(next));
        this.persistent = true;
        const legacyKey = this.legacyKeys.get(key);
        if (legacyKey) { this.storage.removeItem(legacyKey); this.legacyKeys.delete(key); }
      }
    } catch { this.persistent = false; }
    return { ...next };
  }

  selectKind(scope: DraftScope, kind: DraftKind): TicketDraft {
    return this.write(scope, { ...this.read(scope), kind });
  }

  edit(scope: DraftScope, body: string): TicketDraft {
    const current = this.read(scope);
    return this.write(scope, { ...current, [current.kind]: body });
  }

  complete(scope: DraftScope, sent: { kind: DraftKind; body: string }): TicketDraft {
    const current = this.read(scope);
    // Do not erase a newer edit or the other audience's draft after a slow save.
    if (current[sent.kind] !== sent.body) return current;
    return this.write(scope, { ...current, [sent.kind]: '', recoveredLegacy: sent.kind === 'note' ? false : current.recoveredLegacy });
  }
}

export function draftMessage(draft: TicketDraft): { kind: DraftKind; body: string } {
  return { kind: draft.kind, body: draft[draft.kind] };
}
