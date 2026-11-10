import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database } from '../db/database';
import type { AccessContext } from '../lib/access';
import { downloadAttachment, type AttachmentRow } from '../lib/attachments';
const at = '2026-11-05T18:00:00.000Z';
const access: AccessContext = {
  ownerId: 'owner',
  organizationId: 'daybook',
  userId: 'user',
  sessionId: 'session',
  role: 'agent',
  member: {
    id: 'member',
    name: 'Agente ficticio',
    email: 'agent@example.test',
    role: 'agent',
    status: 'active',
    hasAccount: true,
    customerCompanyId: null,
    companyAccess: 'own',
    createdAt: at,
    updatedAt: at,
  },
};
function fixture(kind: AttachmentRow['kind'] = 'contract') {
  const state = {
    revoked: false,
    role: 'agent',
    companyId: 'company-a',
    companyAccess: 'own',
    expired: false,
    challenge: false,
    feature: true,
    changed: false,
    checks: 0,
    cancelled: false,
  };
  const row: AttachmentRow = {
    id: 'file',
    ownerId: 'owner',
    memberId: 'author',
    draftId: 'draft',
    ticketId: kind === 'contract' ? null : 1,
    messageId: kind === 'contract' ? null : 1,
    contractId: kind === 'contract' ? 'contract' : null,
    kind,
    pathname: 'private/file',
    name: 'fictitious.txt',
    contentType: 'text/plain',
    size: 4,
    status: 'attached',
    expiresAt: at,
    uploadedAt: at,
    validatedAt: at,
    createdAt: at,
    updatedAt: at,
  };
  const tx = {
    async query(sql: string) {
      if (sql.includes('pg_advisory_xact_lock_shared')) return { rows: [] };
      if (sql.includes('SELECT * FROM members')) {
        state.checks++;
        return {
          rows: state.revoked
            ? []
            : [
                {
                  ...access.member,
                  ownerId: 'owner',
                  organizationId: 'daybook',
                  userId: 'user',
                  role: state.role,
                  customerCompanyId: state.companyId,
                  companyAccess: state.companyAccess,
                },
              ],
        };
      }
      if (sql.includes('FROM "authUser" u')) {
        assert.match(sql, /FROM "authSession" s/);
        return {
          rows: state.expired
            ? []
            : [{ twoFactorEnabled: false, requireStaffMfa: state.challenge, activatedAt: at, version: 1 }],
        };
      }
      if (sql.includes('SELECT a.* FROM attachments')) return { rows: [{ ...row, size: state.changed ? 5 : 4 }] };
      if (sql.includes('FROM "evolutionFeatures"'))
        return { rows: [{ featuresJson: JSON.stringify({ serviceContext: state.feature }) }] };
      if (sql.includes('FROM tickets'))
        return { rows: [{ ownerId: 'owner', requesterMemberId: 'another-client', customerCompanyId: 'company-a' }] };
      throw Error('Unexpected fixture query');
    },
  };
  const database = {
    transaction: async (work: (value: typeof tx) => Promise<unknown>) => work(tx),
  } as unknown as Database;
  const store = (afterRead: () => void) => ({
    remove: async () => {},
    read: async () => {
      afterRead();
      return {
        size: 4,
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Buffer.from('test'));
          },
          cancel() {
            state.cancelled = true;
          },
        }),
      };
    },
  });
  return { state, database, store };
}
test('private download rechecks current membership, role, MFA, session and service pause after storage and cancels denied streams', async () => {
  for (const change of ['revoked', 'demoted', 'expired', 'challenge', 'paused', 'changed'] as const) {
    const f = fixture();
    await assert.rejects(
      () =>
        downloadAttachment(
          access,
          'file',
          f.database,
          f.store(() => {
            if (change === 'revoked') f.state.revoked = true;
            else if (change === 'demoted') f.state.role = 'client';
            else if (change === 'expired') f.state.expired = true;
            else if (change === 'challenge') f.state.challenge = true;
            else if (change === 'paused') f.state.feature = false;
            else f.state.changed = true;
          }),
        ),
      error => error instanceof Error,
      change,
    );
    assert.equal(f.state.cancelled, true, change);
    assert.equal(f.state.checks, 2, change);
  }
});
test('public and internal files use current company and note permissions after storage', async () => {
  const own = {
    ...access,
    role: 'client' as const,
    member: {
      ...access.member,
      role: 'client' as const,
      customerCompanyId: 'company-a',
      companyAccess: 'manager' as const,
    },
  };
  const moved = fixture('reply');
  moved.state.role = 'client';
  moved.state.companyAccess = 'manager';
  await assert.rejects(
    () =>
      downloadAttachment(
        own,
        'file',
        moved.database,
        moved.store(() => {
          moved.state.companyId = 'company-b';
        }),
      ),
    /no tienes acceso/,
  );
  assert.equal(moved.state.cancelled, true);
  const note = fixture('note');
  await assert.rejects(
    () =>
      downloadAttachment(
        access,
        'file',
        note.database,
        note.store(() => {
          note.state.role = 'client';
        }),
      ),
    /no tienes acceso/,
  );
  assert.equal(note.state.cancelled, true);
});
test('authorized download preserves private headers, declared size and content', async () => {
  const f = fixture(),
    response = await downloadAttachment(
      access,
      'file',
      f.database,
      f.store(() => {}),
    );
  assert.equal(f.state.checks, 2);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Length'), '4');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  // Complete this fixture stream manually because its source stays open to observe cancellation.
  const reader = response.body!.getReader();
  assert.equal(Buffer.from((await reader.read()).value!).toString(), 'test');
  await reader.cancel();
});
