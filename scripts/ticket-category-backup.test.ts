import test from 'node:test';
import assert from 'node:assert/strict';
import { compatibleBackupColumns } from '../lib/backup-format';

const before0015 = ['id', 'ownerId', 'subject', 'status', 'isTest'];
const added = ['faultGroup', 'faultElement', 'requirement', 'categorySource', 'categoryConfidence'];

test('a backup taken before migration 0015 still restores into tickets with the category columns', () => {
  assert.equal(compatibleBackupColumns('tickets', [...before0015, ...added], before0015), true);
  assert.equal(compatibleBackupColumns('tickets', [...before0015, ...added], [...before0015, ...added]), true);
  // Only the reviewed additions may be missing: an unknown gap still blocks the restore.
  assert.equal(compatibleBackupColumns('tickets', [...before0015, ...added, 'unknown'], before0015), false);
});
