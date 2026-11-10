import test from 'node:test';
import assert from 'node:assert/strict';
import { daybookFetch } from '../lib/browser-request';
import { safeSecurityRedirect } from '../lib/security-navigation';
import { assertWorkspaceOperational, lockWorkspaceState } from '../lib/workspaces';
import type { PoolClient } from 'pg';

test('verification redirects preserve the ticket and workspace without replaying a failed mutation', async () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'),
    oldFetch = globalThis.fetch,
    redirects: string[] = [],
    requests: string[] = [];
  const base = 'https://qa.example.test';
  try {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: {
          origin: base,
          href: `${base}/w/alpha?ticket=6`,
          pathname: '/w/alpha',
          search: '?ticket=6',
          replace: (path: string) => redirects.push(path),
        },
      },
    });
    globalThis.fetch = async input => {
      requests.push(String(input));
      return Response.json({ error: 'Verifica tu acceso', redirectTo: '/security' }, { status: 428 });
    };
    const response = await daybookFetch('/api/tickets/6/messages', { method: 'POST', body: 'Exact uncertain fixture' });
    assert.deepEqual(requests, ['/api/workspaces/alpha/tickets/6/messages']);
    assert.equal(response.status, 428);
    assert.equal((await response.json()).error, 'Verifica tu acceso');
    assert.equal(redirects.length, 1);
    const redirect = new URL(redirects[0]);
    assert.equal(redirect.pathname, '/w/alpha/security');
    assert.equal(redirect.searchParams.get('return_to'), '/w/alpha?ticket=6');
    globalThis.fetch = async () =>
      Response.json({ error: 'Wrong hint', redirectTo: '/w/beta/security' }, { status: 428 });
    await daybookFetch('/api/tickets/6/messages', { method: 'POST' });
    assert.equal(redirects.length, 1);
    globalThis.fetch = async () =>
      Response.json(
        { error: 'Wrong return hint', redirectTo: '/w/alpha/security?return_to=%2Fw%2Fbeta%3Fticket%3D9' },
        { status: 428 },
      );
    await daybookFetch('/api/tickets/6/messages', { method: 'POST' });
    assert.equal(new URL(redirects[1]).searchParams.get('return_to'), '/w/alpha');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('security hints admit only exact global or scoped verification pages', () => {
  assert.equal(safeSecurityRedirect('/w/alpha/security'), '/w/alpha/security');
  for (const path of [
    'https://other.test/security',
    '//other.test/security',
    '/w/%2f/security',
    '/w/alpha/../beta/security',
    '/w/alpha/security?redirect=other',
    '/w/alpha/security#secret',
    '/operator',
    '/api/security',
  ])
    assert.equal(safeSecurityRedirect(path), null, path);
});

test('commercial state uses shared transaction locks without quota row upgrades and fails closed for missing profiles', async () => {
  const queries: { sql: string; values: unknown[] }[] = [];
  const tx = {
    query: async (sql: string, values: unknown[] = []) => {
      queries.push({ sql, values });
      return { rows: [] };
    },
  } as unknown as PoolClient;
  await lockWorkspaceState(tx, 'fixture-owner');
  await lockWorkspaceState(tx, 'fixture-owner', true);
  assert.match(queries[0].sql, /pg_advisory_xact_lock_shared/);
  assert.match(queries[1].sql, /pg_advisory_xact_lock\(/);
  assert.deepEqual(queries[0].values, ['commercial-workspace-state:fixture-owner']);
  assert.deepEqual(queries[1].values, queries[0].values);
  await assert.rejects(
    () => assertWorkspaceOperational('missing-fixture', tx),
    error => (error as { status: number }).status === 423,
  );
  await assert.rejects(
    () => assertWorkspaceOperational('missing-fixture', tx, true),
    error => (error as { status: number }).status === 423,
  );
  assert.ok(queries.every(({ sql }) => !sql.includes('FOR SHARE') && !sql.includes('FOR UPDATE')));
});
