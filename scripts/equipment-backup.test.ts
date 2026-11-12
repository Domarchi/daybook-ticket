import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_TABLES, BACKUP_TABLE_PROFILES, compatibleBackupColumns } from '../lib/backup-format';
import { BUSINESS_EXPORT_TABLES } from '../lib/business-export';

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

test('ticketFulfillment is backed up and restored after tickets, members and equipment (F6-B2)', () => {
  const tables = BACKUP_TABLES as readonly string[];
  assert.ok(tables.includes('ticketFulfillment'));
  for (const before of ['tickets', 'members', 'customerAssets'])
    assert.ok(tables.indexOf(before) < tables.indexOf('ticketFulfillment'), `${before} is restored first`);
  // Backups taken before this change have one table less and must still be accepted.
  assert.ok(
    BACKUP_TABLE_PROFILES.some(
      profile => profile.length === BACKUP_TABLES.length - 1 && !profile.includes('ticketFulfillment'),
    ),
  );
  assert.ok((BUSINESS_EXPORT_TABLES as readonly string[]).includes('ticketFulfillment'));
});
