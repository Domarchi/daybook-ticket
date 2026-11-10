import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_PILOT_LIMITS } from '../lib/workspace-model';
import { EVOLUTION_FEATURES } from '../lib/evolution-feature-model';
import {
  MEGABYTE,
  isEvolutionFeaturesResponse,
  readWorkspaceLimits,
  workspaceStorageMegabytesInput,
  workspaceRoleLabel,
  workspaceStateLabel,
} from '../lib/workspace-administration-ui';

function fields(storage = String(DEFAULT_PILOT_LIMITS.storageBytes / MEGABYTE)) {
  const form = new FormData();
  for (const [key, value] of Object.entries(DEFAULT_PILOT_LIMITS))
    if (key !== 'storageBytes') form.set(key, String(value));
  form.set('storageMegabytes', storage);
  return form;
}
test('pilot preparation accepts the actual complete feature response for reads and changes', () => {
  const features = Object.fromEntries(EVOLUTION_FEATURES.map(key => [key, key === 'security' || key === 'workspaces']));
  for (const available of [false, true])
    assert.equal(isEvolutionFeaturesResponse({ features, version: 0, available }), true);
  for (const invalid of [
    {},
    { features, available: true },
    { features, version: -1, available: true },
    { features, version: 1.5, available: true },
    { features, version: 1, available: [] },
    { features: { security: true, workspaces: true }, version: 1, available: true },
    { features: [], version: 1, available: true },
  ])
    assert.equal(isEvolutionFeaturesResponse(invalid), false);
});
test('friendly quota fields retain the exact byte payload, including a one-byte adjustment', () => {
  assert.deepEqual(readWorkspaceLimits(fields()), DEFAULT_PILOT_LIMITS);
  for (const bytes of [10 * MEGABYTE, 10 * MEGABYTE + 1, 10 * MEGABYTE + 19, 10240 * MEGABYTE - 1, 10240 * MEGABYTE])
    assert.equal(readWorkspaceLimits(fields(workspaceStorageMegabytesInput(bytes))).storageBytes, bytes);
  assert.equal(readWorkspaceLimits(fields('1e2')).storageBytes, 100 * MEGABYTE);
  assert.equal(readWorkspaceLimits(fields('10.00000095367431640625')).storageBytes, 10 * MEGABYTE + 1);
});
test('quota fields reject fractional bytes, unsafe values and every schema boundary violation', () => {
  for (const storage of [
    '10.1',
    '9',
    '10241',
    'NaN',
    'Infinity',
    '1e99',
    '',
    '10000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  ])
    assert.throws(() => readWorkspaceLimits(fields(storage)));
  for (const [name, bad] of [
    ['members', '0'],
    ['members', '201'],
    ['ticketsMonthly', '10001'],
    ['messagesMonthly', '100001'],
    ['mailMonthly', '100001'],
    ['members', '1.5'],
  ]) {
    const form = fields();
    form.set(name, bad);
    assert.throws(() => readWorkspaceLimits(form));
  }
});
test('roles and commercial states use an explicit Spanish vocabulary and a closed fallback', () => {
  assert.equal(workspaceRoleLabel('agent'), 'Agente');
  assert.equal(workspaceRoleLabel('client'), 'Cliente');
  assert.equal(workspaceStateLabel('active'), 'Activo');
  assert.equal(workspaceStateLabel('suspended'), 'En pausa');
  for (const value of ['unknown', '__proto__', 'constructor', null, {}]) {
    assert.equal(workspaceRoleLabel(value), 'No disponible');
    assert.equal(workspaceStateLabel(value), 'No disponible');
  }
});
