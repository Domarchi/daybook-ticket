// Restos de la bandeja: tras «Marcar como solucionados» con varios, el foco no
// se pierde en <body> (la barra masiva y su botón ya no existen), y las reglas
// CSS del panel «En foco», que ya no se dibuja, salen de las hojas compartidas
// sin arrastrar los selectores vivos que compartían regla con ellas.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const DEAD = /\.(focus-(count|divider|heading|icon|link|panel)|next-step)(?![\w-])/;

test('solucionar varios avisa si todo salió bien y la bandeja lleva el foco a la cola activa', async () => {
  const [desk, inbox] = await Promise.all([read('app/desk.tsx'), read('app/desk-parts/inbox-view.tsx')]);
  assert.match(
    desk,
    /notify\(ids\.length === 1 \? words\.one : `\$\{ids\.length\} \$\{words\.many\}`\);\s*setSelected\(\[\]\);\s*return true;/,
  );
  assert.match(desk, /many: 'tickets solucionados'/);
  assert.match(desk, /many: 'tickets cerrados'/);
  assert.match(desk, /setSelected\(failed\);\s*return false;/);
  assert.match(inbox, /resolveSelected: \(status\?: 'resolved' \| 'closed'\) => Promise<boolean>;/);
  assert.match(inbox, /<section className="ticket-panel" ref=\{ticketPanel\}>/);
  assert.match(inbox, /querySelector<HTMLElement>\('\.queue-tabs \[aria-pressed="true"\]'\)\?\.focus\(\)/);
  // The dialog closes and the focus moves in the same render, only when every ticket was solved.
  assert.match(inbox, /setConfirming\(null\);\s*if \(solved\) setListFocus\(count => count \+ 1\);/);
  // The bar's own «Cancelar» takes the bar away too: same landing place, not <body>.
  assert.match(inbox, /setSelected\(\[\]\);\s*setListFocus\(count => count \+ 1\);\s*\}\}\s*>\s*Cancelar/);
  // One ticket left in the bar is said in singular.
  assert.match(inbox, /visibleSelected\.length === 1 \? 'seleccionado' : 'seleccionados'/);
  // The result is said by the status region, which exists before the notice appears.
  assert.match(desk, /<div className="toast-region" role="status" aria-live="polite" aria-atomic="true">/);
});

test('ninguna hoja compartida conserva reglas del panel «En foco»', async () => {
  for (const sheet of ['app/globals.css', 'app/evolution-theme.css']) {
    const css = await read(sheet);
    assert.doesNotMatch(css, DEAD, sheet);
  }
});

test('los selectores vivos que compartían regla con «En foco» siguen con sus estilos', async () => {
  const [globals, theme] = await Promise.all([read('app/globals.css'), read('app/evolution-theme.css')]);
  assert.match(
    globals,
    /\.panel,\.ticket-panel,\.stat-card,\.detail-aside,\.conversation,\.contact-card,\.team-card,\.article-card\{border-color:var\(--line\);/,
  );
  assert.match(globals, /\.setting-icon,\.article-icon\{background:#faf3e3;color:#805a0e;/);
  for (const scope of [':root:not\\(\\[data-theme="light"\\]\\)', ':root\\[data-theme="dark"\\]']) {
    assert.match(
      theme,
      new RegExp(`${scope} \\.setting-icon,${scope} \\.article-icon\\{background:#292315;color:#edc879;`),
    );
    assert.match(theme, new RegExp(`${scope} \\.requester>a\\{color:#edc879\\}`));
  }
});

test('en el tema oscuro «Urgente» y «Baja» tienen su propio color, legible sobre negro', async () => {
  const theme = await read('app/evolution-theme.css');
  for (const scope of [':root:not\\(\\[data-theme="light"\\]\\)', ':root\\[data-theme="dark"\\]']) {
    assert.match(theme, new RegExp(`${scope} \\.priority\\.urgent\\{color:#ffb4aa\\}`));
    assert.match(theme, new RegExp(`${scope} \\.priority\\.low\\{color:#b9c7b5\\}`));
  }
});
