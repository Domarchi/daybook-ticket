import assert from 'node:assert/strict';
import test from 'node:test';
import { symmetricEncrypt } from 'better-auth/crypto';
import { validateMfaBackup, verifyMfaBackupSecret } from '../lib/mfa-backup';
import { BACKUP_TABLES, canonicalBackupRows, sha256, type WorkspaceBackup } from '../lib/backup-format';
import { restoreWorkspaceBackup } from '../lib/workspace-backup';
import type { Database } from '../db/database';
const secret = 'fictitious-authentication-key-for-backup-tests-only';
test('MFA manifests reject missing factors, contradictory flags and duplicate protected records', () => {
  const user = { id: 'user', twoFactorEnabled: true },
    factor = { id: 'factor', userId: 'user', secret: 'ciphertext', backupCodes: 'ciphertext', verified: true };
  const manifest = (users: Record<string, unknown>[], factors: Record<string, unknown>[]) => ({
    tables: [
      { name: 'authUser', rows: users },
      { name: 'twoFactor', rows: factors },
    ],
  });
  assert.throws(() => validateMfaBackup(manifest([user], [])), /missing/);
  assert.throws(() => validateMfaBackup(manifest([{ ...user, twoFactorEnabled: false }], [factor])), /Inconsistent/);
  assert.throws(() => validateMfaBackup(manifest([user], [factor, factor])), /Invalid/);
  assert.throws(() => validateMfaBackup(manifest([user], [{ ...factor, secret: '' }])), /Invalid/);
  assert.throws(() => validateMfaBackup(manifest([{ ...user, twoFactorEnabled: 'false' }], [])), /Invalid/);
  assert.doesNotThrow(() => validateMfaBackup(manifest([{ id: 'legacy' }], [])));
  assert.doesNotThrow(() =>
    validateMfaBackup(manifest([{ ...user, twoFactorEnabled: false }], [{ ...factor, verified: false }])),
  );
});
test('the original authentication key is verified without revealing or disabling the enrolled factor', async () => {
  const data = {
    tables: [
      { name: 'authUser', rows: [{ id: 'user', twoFactorEnabled: true }] },
      {
        name: 'twoFactor',
        rows: [
          {
            id: 'factor',
            userId: 'user',
            verified: true,
            secret: await symmetricEncrypt({ key: secret, data: 'fictitious-random-totp-material-32' }),
            backupCodes: await symmetricEncrypt({ key: secret, data: JSON.stringify(['one-use-code']) }),
          },
        ],
      },
    ],
  };
  await assert.rejects(() => verifyMfaBackupSecret(data), /required/);
  await assert.rejects(() => verifyMfaBackupSecret(data, 'wrong-fictitious-key'), /cannot verify/);
  await assert.doesNotReject(() => verifyMfaBackupSecret(data, secret));
  assert.equal((data.tables[0].rows[0] as { twoFactorEnabled?: boolean }).twoFactorEnabled, true);
  const used = {
    ...data,
    tables: [
      data.tables[0],
      {
        name: 'twoFactor',
        rows: [{ ...data.tables[1].rows[0], backupCodes: await symmetricEncrypt({ key: secret, data: '[]' }) }],
      },
    ],
  };
  await assert.doesNotReject(
    () => verifyMfaBackupSecret(used, secret),
    'All recovery codes may legitimately have been consumed.',
  );
});
test('missing auth key fails recovery before opening SQL or writing a file', async () => {
  const backup: WorkspaceBackup = {
    format: 'daybook.workspace.v1',
    ownerId: 'owner',
    organizationId: 'daybook',
    createdAt: new Date().toISOString(),
    tables: BACKUP_TABLES.map(name => ({ name, columns: ['id'], rows: [], sha256: sha256('') })),
    files: [],
    omissions: [],
  };
  const user = backup.tables.find(table => table.name === 'authUser')!,
    factor = backup.tables.find(table => table.name === 'twoFactor')!;
  user.columns = ['id', 'twoFactorEnabled'];
  user.rows = [{ id: 'user', twoFactorEnabled: true }];
  user.sha256 = sha256(canonicalBackupRows(user.rows));
  factor.columns = ['id', 'userId', 'verified', 'secret', 'backupCodes'];
  factor.rows = [{ id: 'factor', userId: 'user', verified: true, secret: 'protected', backupCodes: 'protected' }];
  factor.sha256 = sha256(canonicalBackupRows(factor.rows));
  await assert.rejects(
    () =>
      restoreWorkspaceBackup(
        backup,
        { transaction: () => assert.fail('No SQL on an unverifiable MFA archive.') } as unknown as Database,
        {
          environment: 'qa',
          write: async () => assert.fail('No writes'),
          read: async () => assert.fail('No reads'),
          remove: async () => assert.fail('No cleanup needed'),
        },
        { environment: 'qa', authSecret: '' },
      ),
    /required/,
  );
});
