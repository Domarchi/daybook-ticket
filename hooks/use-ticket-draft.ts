'use client';

import { useCallback, useState } from 'react';
import {
  draftMessage,
  TicketDraftStore,
  type DraftKind,
  type DraftScope,
  type DraftReferences,
} from '@/lib/ticket-drafts';

import { getDraftOperations } from '@/lib/draft-operations';

let browserStore: TicketDraftStore | undefined;
function getStore() {
  if (typeof window === 'undefined') return new TicketDraftStore(null);
  if (!browserStore) {
    let storage: Storage | null = null;
    try {
      storage = window.sessionStorage;
    } catch {
      /* Keep drafts in memory for this page. */
    }
    browserStore = new TicketDraftStore(storage, getDraftOperations());
  }
  return browserStore;
}

/** Mount the editor with ticketDraftKey(scope) so account/ticket changes reset its state. */
export function useTicketDraft(scope: DraftScope, legacyEmail?: string) {
  const [store] = useState(getStore);
  const [draft, setDraft] = useState(() => store.read(scope, legacyEmail));
  const { memberId, role, ticketId } = scope;
  const setReferences = useCallback(
    (kind: DraftKind, value: DraftReferences) =>
      setDraft(store.setReferences({ memberId, role, ticketId }, kind, value)),
    [store, memberId, role, ticketId],
  );
  return {
    draft,
    setReferences,
    message: draftMessage(draft),
    persistent: store.persistent,
    selectKind: (kind: DraftKind) => setDraft(store.selectKind(scope, kind)),
    edit: (body: string) => setDraft(store.edit(scope, body)),
    complete: (sent: ReturnType<typeof draftMessage>) => setDraft(store.complete(scope, sent)),
  };
}
