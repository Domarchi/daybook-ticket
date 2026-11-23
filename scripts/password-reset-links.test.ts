import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  RESET_HASH_PREFIX,
  RESET_IDENTIFIER_PREFIX,
  RESET_LINK_HOURS,
  resetIdentifierHash,
  resetLinkProblem,
  resetLinkUrl,
  storedResetIdentifier,
} from '../lib/password-reset-model';
import { securityActionNeedsReauthentication, SECURITY_ACTIONS } from '../lib/security-model';
import { RATE_RULES } from '../lib/rate-limit';

type StorageOption = unknown;
// Better Auth's own lookup, read from the installed build (not exported): the stored form must be what it computes.
const storageModule = '../node_modules/better-auth/dist/db/verification-token-storage.mjs';
const { getStorageOption, processIdentifier } = (await import(storageModule)) as {
  getStorageOption: (identifier: string, config: unknown) => StorageOption;
  processIdentifier: (identifier: string, option: StorageOption) => Promise<string>;
};

const TOKEN = 'a'.repeat(64);
const AUTH_OPTION = {
  default: 'plain' as const,
  overrides: { [RESET_IDENTIFIER_PREFIX]: { hash: async (identifier: string) => resetIdentifierHash(identifier) } },
};

test('reset tokens are stored only as a hash that no raw token can reach', async () => {
  const stored = storedResetIdentifier(TOKEN);
  assert.ok(stored.startsWith(RESET_HASH_PREFIX));
  assert.ok(!stored.includes(TOKEN));
  assert.equal(stored, storedResetIdentifier(TOKEN), 'deterministic');
  assert.notEqual(stored, storedResetIdentifier('b'.repeat(64)));
  // Better Auth also tries the plain identifier `reset-password:<token>`; the stored form never has that prefix.
  assert.ok(!stored.startsWith(RESET_IDENTIFIER_PREFIX));
});

test('Better Auth hashes reset identifiers the same way and leaves the others plain', async () => {
  const identifier = `${RESET_IDENTIFIER_PREFIX}${TOKEN}`;
  assert.equal(
    await processIdentifier(identifier, getStorageOption(identifier, AUTH_OPTION)),
    storedResetIdentifier(TOKEN),
  );
  for (const other of ['2fa-otp-x', 'delete-account-x', 'some-random-two-factor-id'])
    assert.equal(await processIdentifier(other, getStorageOption(other, AUTH_OPTION)), other);
  const source = readFileSync('lib/daybook-auth.ts', 'utf8');
  assert.match(source, /storeIdentifier: \{\s*default: 'plain',\s*overrides: \{ \[RESET_IDENTIFIER_PREFIX\]: \{ hash:/);
  assert.match(source, /revokeSessionsOnPasswordReset: true/, 'a new password closes every session');
  assert.match(source, /onPasswordReset: async/, 'a saved password voids the remaining links');
});

test('the link opens the existing «Una nueva contraseña» page', () => {
  const url = new URL(resetLinkUrl('https://daybook.example.test', TOKEN));
  assert.equal(url.origin, 'https://daybook.example.test');
  assert.equal(url.pathname, '/login');
  assert.equal(url.searchParams.get('reset'), '1');
  assert.equal(url.searchParams.get('token'), TOKEN);
  assert.equal(RESET_LINK_HOURS, 24);
});

test('only active accounts that belong to this workspace alone get a link', () => {
  const active = { role: 'client', status: 'active', userId: 'u1' };
  const alone = { otherMemberships: 0, platformOperator: false };
  assert.equal(resetLinkProblem(active, alone), null);
  assert.equal(resetLinkProblem({ ...active, role: 'agent' }, alone), null);
  assert.match(resetLinkProblem({ ...active, status: 'invited', userId: null }, alone)!, /invitación/);
  assert.match(resetLinkProblem({ ...active, userId: null }, alone)!, /invitación/);
  assert.match(resetLinkProblem({ ...active, status: 'revoked' }, alone)!, /Restaura/);
  assert.match(resetLinkProblem(active, { otherMemberships: 1, platformOperator: false })!, /otro espacio/);
  assert.match(resetLinkProblem(active, { otherMemberships: 0, platformOperator: true })!, /otro espacio/);
});

test('creating a link asks for a recent password check, is rate limited, audited and routed', () => {
  assert.equal(securityActionNeedsReauthentication('/api/members/m1/password-reset', 'POST'), true);
  assert.equal(securityActionNeedsReauthentication('/api/workspaces/w1/members/m1/password-reset', 'POST'), true);
  assert.ok(RATE_RULES.passwordResetLink.max > 0);
  // The database only accepts the actions of its closed list, last set by migration 0018.
  const allowed = /CHECK\(action IN \(([^)]*)\)\)/.exec(
    readFileSync('drizzle-postgres/0018_security_audit_reset_actions.sql', 'utf8'),
  )![1];
  for (const action of SECURITY_ACTIONS) assert.ok(allowed.includes(`'${action}'`), action);
  const registry = readFileSync('lib/workspace-route-registry.ts', 'utf8');
  const specific = registry.indexOf("'^members/([^/]+)/password-reset$'");
  assert.ok(specific > 0);
  assert.ok(specific < registry.indexOf("'^members/([^/]+)$'"), 'before the generic member route');
  const server = readFileSync('lib/password-reset-links.ts', 'utf8');
  assert.match(server, /checkMemberChange\(fresh, member, \{\}\)/, 'same who-can-manage rule as invitations');
  assert.match(server, /DELETE FROM "authVerification"/, 'a new link replaces the earlier ones');
  assert.match(server, /recordSecurityEvent\(tx, fresh, 'password_reset_link_created', member\.id\)/);
  assert.match(readFileSync('lib/daybook-auth.ts', 'utf8'), /'password_reset_completed',id,\$2 FROM members/);
});
