// El logo de la familia Daybook (@daybook/design 0.8, marca.css): Parte Diario,
// Travel y Ticket lo dibujan con el mismo marcado y las mismas medidas, para que
// se lean como una batería de herramientas. Ticket no le pone tamaño propio.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Brand from '../app/brand';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

async function files(dir: string, ext: string): Promise<[string, string][]> {
  const out: [string, string][] = [];
  for (const entry of await readdir(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await files(path, ext)));
    else if (entry.name.endsWith(ext)) out.push([path, await read(path)]);
  }
  return out;
}

const render = (props: Parameters<typeof Brand>[0] = {}) => renderToStaticMarkup(createElement(Brand, props));

test('marca.css is imported right after the shared states', async () => {
  const layout = await read('app/layout.tsx');
  assert.match(layout, /import '@daybook\/design\/estados\.css';\nimport '@daybook\/design\/marca\.css';/);
});

test('the full logo is the family lockup: symbol from CSS, DAYBOOK and TICKET as text', () => {
  const html = render();
  assert.match(html, /^<span class="db-lockup" role="img" aria-label="Daybook Ticket">/);
  assert.match(html, /<span class="db-mark" aria-hidden="true"><\/span>/);
  assert.match(html, /<span class="db-lockup__type" aria-hidden="true">/);
  assert.match(html, /<span class="db-lockup__name">Daybook<\/span>/);
  assert.match(html, /<span class="db-lockup__product">Ticket<\/span>/);
  assert.doesNotMatch(html, /<img/, 'the logo is not an image');
  assert.doesNotMatch(html, /style=|width=|height=/, 'the logo carries no size of its own');
  // Ticket has no descriptor; if one is ever added it goes outside the logo.
  assert.doesNotMatch(html, /db-lockup-descriptor/);
});

test('on the dark rail the logo takes the on-dark colours; the mark alone can be large', () => {
  assert.match(render({ dark: true }), /^<span class="db-lockup db-on-dark" role="img" aria-label="Daybook Ticket">/);
  assert.equal(
    render({ compact: true, large: true }),
    '<span class="db-mark db-mark--large" role="img" aria-label="Daybook"></span>',
  );
  assert.equal(render({ compact: true }), '<span class="db-mark" role="img" aria-label="Daybook"></span>');
});

test('the rail brand block and the sign-in card use the shared classes', async () => {
  const sidebar = await read('app/desk-parts/sidebar.tsx');
  assert.match(
    sidebar,
    /<div className="db-brand-block db-on-dark">\s*<button className="brand" onClick=\{\(\) => go\('inbox'\)\}>\s*<Brand dark \/>\s*<\/button>\s*<\/div>/,
  );
  const login = await read('app/login/login-form.tsx');
  assert.match(login, /<header className="auth-topbar">\s*<a href="\/login">\s*<Brand \/>/);
  assert.match(login, /<div className="auth-icon">\s*<Brand compact large \/>/);
  assert.match(login, /<span className="auth-eyebrow">Acceso seguro<\/span>/);
  assert.match(
    login,
    /<footer className="auth-footer">\s*<span>Daybook Ticket<\/span>\s*<span>Centro de soporte<\/span>/,
  );
  const portal = await read('app/client-portal.tsx');
  assert.match(portal, /<button className="client-brand" onClick=\{\(\) => navigate\('tickets'\)\}>\s*<Brand dark \/>/);
});

test('no stylesheet sizes the logo or swaps its image by hand any more', async () => {
  for (const [path, css] of await files('app', '.css')) {
    assert.doesNotMatch(css, /daybook-brand|daybook-mark-(?:light|dark)/, `${path} still styles the old logo`);
    assert.doesNotMatch(css, /\.db-(?:lockup|mark)[\w-]*\s*\{/, `${path} restyles the shared logo`);
    assert.doesNotMatch(css, /\.brand(?:-symbol|\s+small|>span)/, `${path} still sizes the old rail logo`);
  }
});

test('the sign-in label is the brand gold, 12 px bold uppercase; nothing on the page is under 11 px', async () => {
  const css = await read('app/login/login.css');
  const at = css.indexOf('.auth-eyebrow{');
  const rule = css.slice(at, css.indexOf('}', at));
  for (const piece of [
    'font-size:var(--db-text-caption)',
    'font-weight:var(--db-weight-bold)',
    'letter-spacing:.08em',
    'text-transform:uppercase',
    'color:var(--db-brand)',
  ])
    assert.ok(rule.includes(piece), `.auth-eyebrow needs ${piece}`);
  assert.doesNotMatch(css, /\.auth-eyebrow\{[^}]*\}[\s\S]*\.auth-eyebrow\{/, 'one .auth-eyebrow rule for both themes');
  assert.doesNotMatch(css, /border-top:3px/, 'the sign-in card has no gold bar on top');
  assert.doesNotMatch(css, /font-size:(?:[0-9]|10)px/);
});

test('no full-logo image is left in public/', async () => {
  const names = await readdir(new URL('../public/brand', import.meta.url));
  assert.deepEqual(
    names.filter(name => /logo/.test(name)),
    [],
  );
});
