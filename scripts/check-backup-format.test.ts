import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BACKUP_TABLES,
  canonicalBackupRows,
  decryptBackup,
  encryptBackup,
  sha256,
  validateBackup,
  type WorkspaceBackup,
} from '../lib/backup-format';
function fixture(): WorkspaceBackup {
  return {
    format: 'daybook.workspace.v1',
    ownerId: 'qa-owner',
    organizationId: 'qa-space',
    createdAt: '2026-11-05T12:00:00Z',
    tables: BACKUP_TABLES.map(name => ({
      name,
      columns: ['id', 'ownerId'],
      rows: [],
      sha256: sha256(canonicalBackupRows([])),
    })),
    files: [],
    omissions: [],
  };
}
test('encrypted archive round-trip keeps exact table data and private file bytes', () => {
  const backup = fixture(),
    bytes = Buffer.from('Archivo privado de prueba'),
    row = { id: 'file-one', ownerId: 'qa-owner', status: 'attached', size: bytes.length };
  const table = backup.tables.find(table => table.name === 'attachments')!;
  table.columns = Object.keys(row);
  table.rows = [row];
  table.sha256 = sha256(canonicalBackupRows(table.rows));
  backup.files.push({
    attachmentId: row.id,
    size: bytes.length,
    sha256: sha256(bytes),
    base64: bytes.toString('base64'),
  });
  const encrypted = encryptBackup(backup, 'qa-private-password-for-test');
  assert.equal(encrypted.includes(bytes), false);
  assert.deepEqual(decryptBackup(encrypted, 'qa-private-password-for-test'), backup);
});
test('wrong password and tampered encrypted bytes fail before any recovery', () => {
  const encrypted = encryptBackup(fixture(), 'qa-private-password-for-test');
  assert.throws(() => decryptBackup(encrypted, 'incorrect-private-password'));
  encrypted[encrypted.length - 3] ^= 1;
  assert.throws(() => decryptBackup(encrypted, 'qa-private-password-for-test'));
  assert.throws(() => encryptBackup(fixture(), 'short'));
});
test('table scope, checksum and missing file checks reject incomplete backups', () => {
  const wrongOwner = fixture(),
    table = wrongOwner.tables.find(table => table.name === 'tickets')!;
  table.rows = [{ id: '1', ownerId: 'someone-else' }];
  table.sha256 = sha256(canonicalBackupRows(table.rows));
  assert.throws(() => validateBackup(wrongOwner), /workspace/);
  const corrupt = fixture();
  corrupt.tables[0].sha256 = 'tampered';
  assert.throws(() => validateBackup(corrupt), /checksum/);
  const missing = fixture(),
    attachment = missing.tables.find(table => table.name === 'attachments')!;
  attachment.columns = ['id', 'ownerId', 'status', 'size'];
  attachment.rows = [{ id: 'file', ownerId: 'qa-owner', status: 'attached', size: 1 }];
  attachment.sha256 = sha256(canonicalBackupRows(attachment.rows));
  assert.throws(() => validateBackup(missing), /missing/);
});
