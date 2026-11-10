import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEvolutionQaArguments } from './migrate-evolution-qa.mjs';
import { loadEvolutionMigrationArtifacts, analyzeEvolutionSql } from './migrate-evolution-production.mjs';
const environment = {
  DAYBOOK_QA_ALLOW_TEST_DATABASE: '1',
  DATABASE_URL:
    'postgres://fixture:fictional@ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech/daybook_ticket?sslmode=require',
};
test('QA migration entry point requires an exact reviewed prefix and isolated host before any database access', () => {
  const options = validateEvolutionQaArguments(['--through=0013'], environment);
  assert.equal(options.mode, 'dry-run');
  assert.equal(options.through, '0013');
  const url = new URL(options.connectionString);
  assert.equal(url.hostname, 'ep-falling-water-bbfa4ijl.c-15.us-east-1.aws.neon.tech');
  assert.equal(url.searchParams.get('sslmode'), 'verify-full');
  assert.equal(validateEvolutionQaArguments(['--through=0013', '--apply'], environment).mode, 'apply');
  assert.equal(validateEvolutionQaArguments(['--through=0014'], environment).through, '0014');
  for (const args of [
    [],
    ['--apply'],
    ['--through=0015'],
    ['--through=0013', '--through=0013'],
    ['--through=0013', '--force'],
    ['--audit', '--through=0013'],
  ])
    assert.throws(() => validateEvolutionQaArguments(args, environment));
  for (const changed of [
    { DAYBOOK_QA_ALLOW_TEST_DATABASE: '0' },
    { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    { RESEND_API_KEY: 'forbidden-fixture-key' },
    { DATABASE_URL: 'postgres://fixture:fictional@production.example.test/daybook_ticket' },
    { DATABASE_URL: environment.DATABASE_URL.replace('/daybook_ticket', '/other_database') },
  ])
    assert.throws(() => validateEvolutionQaArguments(['--through=0013'], { ...environment, ...changed }));
});
test('commercial migration pin verifies every preceding artifact and the single reviewed push-index replacement', async () => {
  const artifacts = await loadEvolutionMigrationArtifacts('0013');
  assert.equal(artifacts.files.length, 14);
  const last = artifacts.files[13];
  assert.equal(last.tag, '0013_workspaces');
  assert.equal(last.when, 1793912006000);
  const plan = analyzeEvolutionSql(13, last.content.toString('utf8'));
  assert.equal(plan.replacesPushEndpoint, true);
  assert.ok(plan.tables.some(value => value.name === 'workspaceProfiles'));
});
