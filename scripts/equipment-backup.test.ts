import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_TABLES, compatibleBackupColumns } from '../lib/backup-format';

const before0016 = ['id', 'ownerId', 'companyId', 'name', 'category', 'vendor', 'model', 'serial', 'siteId'];

test('a backup taken before migration 0016 still restores into customerAssets with the inventory ID', () => {
  assert.equal(compatibleBackupColumns('customerAssets', [...before0016, 'assetTag'], before0016), true);
  assert.equal(
    compatibleBackupColumns('customerAssets', [...before0016, 'assetTag'], [...before0016, 'assetTag']),
    true,
  );
  // Only the reviewed addition may be missing: an unknown gap still blocks the restore.
  assert.equal(compatibleBackupColumns('customerAssets', [...before0016, 'assetTag', 'unknown'], before0016), false);
});

test('ticketFulfillment joins the backup with the code that writes it (F6-B2), not with the migration', () => {
  // Until F6-B2 nothing writes the table, so a backup without it is complete. When this assertion starts failing
  // because the table was added, also add it to the backup profiles, the export, the restore and the drill.
  assert.equal((BACKUP_TABLES as readonly string[]).includes('ticketFulfillment'), false);
});
