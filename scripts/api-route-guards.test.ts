import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';

const root = join(import.meta.dirname, '..', 'app', 'api');

function routeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === 'route.ts' ? [path] : [];
  });
}

/** Handlers that authenticate the caller (session, membership or role) before doing work. */
const sessionGuard = /requireAccess|require[A-Za-z]*Access|requireStaff|requireAdmin|requireOperator|\bauth\(|getDaybookUser/;

/**
 * Routes that intentionally have no session guard. Each one authenticates by
 * another mechanism, or refuses everything. Adding a route here needs a reason.
 */
const otherwiseProtected: Record<string, { marker: RegExp; reason: string }> = {
  'auth/[...all]/route.ts': { marker: /daybookAuth[\s\S]*Ruta no disponible/, reason: 'closed allow-list of Better Auth paths; Better Auth applies its own rate limits and CSRF' },
  'health/route.ts': { marker: /checkHealth/, reason: 'public liveness probe; returns only ok/degraded and a version, database check is cached' },
  'workspaces/route.ts': { marker: /listIdentityWorkspaces/, reason: 'lib/workspaces.ts calls auth(request) and returns only the caller\'s own active memberships' },
  'setup/route.ts': { marker: /status:\s*403/, reason: 'always refuses; owner provisioning is offline' },
  'webhooks/resend/route.ts': { marker: /createResendWebhookHandlers/, reason: 'verifies the Svix signature on the raw body' },
  'webhooks/resend/inbound/route.ts': { marker: /createResendWebhookHandlers/, reason: 'verifies the Svix signature on the raw body' },
  'internal/automation-tick/route.ts': { marker: /secret:\s*process\.env\./, reason: 'constant-time bearer secret, disabled unless enabled' },
  'internal/backup-tick/route.ts': { marker: /secret:\s*process\.env\./, reason: 'constant-time bearer secret, disabled unless enabled' },
  'internal/inbound-tick/route.ts': { marker: /secret:\s*process\.env\./, reason: 'constant-time bearer secret, disabled unless enabled' },
  'internal/notification-tick/route.ts': { marker: /secret:\s*process\.env\./, reason: 'constant-time bearer secret, disabled unless enabled' },
  'internal/service-context-tick/route.ts': { marker: /secret:\s*process\.env\./, reason: 'constant-time bearer secret, disabled unless enabled' },
};

test('every API route authenticates the caller or is a documented exception', () => {
  const files = routeFiles(root);
  assert.ok(files.length > 50, 'the route scan found too few files to be meaningful');
  const unguarded: string[] = [];
  for (const file of files) {
    const key = relative(root, file).split(sep).join('/');
    const source = readFileSync(file, 'utf8');
    if (sessionGuard.test(source)) continue;
    const exception = otherwiseProtected[key];
    if (!exception || !exception.marker.test(source)) unguarded.push(key);
  }
  assert.deepEqual(unguarded, [], `API routes without an access guard or a documented exception: ${unguarded.join(', ')}`);
});

test('documented exceptions still exist, so the list cannot rot', () => {
  const present = new Set(routeFiles(root).map(file => relative(root, file).split(sep).join('/')));
  const missing = Object.keys(otherwiseProtected).filter(key => !present.has(key));
  assert.deepEqual(missing, [], `Exceptions for routes that no longer exist: ${missing.join(', ')}`);
});
