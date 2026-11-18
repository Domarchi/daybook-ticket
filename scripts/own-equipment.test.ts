import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  completeOwnEquipmentSchema,
  OWN_EQUIPMENT_MESSAGES,
  ownEquipmentNeed,
  registerOwnEquipmentSchema,
  type OwnEquipment,
} from '../lib/client-equipment-model';
import { WORKSPACE_ROUTE_REGISTRY } from '../lib/workspace-route-registry';

const item = (serial: string, id = 'a1'): OwnEquipment => ({
  id,
  assetTag: 'NB-1',
  name: 'Computador NB-1',
  category: 'Computador',
  serial,
  model: '',
  companyName: 'Andes',
});

test('the portal asks a client for what is missing: equipment, a serial number, or nothing', () => {
  assert.deepEqual(ownEquipmentNeed([], true), { kind: 'register' });
  assert.deepEqual(ownEquipmentNeed([], false), { kind: 'no-company' });
  assert.equal(ownEquipmentNeed([item('SN-1')], true), null);
  assert.deepEqual(ownEquipmentNeed([item('SN-1'), item('  ', 'a2')], true), {
    kind: 'complete',
    items: [item('  ', 'a2')],
  });
});

test('a client sends the invite fields to register and only serial and model to complete', () => {
  assert.equal(registerOwnEquipmentSchema.safeParse({ assetTag: 'NB-1', kind: 'computer', serial: 'S' }).success, true);
  assert.equal(registerOwnEquipmentSchema.safeParse({ assetTag: 'NB-1', kind: 'computer' }).success, false);
  assert.equal(completeOwnEquipmentSchema.safeParse({ serial: 'S', model: 'HP' }).success, true);
  for (const extra of [{ assetTag: 'X' }, { assignedMemberId: 'x' }, { archived: false }, { companyId: 'x' }])
    assert.equal(completeOwnEquipmentSchema.safeParse({ serial: 'S', ...extra }).success, false, Object.keys(extra)[0]);
});

test('client messages never name other equipment or people', () => {
  for (const message of [
    OWN_EQUIPMENT_MESSAGES.tagTaken('NB-1'),
    OWN_EQUIPMENT_MESSAGES.serialTaken,
    OWN_EQUIPMENT_MESSAGES.alreadyHasEquipment,
    OWN_EQUIPMENT_MESSAGES.alreadyComplete,
  ])
    assert.doesNotMatch(message, /asignado a|equipo [A-Z]+-\d|dado de baja/);
});

test('the client routes: active clients only, rate-limited, locked, own equipment only, generic conflicts', () => {
  const server = readFileSync('lib/own-equipment.ts', 'utf8').replace(/\s+/g, ' ');
  assert.match(server, /access\.role !== 'client' \|\| access\.member\.status !== 'active'/);
  assert.match(server, /acquireTicketWorkLock\(tx, access\.ownerId\)/);
  assert.match(server, /requireActiveClient\(await lockAccess\(tx, access\)\)/, 're-checked under the lock');
  assert.match(server, /"assignedContactMemberId"=\$3 AND archived=false FOR UPDATE/, 'completes only own equipment');
  assert.match(server, /if \(normalizeSerial\(before\.serial\)\) throw new ApiError\(409/, 'never overwrites a serial');
  assert.match(server, /if \(taken\.rows\.length\) throw/, 'never takes an existing ID');
  assert.match(server, /if \(mine\.rows\.length\) throw/, 'registers only when they have none');
  assert.match(server, /error\.status === 409\) throw new ApiError\(409, message\)/, 'conflicts are generic');
  for (const file of ['app/api/equipment/mine/route.ts', 'app/api/equipment/mine/[id]/route.ts']) {
    const route = readFileSync(file, 'utf8');
    assert.match(route, /requireActiveClient\(await requireAccess\(request\)\)/, file);
    assert.match(route, /consumeRateLimit\(access, RATE_RULES\.ownEquipment\)/, file);
  }
  const mine = WORKSPACE_ROUTE_REGISTRY.find(route => route.pattern.test('equipment/mine'));
  const one = WORKSPACE_ROUTE_REGISTRY.find(route => route.pattern.test('equipment/mine/6f1b8a52'));
  assert.equal(typeof (mine?.handlers as Record<string, unknown>).POST, 'function');
  assert.equal(typeof (mine?.handlers as Record<string, unknown>).GET, 'function');
  assert.equal(typeof (one?.handlers as Record<string, unknown>).PATCH, 'function');
});
