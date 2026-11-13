// Ticket marca el tema como Parte Diario y Travel: `data-theme` con el tema que
// se ve (claro u oscuro). La preferencia elegida, incluido «sistema», va en
// `data-theme-preference`. Antes Ticket usaba `data-color-scheme` para el tema
// resuelto y @daybook/design tenía que aceptar los dos atributos.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await files(path)));
    else if (/\.(css|tsx?)$/.test(entry.name)) out.push(path);
  }
  return out;
}

test('no CSS or code reads or writes data-color-scheme any more', async () => {
  for (const path of [...(await files('app')), ...(await files('lib'))]) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /data-color-scheme|dataset\.colorScheme/, path);
  }
});

test('the theme controls write the resolved theme to data-theme and the choice to data-theme-preference', async () => {
  const source = await readFile(new URL('../app/evolution-controls.tsx', import.meta.url), 'utf8');
  assert.match(source, /root\.dataset\.themePreference = theme;/);
  assert.match(source, /root\.dataset\.theme = theme === 'system' \? \(query\.matches \? 'dark' : 'light'\) : theme;/);
  assert.match(source, /if \(!root\.dataset\.themePreference \|\| root\.dataset\.themePreference === 'system'\)/);
});
