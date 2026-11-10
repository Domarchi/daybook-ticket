/** Serial coordinator-only QA entry point for the reviewed migration operator.
 * No broad destructive-DDL exception: pinned grammar, journal and fingerprint
 * checks authorize only the exact reviewed push index replacement.
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import {
  loadEvolutionMigrationArtifacts,
  runEvolutionMigrationOperator,
  evolutionFailureReport,
} from './migrate-evolution-production.mjs';

export function validateEvolutionQaArguments(args, environment) {
  assert.equal(environment.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
  assert.notEqual(environment.NODE_TLS_REJECT_UNAUTHORIZED, '0');
  for (const key of ['RESEND_API_KEY', 'RESEND_INBOUND_API_KEY', 'VAPID_PRIVATE_KEY']) assert.ok(!environment[key]);
  assert.ok(args.length >= 1 && args.length <= 2);
  assert.equal(new Set(args).size, args.length);
  const target = args.find(value => /^--through=/.test(value));
  assert.ok(target && /^--through=(?:000[7-9]|001[0-3])$/.test(target));
  assert.ok(args.every(value => value === target || value === '--apply'));
  const url = new URL(environment.DATABASE_URL);
  assert.equal(url.hostname, 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
  assert.equal(url.pathname, '/daybook_ticket');
  url.hostname = 'ep-falling-water-bbfa4ijl.c-15.us-east-1.aws.neon.tech';
  url.searchParams.set('sslmode', 'verify-full');
  return {
    connectionString: url.toString(),
    through: target.slice('--through='.length),
    mode: args.includes('--apply') ? 'apply' : 'dry-run',
  };
}
async function main() {
  const { connectionString, ...options } = validateEvolutionQaArguments(process.argv.slice(2), process.env),
    artifacts = await loadEvolutionMigrationArtifacts(options.through);
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 10000,
    query_timeout: 60000,
    application_name: `daybook-ticket-qa-through-${options.through}-operator`,
  });
  try {
    await client.connect();
    const result = await runEvolutionMigrationOperator(client, { ...options, artifacts });
    await mkdir('work', { recursive: true });
    await writeFile(
      `work/evolution-migration-${options.through}-${options.mode}.json`,
      JSON.stringify(result, null, 2),
      { mode: 0o600 },
    );
    console.log(JSON.stringify(result));
  } finally {
    await client.end().catch(() => undefined);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => {
    console.error(JSON.stringify(evolutionFailureReport(error)));
    process.exitCode = 1;
  });
