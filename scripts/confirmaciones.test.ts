// Fase 5b del estándar Daybook (@daybook/design 0.6): lo que no tiene vuelta
// atrás se confirma en un diálogo propio con el botón rojo lleno que nombra la
// acción; lo que se puede revertir se hace y el aviso ofrece «Deshacer» 10 s.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('deletions without undo go through ConfirmDialog, never an inline row or window.confirm', async () => {
  const files = ['app/saved-replies.tsx', 'app/operations-settings.tsx', 'app/work-organization.tsx'];
  for (const file of files) {
    const source = await read(file);
    assert.match(source, /<ConfirmDialog\b/, `${file}: usa el diálogo propio`);
    assert.doesNotMatch(
      source,
      /Confirmar eliminación|¿Eliminar est[ae]/,
      `${file}: sin la fila de confirmación en línea`,
    );
    assert.doesNotMatch(source, /window\.confirm/, file);
  }
  const shared = await read('app/desk-parts/shared.tsx');
  assert.match(shared, /className="danger-button" disabled=\{busy\} onClick=\{onConfirm\}/);
  assert.match(shared, /useEffect\(\(\) => cancel\.current\?\.focus\(\), \[\]\)/, 'el foco cae en «Cancelar»');
});

test('the red button and the undo button use the package tokens', async () => {
  const css = await read('app/globals.css');
  assert.match(css, /\.danger-button\{[^}]*background:var\(--db-danger-action\);color:var\(--db-danger-action-text\)/);
  assert.match(css, /\.danger-button:not\(:disabled\):hover\{[^}]*background:var\(--db-danger-action-hover\)/);
  assert.match(css, /\.toast-undo\{[^}]*border:1px solid var\(--db-toast-border\)/);
});

test('revoking access is not confirmed: it offers «Deshacer» back to the previous status', async () => {
  const [access, desk, tools] = await Promise.all([
    read('app/access-panel.tsx'),
    read('app/desk.tsx'),
    read('app/team-tools.tsx'),
  ]);
  assert.match(access, /\{ run: \(\) => void update\(member, \{ status: member\.status \}\) \}/);
  assert.match(desk, /notify\(message, undo \?\? null\);/);
  assert.match(desk, /undoAction \? 10_000 : 4000/, 'con «Deshacer» el aviso dura --db-toast-duration-undo');
  assert.match(tools, /undo\?: \{ run: \(\) => void \}/);
});
