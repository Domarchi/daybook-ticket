import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import {
  automationEnabledInTransaction,
  enqueueAutomationEvent,
  requireAutomationInTransaction,
} from '../lib/automation';
import {
  AUTOMATION_BACKUP_TABLES,
  BACKUP_TABLES,
  BACKUP_TABLE_PROFILES,
  PRE_AUTOMATION_BACKUP_TABLES,
  PRE_KNOWLEDGE_BACKUP_TABLES,
  validateBackup,
  sha256,
  type WorkspaceBackup,
} from '../lib/backup-format';
import type { AccessContext } from '../lib/access';
const access = { ownerId: 'fictional-owner', member: { id: 'fictional-member' } } as AccessContext;
function featureClient(featuresJson: string | null) {
  const queries: string[] = [];
  return {
    queries,
    tx: {
      async query(sql: string) {
        queries.push(sql);
        if (sql.includes('LEFT JOIN \"workspaceProfiles\"')) return { rows: [{ id: 'daybook', state: null }] };
        if (sql === 'SELECT "featuresJson" FROM "evolutionFeatures" WHERE "ownerId"=$1')
          return { rows: featuresJson === null ? [] : [{ featuresJson }] };
        throw new Error('Paused automation touched operational rows');
      },
    } as unknown as PoolClient,
  };
}
test('paused/missing/malformed feature prevents reserving work, preserving queues and history', async () => {
  for (const value of [null, 'bad-json', '{}', '{"automation":false}']) {
    const { tx, queries } = featureClient(value);
    assert.equal(await automationEnabledInTransaction(tx, access.ownerId), false);
    assert.equal(await enqueueAutomationEvent(tx, access, 6, 'portal:qa', 'ticket_created'), null);
    await assert.rejects(
      requireAutomationInTransaction(tx, access.ownerId),
      error => (error as { status: number }).status === 503,
    );
    assert.equal(queries.length, 6);
    assert.ok(queries.every(sql => sql.startsWith('SELECT')));
  }
});
test('feature activation is explicit and isolated from other feature flags', async () => {
  assert.equal(
    await automationEnabledInTransaction(featureClient('{"organization":true,"automation":true}').tx, access.ownerId),
    true,
  );
  assert.equal(await automationEnabledInTransaction(featureClient('{"organization":true}').tx, access.ownerId), false);
});
const archive = (names: readonly string[]) =>
  ({
    format: 'daybook.workspace.v1',
    createdAt: '2026-11-05T12:00:00Z',
    ownerId: 'fictional-owner',
    organizationId: 'fictional-org',
    tables: names.map(name => ({ name, columns: [], rows: [], sha256: sha256('') })),
    files: [],
    omissions: [],
  }) as WorkspaceBackup;
test('every historical exact table profile remains accepted, including the complete E3 and E4 profiles', () => {
  assert.equal(AUTOMATION_BACKUP_TABLES.length, 8);
  assert.equal(PRE_KNOWLEDGE_BACKUP_TABLES.length, PRE_AUTOMATION_BACKUP_TABLES.length + 8);
  assert.ok(PRE_KNOWLEDGE_BACKUP_TABLES.every(name => BACKUP_TABLES.includes(name)));
  assert.doesNotThrow(() => validateBackup(archive(PRE_KNOWLEDGE_BACKUP_TABLES)));
  for (const profile of BACKUP_TABLE_PROFILES) assert.doesNotThrow(() => validateBackup(archive(profile)));
  const forged = archive(PRE_AUTOMATION_BACKUP_TABLES);
  forged.tables[0] = { name: 'automationSettings', columns: [], rows: [], sha256: sha256('') };
  assert.throws(() => validateBackup(forged), /missing required/);
});
