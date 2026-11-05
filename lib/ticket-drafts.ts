import { currentWorkspaceId,workspaceStorageKey } from './workspace-client';
import { canonicalDraftPayload, type DraftOperations } from './draft-operations';
export type DraftKind = 'reply' | 'note';
export type DraftScope = { memberId: string; role: string; ticketId: number };
export type DraftReferences = { replyToMessageId?: number|null; mentionMemberIds?: string[] };
export type DraftMessage = { kind: DraftKind; body: string } & DraftReferences;
export type TicketDraft = { kind: DraftKind; reply: string; note: string; recoveredLegacy: boolean; references?: Partial<Record<DraftKind,DraftReferences>> };
export function safeDraftReferences(value: unknown, kind: DraftKind, client: boolean): DraftReferences {
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  const raw=value as Record<string,unknown>,output:DraftReferences={};
  if(Object.hasOwn(raw,'replyToMessageId')&&raw.replyToMessageId===null)output.replyToMessageId=null;
  else if(Number.isSafeInteger(raw.replyToMessageId)&&Number(raw.replyToMessageId)>0)output.replyToMessageId=Number(raw.replyToMessageId);
  if(!client&&kind==='note'&&Array.isArray(raw.mentionMemberIds)&&raw.mentionMemberIds.length<=10&&raw.mentionMemberIds.every(id=>typeof id==='string'&&id.length>0&&id.length<=160)) output.mentionMemberIds=[...raw.mentionMemberIds] as string[];
  return output;
}
function copy(draft:TicketDraft):TicketDraft{return structuredClone(draft);}
function references(draft:TicketDraft,kind:DraftKind):DraftReferences{return draft.references?.[kind]??{};}
export function sameDraftMessage(draft:TicketDraft,sent:DraftMessage){return draft[sent.kind]===sent.body&&canonicalDraftPayload(references(draft,sent.kind))===canonicalDraftPayload(safeDraftReferences(sent,sent.kind,false));}
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
    const refs='references' in value&&value.references&&typeof value.references==='object'?value.references as Partial<Record<DraftKind,unknown>>:null;
    const recovered:Partial<Record<DraftKind,DraftReferences>>={};
    for(const kind of (client?['reply']:['reply','note']) as DraftKind[])if(refs&&Object.hasOwn(refs,kind))recovered[kind]=safeDraftReferences(refs[kind],kind,client);
    return {
      ...(Object.keys(recovered).length?{references:recovered}:{}),
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

  constructor(private readonly storage: DraftStorage | null, private readonly operations?: Pick<DraftOperations,'previous'>) {
    this.persistent = storage !== null;
  }

  read(scope: DraftScope, legacyEmail?: string): TicketDraft {
    const key = ticketDraftKey(scope);
    const cached = this.memory.get(key);
    if (cached) return copy(cached);
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
    // Old editors saved text and the submission receipt separately. Recover IDs
    // only if no explicit newer reference selection exists and the text matches.
    for(const kind of (scope.role==='client'?['reply']:['reply','note']) as DraftKind[]) {
      const previous=this.operations?.previous(`${key}.${kind}`)?.payload;
      if(!previous||typeof previous!=='object'||Array.isArray(previous)||draft.references?.[kind]!==undefined)continue;
      const attempt=previous as Record<string,unknown>;
      if(typeof attempt.body!=='string'||attempt.body.length>20000||(attempt.kind!==undefined&&attempt.kind!==kind))continue;
      if(draft[kind]!==attempt.body)continue;
      const refs=safeDraftReferences(attempt,kind,scope.role==='client');
      if(Object.keys(refs).length)draft={...draft,references:{...draft.references,[kind]:refs}};
    }
    this.memory.set(key, draft);
    if (draft.recoveredLegacy) this.write(scope, draft);
    return copy(draft);
  }

  write(scope: DraftScope, draft: TicketDraft): TicketDraft {
    const key = ticketDraftKey(scope);
    const next:TicketDraft = scope.role === 'client' ? { ...copy(draft), kind: 'reply', note: '', recoveredLegacy: false, ...(draft.references?{references:Object.hasOwn(draft.references,'reply')?{reply:safeDraftReferences(draft.references.reply,'reply',true)}:{}}:{}) } : copy(draft);
    this.memory.set(key, next);
    try {
      if (this.storage) {
        this.storage.setItem(key, JSON.stringify(next));
        this.persistent = true;
        const legacyKey = this.legacyKeys.get(key);
        if (legacyKey) { this.storage.removeItem(legacyKey); this.legacyKeys.delete(key); }
      }
    } catch { this.persistent = false; }
    return copy(next);
  }

  selectKind(scope: DraftScope, kind: DraftKind): TicketDraft {
    return this.write(scope, { ...this.read(scope), kind });
  }

  edit(scope: DraftScope, body: string): TicketDraft {
    const current = this.read(scope);
    return this.write(scope, { ...current, [current.kind]: body });
  }

  setReferences(scope:DraftScope,kind:DraftKind,value:DraftReferences):TicketDraft {const current=this.read(scope);if(scope.role==='client'&&kind!=='reply')return current;return this.write(scope,{...current,references:{...current.references,[kind]:safeDraftReferences(value,kind,scope.role==='client')}});}

  complete(scope: DraftScope, sent: DraftMessage): TicketDraft {
    const current = this.read(scope);
    // Do not erase a newer edit or the other audience's draft after a slow save.
    if (!sameDraftMessage(current,sent)) return current;
    return this.write(scope, { ...current, [sent.kind]: '', ...(current.references?{references:{...current.references,[sent.kind]:{}}}:{}), recoveredLegacy: sent.kind === 'note' ? false : current.recoveredLegacy });
  }
}

export function draftMessage(draft: TicketDraft): DraftMessage {
  return { kind: draft.kind, body: draft[draft.kind], ...structuredClone(references(draft,draft.kind)) };
}
