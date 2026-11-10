import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import type { Database } from '../db/database';
import {
  BACKUP_TABLES,
  LEGACY_BACKUP_TABLES,
  canonicalBackupRows,
  decryptBackup,
  encryptBackup,
  sha256,
  validateBackup,
  type BackupRow,
  type BackupTable,
  type WorkspaceBackup,
} from '../lib/backup-format';
import { restoreWorkspaceBackup, type BackupRestoreStorage } from '../lib/workspace-backup';

const schema = 'daybook_restore_qa_aabbccddeeff0011';
const ownerId = 'fictional-legacy-owner';
function archive(): WorkspaceBackup {
  return {
    format: 'daybook.workspace.v1',
    ownerId,
    organizationId: 'fictional-legacy-org',
    createdAt: '2026-11-05T12:00:00Z',
    omissions: [],
    files: [],
    tables: LEGACY_BACKUP_TABLES.map(name => {
      const rows: BackupRow[] =
        name === 'members'
          ? [{ id: 'legacy-member', ownerId, userId: 'legacy-user', status: 'active' }]
          : name === 'tickets'
            ? [{ id: 8, ownerId, subject: 'Historic private conversation remains unchanged' }]
            : name === 'authAccount'
              ? [
                  {
                    id: 'account',
                    userId: 'legacy-user',
                    password: 'retained-password-hash',
                    accessToken: 'old-token',
                    refreshToken: null,
                    idToken: null,
                    accessTokenExpiresAt: null,
                    refreshTokenExpiresAt: null,
                  },
                ]
              : [];
      return {
        name,
        rows,
        columns: Object.keys(rows[0] || { id: '', ownerId: '' }),
        sha256: sha256(canonicalBackupRows(rows)),
      };
    }),
  };
}
function fixture(source: WorkspaceBackup, occupied?: BackupTable) {
  const rows = new Map<BackupTable, BackupRow[]>(),
    verified = new Set<BackupTable>(),
    queries: string[] = [];
  const definitions = (table: BackupTable) => [
    ...(source.tables.find(item => item.name === table)?.columns || ['id', 'ownerId']),
    ...(['members', 'tickets'].includes(table) ? ['isTest'] : []),
  ];
  const client = {
    async query(sql: string, values?: unknown[]) {
      queries.push(sql);
      if (/^(SET |LOCK TABLE )/.test(sql) || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes('FROM information_schema.columns'))
        return {
          rows: definitions(values?.[1] as BackupTable).map(column_name => ({ column_name, data_type: 'text' })),
        };
      const table = new RegExp(`(?:FROM|INTO|UPDATE) "${schema}"\\."([^"]+)"`).exec(sql)?.[1] as BackupTable;
      assert.ok(BACKUP_TABLES.includes(table), `Unexpected SQL: ${sql}`);
      if (sql.startsWith('SELECT count(*)::int AS n'))
        return { rows: [{ n: table === occupied ? 1 : rows.get(table)?.length || 0 }] };
      if (sql.startsWith('INSERT INTO ')) {
        const columns = source.tables.find(item => item.name === table)!.columns;
        const row = Object.fromEntries(columns.map((column, index) => [column, values![index]])) as BackupRow;
        if (['members', 'tickets'].includes(table)) row.isTest = false;
        rows.set(table, [...(rows.get(table) || []), row]);
      } else if (sql.startsWith('SELECT ')) {
        verified.add(table);
        return { rows: structuredClone(rows.get(table) || []) };
      } else if (sql.startsWith('DELETE ') && table === 'invitations')
        assert.equal(
          verified.size,
          LEGACY_BACKUP_TABLES.length,
          'Validate every original checksum before invalidating credentials.',
        );
      else if (sql.startsWith('UPDATE ') && table === 'authAccount')
        rows.set(
          table,
          (rows.get(table) || []).map(row => ({
            ...row,
            accessToken: null,
            refreshToken: null,
            idToken: null,
            accessTokenExpiresAt: null,
            refreshTokenExpiresAt: null,
          })),
        );
      return { rows: [] };
    },
  };
  const database = {
    transaction: async <T>(work: (tx: PoolClient) => Promise<T>) => work(client as unknown as PoolClient),
  } as unknown as Database;
  const storage: BackupRestoreStorage = {
    environment: 'qa',
    async read() {
      assert.fail('No attachments in this legacy fixture.');
    },
    async write() {
      assert.fail('No attachments in this legacy fixture.');
    },
    async remove() {
      assert.fail('No attachments in this legacy fixture.');
    },
  };
  return { database, storage, rows, queries };
}

test('pre-reliability v1 archives decrypt and restore exact original columns, defaulting new test markers to false', async () => {
  const original = archive(),
    password = 'fictional-legacy-encryption-password';
  const portable = decryptBackup(encryptBackup(original, password), password);
  assert.equal(portable.tables.length, LEGACY_BACKUP_TABLES.length);
  assert.equal(portable.tables.find(table => table.name === 'members')!.columns.includes('isTest'), false);
  const h = fixture(portable);
  const result = await restoreWorkspaceBackup(portable, h.database, h.storage, { environment: 'qa', schema });
  assert.equal(result.fingerprints.length, LEGACY_BACKUP_TABLES.length);
  assert.equal(h.rows.get('members')![0].isTest, false);
  assert.equal(h.rows.get('tickets')![0].isTest, false);
  assert.equal(
    h.rows.get('tickets')![0].subject,
    original.tables.find(table => table.name === 'tickets')!.rows[0].subject,
  );
  assert.equal(h.rows.get('authAccount')![0].password, 'retained-password-hash');
  assert.equal(h.rows.get('authAccount')![0].accessToken, null);
  assert.equal(
    h.queries.some(sql => sql.includes('SET enabled=false') && sql.includes('automaticBackupSettings')),
    true,
  );
  assert.equal(
    h.queries.some(sql => sql.includes("status='deleted'") && sql.includes('automaticBackupRuns')),
    true,
  );
  assert.equal(
    h.queries.some(sql => sql.startsWith('INSERT INTO ') && sql.includes('automaticBackup')),
    false,
  );
});

test('legacy restoration still requires every new target table empty, and malformed table sets or checksums fail before SQL', async () => {
  const source = archive(),
    occupied = fixture(source, 'automaticBackupRuns');
  await assert.rejects(
    restoreWorkspaceBackup(source, occupied.database, occupied.storage, { environment: 'qa', schema }),
    /empty destination/,
  );
  assert.equal(
    occupied.queries.some(sql => sql.startsWith('INSERT INTO ')),
    false,
  );
  const changed = archive();
  changed.tables.find(table => table.name === 'tickets')!.rows[0].subject = 'tampered';
  const h = fixture(changed);
  await assert.rejects(
    restoreWorkspaceBackup(changed, h.database, h.storage, { environment: 'qa', schema }),
    /checksum mismatch/,
  );
  assert.deepEqual(h.queries, []);
  const incomplete = archive();
  incomplete.tables.pop();
  assert.throws(() => validateBackup(incomplete));
  const substituted = archive();
  substituted.tables[substituted.tables.length - 1] = {
    name: 'automaticBackupRuns',
    columns: [],
    rows: [],
    sha256: sha256(''),
  };
  assert.throws(() => validateBackup(substituted), /missing required tables/);
});

import { compatibleBackupColumns } from '../lib/backup-format';
test('only reviewed additive columns can be absent from historical recovery schemas', () => {
  assert.equal(compatibleBackupColumns('messages', ['id', 'body', 'replyToMessageId'], ['id', 'body']), true);
  assert.equal(compatibleBackupColumns('mailOutbox', ['id', 'status', 'sourceMessageId'], ['id', 'status']), true);
  assert.equal(compatibleBackupColumns('authAccount', ['id', 'password'], ['id']), false);
  assert.equal(compatibleBackupColumns('messages', ['id', 'body', 'replyToMessageId'], ['body', 'id']), false);
  assert.equal(compatibleBackupColumns('messages', ['id', 'body'], ['id', 'body', 'unknown']), false);
});
