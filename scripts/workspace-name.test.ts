import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { extraWorkspaceName } from '../app/brand';

test('the workspace name replaces the fixed «Servicios Daybook» and is not repeated next to the brand', () => {
  const settings = { brandName: 'Mesa TI Andes' };
  assert.equal(extraWorkspaceName({ workspaceName: 'Constructora Andes', settings }), 'Constructora Andes');
  assert.equal(extraWorkspaceName({ workspaceName: 'Mesa TI Andes', settings }), null);
  assert.equal(extraWorkspaceName({ settings }), null);
  for (const file of ['app/desk.tsx', 'app/client-portal.tsx', 'app/desk-parts/sidebar.tsx'])
    assert.doesNotMatch(readFileSync(file, 'utf8'), /Servicios Daybook/, file);
  assert.match(readFileSync('app/api/workspace/route.ts', 'utf8'), /workspaceName: organization\?\.name/);
});
