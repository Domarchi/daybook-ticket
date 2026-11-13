// Fase 5c del estándar Daybook: la carga se dibuja con la forma del contenido y
// el vacío es uno solo, con el CSS de @daybook/design/estados.css (el mismo de
// Parte Diario y Travel).
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

async function appSources() {
  const out: [string, string][] = [];
  for (const dir of ['app', 'app/desk-parts']) {
    for (const name of await readdir(new URL(`../${dir}`, import.meta.url))) {
      if (name.endsWith('.tsx')) out.push([`${dir}/${name}`, await read(`${dir}/${name}`)]);
    }
  }
  return out;
}

test('the shared CSS is imported right after the tokens', async () => {
  const layout = await read('app/layout.tsx');
  assert.match(layout, /import '@daybook\/design\/tokens\.css';\nimport '@daybook\/design\/estados\.css';/);
  const css = await read('node_modules/@daybook/design/src/estados.css');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('loading keeps its words for screen readers while the eye sees the skeleton', async () => {
  const estados = await read('app/estados.tsx');
  assert.match(
    estados,
    /role="status" aria-live="polite" aria-busy="true">\s*<span className="db-visually-hidden">\{label\}<\/span>/,
  );
  for (const cls of ['db-empty__icon', 'db-empty__title', 'db-empty__text', 'db-empty__action']) {
    assert.match(estados, new RegExp(cls), cls);
  }
});

test('no block shows a bare «Cargando…/Consultando…» paragraph or an old one-off empty class', async () => {
  const bare = /<p[^>]*role="status"[^>]*>\s*(?:<[^>]+>\s*)?(?:Cargando|Consultando|Buscando)[^<]*…\s*<\/p>/;
  const oldEmpty =
    /className="(?:empty|kr-empty|service-context-empty|ops-empty|client-empty|ticket-chat-empty|ticket-alert-empty|access-empty|agent-metrics-empty|mail-tracking-empty)"/;
  for (const [file, source] of await appSources()) {
    assert.doesNotMatch(source, bare, `${file}: «Cargando…» suelto`);
    assert.doesNotMatch(source, oldEmpty, `${file}: vacío propio`);
  }
});
