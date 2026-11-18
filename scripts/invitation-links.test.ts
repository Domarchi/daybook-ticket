import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  invitationState,
  invitationStateLabel,
  renewInvitationsSchema,
  RENEW_MAX,
} from '../lib/invitation-links-model';
import { publicMember } from '../lib/access';
import { WORKSPACE_ROUTE_REGISTRY } from '../lib/workspace-route-registry';

const now = new Date('2026-11-18T15:00:00.000Z');
const id = (n: number) => `6f1b8a52-3c1d-4f7e-9a10-${String(n).padStart(12, '0')}`;

test('a pending invitation is valid until its link expires; accepted, active or revoked ones have no link', () => {
  const invited = { status: 'invited', hasAccount: false };
  assert.equal(invitationState({ ...invited, invitationExpiresAt: '2026-11-18T15:00:01.000Z' }, now), 'pending');
  assert.equal(invitationState({ ...invited, invitationExpiresAt: '2026-11-18T15:00:00.000Z' }, now), 'expired');
  assert.equal(invitationState({ ...invited, invitationExpiresAt: null }, now), 'expired', 'no row: renew it');
  assert.equal(invitationState({ ...invited, hasAccount: true, invitationExpiresAt: null }, now), null);
  for (const status of ['active', 'revoked'])
    assert.equal(invitationState({ status, invitationExpiresAt: null }, now), null);
  assert.equal(invitationStateLabel('expired', null), 'Enlace vencido');
  assert.match(invitationStateLabel('pending', '2026-11-21T15:00:00.000Z'), /^Enlace vigente hasta el /);
});

test('renewing takes 1 to 500 distinct accounts', () => {
  assert.equal(renewInvitationsSchema.safeParse({ memberIds: [id(1), id(2)] }).success, true);
  assert.equal(renewInvitationsSchema.safeParse({ memberIds: [] }).success, false);
  assert.equal(renewInvitationsSchema.safeParse({ memberIds: [id(1), id(1)] }).success, false);
  assert.equal(renewInvitationsSchema.safeParse({ memberIds: ['x'] }).success, false);
  assert.equal(
    renewInvitationsSchema.safeParse({ memberIds: Array.from({ length: RENEW_MAX + 1 }, (_, n) => id(n)) }).success,
    false,
  );
  assert.equal(renewInvitationsSchema.safeParse({ memberIds: [id(1)], all: true }).success, false);
});

test('the admin list carries the expiry of pending invitations only', () => {
  const base = {
    id: id(1),
    name: 'Ana',
    email: 'ana@example.test',
    role: 'client' as const,
    hasAccount: false,
    customerCompanyId: null,
    companyAccess: 'own' as const,
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
  };
  assert.equal(
    publicMember({ ...base, status: 'invited', invitationExpiresAt: '2026-11-21T00:00:00.000Z' }).invitationExpiresAt,
    '2026-11-21T00:00:00.000Z',
  );
  assert.equal('invitationExpiresAt' in publicMember({ ...base, status: 'active', invitationExpiresAt: null }), false);
  assert.equal('invitationExpiresAt' in publicMember({ ...base, status: 'invited' }), false, 'other lists omit it');
  const workspace = readFileSync('app/api/workspace/route.ts', 'utf8').replace(/\s+/g, ' ');
  assert.match(
    workspace,
    /i\."memberId" = members\.id AND i\."ownerId" = members\."ownerId" AND i\."acceptedAt" IS NULL/,
  );
});

test('bulk renewal is admin-only, locked, checked per account, and never queues mail', () => {
  const route = readFileSync('app/api/members/invitations/route.ts', 'utf8');
  assert.match(route, /requireAdmin\(await requireAccess\(request\)\)/);
  assert.match(route, /consumeRateLimit\(access, RATE_RULES\.memberImport\)/);
  const server = readFileSync('lib/invitation-links.ts', 'utf8');
  assert.match(server, /acquireTicketWorkLock\(tx, access\.ownerId\)/);
  assert.match(server, /FOR UPDATE OF m/);
  assert.match(server, /checkMemberChange\(fresh, member, \{\}\)/, 'admins only renew whom they may manage');
  assert.match(server, /m\."ownerId" = \$2 AND m\."organizationId" = \$3/, 'only this workspace');
  assert.doesNotMatch(server, /notificationStatements|drainOutbox/, 'no new mail');
  assert.match(server, /SET status='cancelled'/, 'queued mail with the old link is cancelled');
  const at = WORKSPACE_ROUTE_REGISTRY.findIndex(route => route.pattern.test('members/invitations'));
  const member = WORKSPACE_ROUTE_REGISTRY.findIndex(route => route.pattern.test('members/6f1b8a52'));
  assert.ok(at >= 0 && at < member, 'matched before members/:id');
  assert.equal(typeof (WORKSPACE_ROUTE_REGISTRY[at].handlers as Record<string, unknown>).POST, 'function');
});
