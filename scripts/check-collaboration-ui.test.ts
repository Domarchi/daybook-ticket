import assert from 'node:assert/strict';
import test from 'node:test';
import { DraftOperations } from '../lib/draft-operations';
import { attachmentValidation, restorePendingAttachmentIds, ATTACHMENT_MAX_BYTES } from '../lib/attachment-drafts';
import { normalizeTeamFilters } from '../hooks/use-team-filters';
function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
test('existing company/agent preferences survive adding persisted inbox, priority and department filters', () => {
  assert.deepEqual(normalizeTeamFilters({ company: 'company-a', agent: 'agent-b' }), {
    company: 'company-a',
    agent: 'agent-b',
    queue: 'all',
    priority: 'all',
    department: 'all',
    category: 'all',
  });
  const chosen = {
    company: 'none',
    agent: 'agent-b',
    queue: 'overdue',
    priority: 'urgent',
    department: 'Soporte técnico',
    category: 'access',
  };
  assert.deepEqual(normalizeTeamFilters(JSON.parse(JSON.stringify(chosen))), chosen);
  assert.deepEqual(normalizeTeamFilters({ ...chosen, queue: 'invalid-view', priority: false }), {
    ...chosen,
    queue: 'all',
    priority: 'all',
  });
  assert.deepEqual(normalizeTeamFilters(null), {
    company: 'all',
    agent: 'all',
    queue: 'all',
    priority: 'all',
    department: 'all',
    category: 'all',
  });
});
test('a lost response and page reload retry the original operation and payload, including consumed attachment IDs', () => {
  const session = storage();
  const payload = { body: 'Public update', kind: 'reply', draftId: 'public-draft', attachmentIds: ['file-1'] };
  const beforeReload = new DraftOperations(session, () => 'first-operation');
  const id = beforeReload.forPayload('member-1:ticket-2:reply', payload);
  const afterReload = new DraftOperations(session, () => 'must-not-generate-a-new-operation');
  const pending = afterReload.previous('member-1:ticket-2:reply');
  assert.deepEqual(pending, { id, payload });
  const restoredFiles = restorePendingAttachmentIds(
    'public-draft',
    [],
    [{ id: 'file-1', status: 'ready', name: 'example.pdf' }],
    pending?.payload,
  );
  assert.equal(restoredFiles[0].confirmationPending, true);
  const retry = { ...payload, attachmentIds: restoredFiles.map(file => file.id).sort() };
  assert.equal(
    afterReload.forPayload('member-1:ticket-2:reply', retry),
    id,
    'A successful server mutation with a lost response must not be duplicated.',
  );
  assert.deepEqual(retry, payload);
});
test('different bodies, recipients/scopes or attached files receive new operation IDs', () => {
  let counter = 0;
  const store = new DraftOperations(storage(), () => `operation-${++counter}`);
  const payload = { body: 'Hello', attachmentIds: [] as string[] };
  assert.equal(store.forPayload('member-1:ticket-1:reply', payload), 'operation-1');
  assert.equal(store.forPayload('member-1:ticket-1:reply', payload), 'operation-1');
  assert.equal(store.forPayload('member-1:ticket-1:reply', { ...payload, body: 'Updated' }), 'operation-2');
  assert.equal(store.forPayload('member-2:ticket-1:reply', payload), 'operation-3');
  assert.equal(store.forPayload('member-1:ticket-2:reply', payload), 'operation-4');
  assert.equal(store.forPayload('member-1:ticket-1:note', payload), 'operation-5');
  assert.equal(store.forPayload('member-1:ticket-1:reply', { ...payload, attachmentIds: ['new'] }), 'operation-6');
});
test('completion clears the operation, while transient storage errors still keep an in-page retry stable', () => {
  const session = storage();
  let counter = 0;
  const operations = new DraftOperations(session, () => String(++counter));
  operations.forPayload('scope', { body: 'Original' });
  operations.clear('scope');
  assert.equal(new DraftOperations(session).previous('scope'), null);
  const unavailable = new DraftOperations(
    {
      getItem: () => {
        throw Error('Unavailable');
      },
      setItem: () => {
        throw Error('Unavailable');
      },
      removeItem: () => {},
    },
    () => String(++counter),
  );
  const first = unavailable.forPayload('scope', { body: 'Retry' });
  assert.equal(unavailable.forPayload('scope', { body: 'Retry' }), first);
});
test('private attachment drafts cannot be recovered into a public reply draft or another operation', () => {
  const noteFiles = [{ id: 'private-file', status: 'ready' }];
  const noteAttempt = { draftId: 'note-draft', attachmentIds: ['private-file'] };
  assert.deepEqual(restorePendingAttachmentIds('reply-draft', [], noteFiles, noteAttempt), []);
  assert.deepEqual(
    restorePendingAttachmentIds('note-draft', [], noteFiles, { draftId: 'note-draft', attachmentIds: [] }),
    [],
  );
  assert.deepEqual(restorePendingAttachmentIds('note-draft', [], noteFiles, null), []);
  const present = restorePendingAttachmentIds('note-draft', noteFiles, noteFiles, noteAttempt);
  assert.equal(present.length, 1, 'Pending API results should not be duplicated by local retry recovery.');
});
test('attachment validation enforces five files, ten MiB, nonempty bodies and supported extensions', () => {
  assert.equal(attachmentValidation({ name: 'photo.PNG', size: ATTACHMENT_MAX_BYTES }, 4), null);
  assert.match(attachmentValidation({ name: 'photo.png', size: 1 }, 5) || '', /5 archivos/);
  assert.match(attachmentValidation({ name: 'report.pdf', size: ATTACHMENT_MAX_BYTES + 1 }, 0) || '', /10 MB/);
  assert.match(attachmentValidation({ name: 'report.pdf', size: 0 }, 0) || '', /vacío/);
  assert.match(attachmentValidation({ name: 'executable.exe', size: 1 }, 0) || '', /Usa archivos/);
  for (const name of ['photo.jpeg', 'photo.webp', 'notes.txt', 'report.csv', 'document.docx', 'sheet.xlsx'])
    assert.equal(attachmentValidation({ name, size: 1 }, 0), null);
});
