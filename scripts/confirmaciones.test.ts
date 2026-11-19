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

test('solucionar varios tickets a la vez se confirma antes, porque solucionar no ofrece «Deshacer»', async () => {
  const [inbox, overlay] = await Promise.all([read('app/desk-parts/inbox-view.tsx'), read('lib/ticket-overlay.ts')]);
  // La regla que lo justifica: solucionar no se deshace (pide la evaluación al cliente).
  assert.match(overlay, /status === 'resolved' \|\| status === 'closed'/);
  assert.match(inbox, /onClick=\{\(\) => setConfirmingResolve\(true\)\}/, 'el botón abre la confirmación');
  assert.doesNotMatch(inbox, /onClick=\{\(\) => \{\s*void resolveSelected\(\);/, 'ya no soluciona al primer toque');
  assert.match(inbox, /<ConfirmDialog\s+title="Marcar como solucionados"/);
  assert.match(inbox, /confirmLabel=\{`Solucionar \$\{resolving\.count\}`\}/, 'el botón rojo nombra la acción');
  // Con uno solo, la frase va en singular: «Vas a marcar 1 ticket como solucionado. Al cliente…».
  assert.match(inbox, /one \? 'solucionado' : 'solucionados'/);
  assert.match(inbox, /one \? 'Al cliente' : 'A cada cliente'/);
  // Si la selección se vacía con la pregunta abierta, no vuelve a aparecer al marcar el siguiente ticket.
  assert.match(inbox, /if \(confirmingResolve && visibleSelected\.length === 0\) setConfirmingResolve\(false\);/);
});

test('cerrar sesión usa el ícono LogOut y pregunta con los textos de Parte Diario, en Configuración y en el portal', async () => {
  const [shared, sidebar, account, desk, portal] = await Promise.all([
    read('app/desk-parts/shared.tsx'),
    read('app/desk-parts/sidebar.tsx'),
    read('app/desk-parts/account-view.tsx'),
    read('app/desk.tsx'),
    read('app/client-portal.tsx'),
  ]);
  assert.match(shared, /title="Cerrar sesión"/);
  assert.match(
    shared,
    /description="Vas a salir de Daybook Ticket en este dispositivo y tendrás que ingresar de nuevo para seguir\."/,
  );
  assert.match(shared, /confirmLabel="Cerrar sesión"\s+cancelLabel="Seguir trabajando"/);
  assert.match(shared, /\{cancelLabel\}/, 'ConfirmDialog acepta otro texto para el botón de cancelar');
  // Como en Parte Diario, el riel ya no tiene botón de salir: está en Configuración › Sesión, rojo y con su nombre.
  assert.doesNotMatch(sidebar, /LogOut|Cerrar sesión|signOut/, 'el riel no cierra sesión');
  assert.match(account, /<h2 id="configuracion-sesion">Salir de este dispositivo<\/h2>/);
  assert.match(account, /<p className="settings-note">Tendrás que ingresar de nuevo para seguir\.<\/p>/);
  assert.match(
    account,
    /<button type="button" className="danger-button" onClick=\{onSignOut\}>\s*<LogOut size=\{17\} aria-hidden="true" \/>\s*Cerrar sesión/,
  );
  assert.match(desk, /onSignOut=\{askSignOut\}/, 'Configuración pide confirmar en vez de salir');
  assert.match(desk, /<SignOutDialog/);
  assert.match(portal, /onClick=\{\(\) => setConfirmingSignOut\(true\)\}/);
  assert.match(portal, /<SignOutDialog/);
  // El botón llega a 44 px también en escritorio.
  assert.match(await read('app/globals.css'), /\.settings-actions>button\{min-height:44px\}/);
  // El ícono del portal también llega a 44 px con el dedo (la regla base lo dejaba en 42 × 38).
  const portalCss = await read('app/client-portal.css');
  const coarse = portalCss.lastIndexOf('@media (pointer: coarse)');
  assert.ok(coarse > portalCss.indexOf('.client-account > button { display: flex'), 'va después de la regla base');
  assert.match(
    portalCss.slice(coarse),
    /\.client-account > button \{ min-width: var\(--touch-target\); min-height: var\(--touch-target\); \}/,
  );
});
