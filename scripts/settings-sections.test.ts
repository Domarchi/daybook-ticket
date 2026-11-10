import test from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_SECTIONS } from '../lib/desk-url';
import { availableSettingsSections, resolveSettingsSection, SETTINGS_SECTION_LABELS } from '../lib/settings-sections';

test('General, correo and funciones always exist; the others depend on the workspace', () => {
  assert.deepEqual(availableSettingsSections({ organization: false, backups: false, businessWorkspace: false }), [
    'general',
    'mail',
    'features',
  ]);
  assert.deepEqual(availableSettingsSections({ organization: true, backups: true, businessWorkspace: true }), [
    'general',
    'mail',
    'organization',
    'backups',
    'features',
    'workspace',
  ]);
  assert.deepEqual(availableSettingsSections({ organization: true, backups: false, businessWorkspace: false }), [
    'general',
    'mail',
    'organization',
    'features',
  ]);
});

test('a section the workspace does not have opens General', () => {
  const available = availableSettingsSections({ organization: false, backups: false, businessWorkspace: false });
  assert.equal(resolveSettingsSection('mail', available), 'mail');
  assert.equal(resolveSettingsSection('backups', available), 'general');
  assert.equal(resolveSettingsSection('workspace', available), 'general');
});

test('every section has a label in Spanish', () => {
  for (const section of SETTINGS_SECTIONS) assert.ok(SETTINGS_SECTION_LABELS[section], section);
  assert.equal(Object.keys(SETTINGS_SECTION_LABELS).length, SETTINGS_SECTIONS.length);
});
