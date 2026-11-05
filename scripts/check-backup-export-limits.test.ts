import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import type { Database } from '../db/database';
import type { AccessContext } from '../lib/access';
import { BACKUP_TABLES, canonicalBackupRows } from '../lib/backup-format';
import { ApiError } from '../lib/server';
import { createWorkspaceBackup } from '../lib/workspace-backup';

const maximumDataBytes = 24 * 1024 * 1024;
const owner = {
  id: 'qa-export-owner', ownerId: 'qa-export-space-owner', organizationId: 'qa-export-space',
  userId: 'qa-export-user', name: 'QA export owner', email: 'qa-export-owner@example.test',
  role: 'owner', status: 'active', customerCompanyId: null, companyAccess: 'own',
  createdAt: '2026-11-05T12:00:00.000Z', updatedAt: '2026-11-05T12:00:00.000Z',
} as const;
const access: AccessContext = {
  ownerId: owner.ownerId, organizationId: owner.organizationId, userId: owner.userId,
  role: 'owner', member: { ...owner, hasAccount: true },
};
const firstRow = { id: 'qa-user', ownerId: owner.ownerId, createdAt: '2026-11-05 12:00:00.123456+00' };

/** Metadata/totals only: the oversized payload does not exist in this fixture.
 * Any attempt to select its body fails before constructing or returning it.
 */
function fixture(overrides: Record<string, { rows: string; bytes: string }> = {}, forbiddenTable?: string) {
  const queries: { sql: string; values?: unknown[] }[] = [], materialized: string[] = [];
  const client = {
    async query(sql: string, values?: unknown[]) {
      queries.push({ sql, values });
      if (sql.startsWith('SET ')) return { rows: [] };
      if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ locked: true }] };
      if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
      if(sql.includes('LEFT JOIN \"workspaceProfiles\"'))return {rows:[{id:owner.organizationId,state:'active'}]};
      if (sql.startsWith('SELECT state FROM \"workspaceProfiles\"')) return {rows:[]};
      if (sql.startsWith('SELECT * FROM members')) return { rows: [owner] };
      if (sql.includes('FROM information_schema.columns')) {
        const table = values?.[1];
        const fields = table === 'authUser' ? ['id', 'ownerId', 'createdAt'] : ['id', 'ownerId'];
        return { rows: fields.map(column_name => ({ column_name, data_type: column_name === 'createdAt' ? 'timestamp with time zone' : 'text' })) };
      }
      const table = /FROM "([^"]+)" WHERE/.exec(sql)?.[1];
      assert.ok(table, `Unexpected query: ${sql}`);
      assert.deepEqual(values, [owner.ownerId]);
      assert.match(sql, /LIMIT 100001/);
      if (sql.startsWith('SELECT count(*)::text AS rows')) {
        assert.match(sql, /sum\(octet_length\(row_to_json\(source\)::text\)\)/);
        const totals = overrides[table] ?? { rows: table === 'authUser' ? '1' : '0', bytes: table === 'authUser' ? String(Buffer.byteLength(JSON.stringify(firstRow))) : '0' };
        return { rows: [totals] };
      }
      assert.notEqual(table, forbiddenTable, 'An oversized table must never materialize rows in the Function');
      materialized.push(table);
      return { rows: table === 'authUser' ? [firstRow] : [] };
    },
  };
  const database = { transaction: async <T>(work: (tx: PoolClient) => Promise<T>) => work(client as unknown as PoolClient) } as unknown as Database;
  return { database, queries, materialized };
}

function oversized(error: unknown) { return error instanceof ApiError && error.status === 413; }

test('backup rejects an oversized table using only SQL totals before materializing any payload', async () => {
  const mock = fixture({ authUser: { rows: '2400', bytes: String(384 * 1024 * 1024) } }, 'authUser');
  await assert.rejects(createWorkspaceBackup(access, mock.database), oversized);
  assert.deepEqual(mock.materialized, []);
  assert.equal(mock.queries.filter(query => query.sql.startsWith('SELECT count(*)::text AS rows')).length, 1);
});

test('backup rejects 100001 rows without fetching them, and applies cumulative row limits', async () => {
  for (const [table, totals, expected] of [
    ['authUser', { rows: '100001', bytes: '100001' }, []],
    ['authAccount', { rows: '100000', bytes: '100000' }, ['authUser']],
  ] as const) {
    const mock = fixture({ [table]: totals }, table);
    await assert.rejects(createWorkspaceBackup(access, mock.database), oversized);
    assert.deepEqual(mock.materialized, expected);
  }
});

test('backup adds previously read bytes before evaluating the next table totals', async () => {
  const firstBytes = Buffer.byteLength(canonicalBackupRows([firstRow]));
  const mock = fixture({ authAccount: { rows: '1', bytes: String(maximumDataBytes - firstBytes + 1) } }, 'authAccount');
  await assert.rejects(createWorkspaceBackup(access, mock.database), oversized);
  assert.deepEqual(mock.materialized, ['authUser']);
});

test('bounded export reuses the exact scoped timestamp projection and preserves the manifest', async () => {
  const mock = fixture();
  const backup = await createWorkspaceBackup(access, mock.database);
  assert.deepEqual(backup.tables.map(table => table.name), [...BACKUP_TABLES]);
  assert.deepEqual(backup.tables[0].rows, [firstRow]);
  assert.equal(backup.files.length, 0);
  assert.equal(mock.materialized.length, BACKUP_TABLES.length);
  const selects = mock.queries.filter(query => /^SELECT "id"/.test(query.sql));
  const preflights = mock.queries.filter(query => query.sql.startsWith('SELECT count(*)::text AS rows'));
  assert.equal(preflights.length, selects.length);
  for (let index = 0; index < selects.length; index++) assert.ok(preflights[index].sql.includes(`FROM (${selects[index].sql}) source`));
  assert.match(selects[0].sql, /"createdAt"::text AS "createdAt"/);
  assert.match(selects[0].sql, /id IN \(SELECT "userId" FROM members WHERE "ownerId"=\$1/);
  assert.match(selects.find(query => query.sql.includes('FROM "attachments"'))!.sql, /status='attached'/);
});
