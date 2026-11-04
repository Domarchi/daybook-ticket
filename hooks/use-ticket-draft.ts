'use client';

import { useState } from 'react';
import { draftMessage, TicketDraftStore, type DraftKind, type DraftScope } from '@/lib/ticket-drafts';

let browserStore: TicketDraftStore | undefined;
function getStore() {
  if (typeof window === 'undefined') return new TicketDraftStore(null);
  if (!browserStore) {
    let storage: Storage | null = null;
    try { storage = window.sessionStorage; } catch { /* Keep drafts in memory for this page. */ }
    browserStore = new TicketDraftStore(storage);
  }
  return browserStore;
}

/** Mount the editor with ticketDraftKey(scope) so account/ticket changes reset its state. */
export function useTicketDraft(scope: DraftScope, legacyEmail?: string) {
  const [store] = useState(getStore);
  const [draft, setDraft] = useState(() => store.read(scope, legacyEmail));
  return {
    draft,
    message: draftMessage(draft),
    persistent: store.persistent,
    selectKind: (kind: DraftKind) => setDraft(store.selectKind(scope, kind)),
    edit: (body: string) => setDraft(store.edit(scope, body)),
    complete: (sent: ReturnType<typeof draftMessage>) => setDraft(store.complete(scope, sent)),
  };
}
