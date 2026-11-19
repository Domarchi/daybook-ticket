import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { isSerialConflict } from '../lib/server';
import { normalizeSerial } from '../lib/client-equipment-model';

test('a write refused by the serial index of 0017 is told apart from a repeated inventory ID', () => {
  assert.equal(isSerialConflict({ code: '23505', constraint: 'customer_assets_owner_serial' }), true);
  assert.equal(isSerialConflict({ code: '23505', constraint: 'customer_assets_owner_tag' }), false);
  assert.equal(isSerialConflict({ code: '23503', constraint: 'customer_assets_owner_serial' }), false);
  assert.equal(isSerialConflict(null), false);
  for (const file of ['lib/client-equipment.ts', 'lib/equipment-inventory.ts'])
    assert.match(readFileSync(file, 'utf8'), /code === '23505' && !isSerialConflict\(error\)/, file);
});

test('the index compares serials exactly as the code normalizes them', () => {
  const sql = readFileSync('drizzle-postgres/0017_equipment_serial_unique.sql', 'utf8');
  assert.match(sql, /upper\(regexp_replace\(btrim\(serial\),'\\s\+',' ','g'\)\)/);
  assert.match(sql, /WHERE btrim\(serial\)<>''/, 'equipment without a serial is not indexed');
  const check = readFileSync('lib/client-equipment.ts', 'utf8');
  assert.match(check, /upper\(regexp_replace\(btrim\(serial\), '\\\\s\+', ' ', 'g'\)\)=\$2/);
  // What the SQL computes for these spellings is what the code stores.
  assert.equal(normalizeSerial('  5cg   1234x '), '5CG 1234X');
  assert.equal(normalizeSerial('5CG\t1234X'), '5CG 1234X');
});
