// Dos arreglos del escritorio (2026-11-17):
// 1. «% solucionados» del Resumen y «Solicitudes solucionadas» del portal contaban
//    solo los tickets en «Solucionado». Cerrar exige solucionar antes, así que un
//    ticket cerrado también está solucionado y tiene que sumar.
// 2. Exportar CSV encendía el estado global de guardado: bloqueaba la navegación y
//    la apertura de tickets y mostraba «Guardando…», aunque exportar solo lee.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { solvedCount, statusChangeProblem } from '../lib/ticket-status';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('los cerrados cuentan como solucionados', () => {
  assert.equal(solvedCount({ resolved: 3, closed: 2 }), 5);
  assert.equal(solvedCount({ resolved: 0, closed: 4 }), 4);
  assert.equal(solvedCount({}), 0);
  // La premisa: no se puede cerrar sin haber solucionado.
  assert.ok(statusChangeProblem('open', 'closed'));
  assert.equal(statusChangeProblem('resolved', 'closed'), null);
});

test('el Resumen y el portal usan la suma de solucionados y cerrados', async () => {
  const overview = await read('app/desk-parts/overview.tsx');
  assert.match(overview, /const resolved = data\.ticketCounts \? solvedCount\(data\.ticketCounts\) : 0;/);
  const portal = await read('app/client-portal.tsx');
  assert.match(portal, /<strong>\{solvedCount\(counts\)\}<\/strong>\s*<small>Solicitudes solucionadas<\/small>/);
});

test('exportar tiene su propio estado y no toca el de guardado', async () => {
  const desk = await read('app/desk.tsx');
  const start = desk.indexOf('const exportCsv = async () => {');
  const body = desk.slice(start, desk.indexOf('\n  };', start));
  assert.ok(start > 0);
  assert.doesNotMatch(body, /setBusy\(/, 'exportar no enciende ni apaga el estado global');
  assert.match(body, /if \(exporting\) return;\s*setExporting\(true\);/);
  assert.match(body, /finally \{\s*setExporting\(false\);\s*\}/);
  const inbox = await read('app/desk-parts/inbox-view.tsx');
  assert.match(inbox, /disabled=\{busy \|\| exporting\} aria-busy=\{exporting\} onClick=\{exportCsv\}/);
  assert.match(inbox, /\{exporting \? 'Exportando…' : 'Exportar'\}/);
});
