// La frase de marca del pie es opcional y ya no trae el eslogan de fábrica
// («Un servicio Daybook. Cada conversación, una solución.»). Los espacios que lo
// tenían guardado dejan de mostrarlo al leer los ajustes, sin escribir en la base;
// una frase que alguien escribió a mano se respeta.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DEFAULT_SETTINGS } from '../lib/types';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('la frase de marca viene vacía por omisión', () => {
  assert.equal(DEFAULT_SETTINGS.tagline, '');
});

test('el eslogan viejo guardado se descarta al leer, sin tocar una frase propia', async () => {
  const server = await read('lib/server.ts');
  assert.match(server, /'Un servicio Daybook\. Cada conversación, una solución\.'/);
  assert.match(server, /'Cada conversación, una solución\.'/);
  const body = server.slice(server.indexOf('export async function getSettings'));
  assert.match(body, /if \(RETIRED_TAGLINES\.has\(settings\.tagline\)\) settings\.tagline = '';/);
  assert.ok(
    body.indexOf('RETIRED_TAGLINES.has') < body.indexOf('return settings;'),
    'se limpia antes de devolver los ajustes',
  );
});

test('el pie muestra la frase solo si existe y el campo es opcional', async () => {
  const desk = await read('app/desk.tsx');
  assert.match(desk, /\{data\.settings\.tagline && \(/);
  const form = await read('app/desk-parts/settings-form.tsx');
  const input = form.slice(form.indexOf('Frase de marca'), form.indexOf('/>', form.indexOf('Frase de marca')));
  assert.doesNotMatch(input, /required/);
});
