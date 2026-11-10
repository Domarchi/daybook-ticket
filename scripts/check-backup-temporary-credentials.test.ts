import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import type { Database } from '../db/database';
import type { AccessContext } from '../lib/access';
import {
  BACKUP_TABLES,
  canonicalBackupRows,
  sha256,
  type BackupRow,
  type BackupTable,
  type WorkspaceBackup,
} from '../lib/backup-format';
import { createWorkspaceBackup, restoreWorkspaceBackup, type BackupRestoreStorage } from '../lib/workspace-backup';

const now = '2026-11-05T12:00:00.000Z';
const owner = {
  id: 'owner-member',
  ownerId: 'workspace-owner',
  organizationId: 'workspace',
  userId: 'owner-user',
  role: 'owner',
  status: 'active',
  name: 'QA owner',
  email: 'owner@example.test',
  customerCompanyId: null,
  companyAccess: 'own',
  createdAt: now,
  updatedAt: now,
} as const;
const access: AccessContext = {
  ownerId: owner.ownerId,
  organizationId: owner.organizationId,
  userId: owner.userId,
  role: 'owner',
  member: { ...owner, hasAccount: true },
};
const temporaryColumns = ['accessToken', 'refreshToken', 'idToken', 'accessTokenExpiresAt', 'refreshTokenExpiresAt'];
const account: BackupRow = {
  id: 'account',
  accountId: owner.userId,
  userId: owner.userId,
  providerId: 'credential',
  password: 'retained-password-hash',
  accessToken: 'dummy-access',
  refreshToken: 'dummy-refresh',
  idToken: 'dummy-id',
  accessTokenExpiresAt: now,
  refreshTokenExpiresAt: now,
};
const invitation: BackupRow = {
  memberId: 'invited-member',
  ownerId: owner.ownerId,
  tokenHash: 'dummy-token-hash',
  expiresAt: '2099-01-01T00:00:00.000Z',
  createdAt: now,
};
const sourceRows = Object.fromEntries(
  BACKUP_TABLES.map(table => [
    table,
    table === 'authUser'
      ? [{ id: owner.userId }]
      : table === 'authAccount'
        ? [account]
        : table === 'members'
          ? [{ id: 'invited-member', ownerId: owner.ownerId, status: 'invited', userId: null }]
          : table === 'invitations'
            ? [invitation]
            : [],
  ]),
) as Record<BackupTable, BackupRow[]>;
const tableColumns = (table: BackupTable) => Object.keys(sourceRows[table][0] ?? { id: '', ownerId: '' });
const storage: BackupRestoreStorage = {
  environment: 'qa',
  async read() {
    throw new Error('No file I/O expected.');
  },
  async write() {
    throw new Error('No file I/O expected.');
  },
  async remove() {
    throw new Error('No file I/O expected.');
  },
};

async function portableArchive() {
  const queries: string[] = [];
  const client = {
    async query(sql: string, values?: unknown[]) {
      queries.push(sql);
      if (sql.startsWith('SET ')) return { rows: [] };
      if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ locked: true }] };
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes('LEFT JOIN \"workspaceProfiles\"'))
        return { rows: [{ id: owner.organizationId, state: 'active' }] };
      if (sql.startsWith('SELECT * FROM members')) return { rows: [owner] };
      if (sql.includes('FROM information_schema.columns'))
        return {
          rows: tableColumns(values?.[1] as BackupTable).map(column_name => ({ column_name, data_type: 'text' })),
        };
      const table = /FROM "([^"]+)" WHERE/.exec(sql)?.[1] as BackupTable;
      assert.ok(BACKUP_TABLES.includes(table), `Unexpected query: ${sql}`);
      let rows = sourceRows[table];
      if (table === 'authAccount') {
        for (const column of temporaryColumns)
          assert.ok(sql.includes(`NULL AS "${column}"`), `${column} must be excluded before SQL materializes rows.`);
        rows = rows.map(row => ({ ...row, ...Object.fromEntries(temporaryColumns.map(column => [column, null])) }));
      }
      if (table === 'invitations') {
        assert.match(sql, /AND FALSE/);
        rows = [];
      }
      return {
        rows: sql.startsWith('SELECT count(*)::text AS rows')
          ? [{ rows: String(rows.length), bytes: String(Buffer.byteLength(canonicalBackupRows(rows))) }]
          : structuredClone(rows),
      };
    },
  };
  const database = {
    transaction: async <T>(work: (tx: PoolClient) => Promise<T>) => work(client as unknown as PoolClient),
  } as unknown as Database;
  return { archive: await createWorkspaceBackup(access, database), queries };
}

test('exports account identities and passwords while excluding invitation and OAuth credentials in SQL', async () => {
  const { archive, queries } = await portableArchive();
  assert.equal(archive.tables.length, BACKUP_TABLES.length);
  const portable = archive.tables.find(table => table.name === 'authAccount')!.rows[0];
  assert.equal(portable.password, account.password);
  assert.equal(portable.providerId, account.providerId);
  assert.equal(portable.accountId, account.accountId);
  for (const column of temporaryColumns) assert.equal(portable[column], null);
  assert.deepEqual(archive.tables.find(table => table.name === 'invitations')!.rows, []);
  assert.deepEqual(archive.tables.find(table => table.name === 'members')!.rows, sourceRows.members);
  assert.equal(
    queries.filter(sql => sql.includes('FROM "authAccount" WHERE')).length,
    2,
    'The size preflight uses the same safe projection as the data read.',
  );
  assert.equal(account.accessToken, 'dummy-access');
  assert.equal(sourceRows.invitations.length, 1, 'Export does not mutate the source.');
});

test('legacy v1 recovery verifies original fingerprints before invalidating temporary credentials', async () => {
  const { archive } = await portableArchive();
  const legacy: WorkspaceBackup = structuredClone(archive);
  legacy.tables.find(table => table.name === 'authAccount')!.rows = [structuredClone(account)];
  legacy.tables.find(table => table.name === 'invitations')!.rows = [structuredClone(invitation)];
  for (const table of legacy.tables) table.sha256 = sha256(canonicalBackupRows(table.rows));
  const recovered = new Map<BackupTable, BackupRow[]>(),
    verified = new Set<BackupTable>();
  const client = {
    async query(sql: string, values?: unknown[]) {
      if (sql.startsWith('SET ') || sql.startsWith('LOCK TABLE ') || sql.includes('pg_advisory_xact_lock'))
        return { rows: [] };
      if (sql.includes('FROM information_schema.columns'))
        return {
          rows: legacy.tables
            .find(table => table.name === values?.[1])!
            .columns.map(column_name => ({ column_name, data_type: 'text' })),
        };
      const table = /(?:FROM|INTO|UPDATE) "daybook_restore_qa_aabbccddeeff0011"\."([^"]+)"/.exec(
        sql,
      )?.[1] as BackupTable;
      assert.ok(BACKUP_TABLES.includes(table), `Unexpected query: ${sql}`);
      if (sql.startsWith('SELECT count(*)::int AS n')) return { rows: [{ n: recovered.get(table)?.length ?? 0 }] };
      if (sql.startsWith('INSERT INTO ')) {
        const columns = legacy.tables.find(item => item.name === table)!.columns;
        recovered.set(table, [
          ...(recovered.get(table) ?? []),
          Object.fromEntries(columns.map((column, index) => [column, values![index]])) as BackupRow,
        ]);
      } else if (sql.startsWith('SELECT ')) {
        verified.add(table);
        return { rows: structuredClone(recovered.get(table) ?? []) };
      } else if (table === 'invitations' && sql.startsWith('DELETE ')) {
        assert.equal(
          verified.size,
          BACKUP_TABLES.length,
          'Invalidation happens only after every original table checksum passed.',
        );
        recovered.set(table, []);
      } else if (table === 'authAccount' && sql.startsWith('UPDATE ')) {
        for (const column of temporaryColumns) assert.ok(sql.includes(`"${column}"=NULL`));
        recovered.set(
          table,
          recovered
            .get(table)!
            .map(row => ({ ...row, ...Object.fromEntries(temporaryColumns.map(column => [column, null])) })),
        );
      }
      return { rows: [] };
    },
  };
  const database = {
    transaction: async <T>(work: (tx: PoolClient) => Promise<T>) => work(client as unknown as PoolClient),
  } as unknown as Database;
  const result = await restoreWorkspaceBackup(legacy, database, storage, {
    environment: 'qa',
    schema: 'daybook_restore_qa_aabbccddeeff0011',
  });
  assert.equal(result.temporaryCredentialsRestored, false);
  assert.equal(result.fingerprints.length, BACKUP_TABLES.length);
  assert.deepEqual(recovered.get('invitations'), []);
  assert.deepEqual(recovered.get('members'), sourceRows.members);
  const restored = recovered.get('authAccount')![0];
  assert.equal(restored.password, account.password);
  assert.equal(restored.userId, account.userId);
  assert.equal(restored.providerId, account.providerId);
  for (const column of temporaryColumns) assert.equal(restored[column], null);
});
