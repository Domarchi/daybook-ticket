// Bandeja: sin el panel «En foco» (repetía la cifra de vencidos y le quitaba
// ancho a la tabla), la tarjeta de vencidos con el color de peligro y clicable,
// y cifras sin el «0» delante. Nuevo ticket del equipo: «Cuenta del cliente» es
// el mismo Combobox con búsqueda de la ficha, y cambiar de cliente no borra en
// silencio los campos de la empresa.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { companyFieldsAfterRequesterChange } from '../lib/new-ticket-requester';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('la bandeja ya no tiene el panel «En foco» y la tabla toma ese ancho', async () => {
  const [inbox, css] = await Promise.all([read('app/desk-parts/inbox-view.tsx'), read('app/globals.css')]);
  assert.doesNotMatch(inbox, /focus-panel|En foco/);
  assert.match(css, /\.inbox-grid\{display:grid;grid-template-columns:minmax\(0,1fr\);gap:20px\}/);
  assert.doesNotMatch(css, /\.inbox-grid\{grid-template-columns:minmax\(0,1fr\) \d+px\}/);
  assert.doesNotMatch(css, /\.focus-panel\{display:none\}/);
});

test('la tarjeta «SLA vencido» usa el color de peligro y lleva a la cola de vencidos', async () => {
  const [inbox, shared, css] = await Promise.all([
    read('app/desk-parts/inbox-view.tsx'),
    read('app/desk-parts/shared.tsx'),
    read('app/globals.css'),
  ]);
  assert.match(inbox, /label="SLA vencido"[\s\S]*?color="danger"\s+onClick=\{\(\) => \{[\s\S]*?setQueue\('overdue'\);/);
  assert.match(css, /\.stat-icon\.danger\{background:var\(--db-danger-soft\);color:var\(--db-danger\)\}/);
  assert.match(shared, /<button type="button" className="stat-card-link" onClick=\{onClick\}>/);
  assert.match(
    css,
    /\.stat-card-link::after\{content:"";position:absolute;inset:0;/,
    'toda la tarjeta se puede pulsar',
  );
  // Las cifras, tal cual: «3», no «03».
  assert.match(shared, /<strong>\{value\}<\/strong>/);
  assert.doesNotMatch(shared, /padStart\(2, '0'\)/);
});

test('«Cuenta del cliente» del nuevo ticket es el Combobox de la ficha, con el correo como pista', async () => {
  const form = await read('app/desk-parts/ticket-form.tsx');
  assert.match(form, /<Combobox\s+label="Cuenta del cliente"\s+name="requesterMemberId"/);
  assert.match(form, /clients\.map\(member => \(\{ value: member\.id, label: member\.name, hint: member\.email \}\)\)/);
  assert.doesNotMatch(form, /<select\s+name="requesterMemberId"/);
  assert.match(form, /writeNewTicketDraft\(scope, \{ \.\.\.readNewTicketDraft\(scope\), requesterMemberId: value \}\)/);
  assert.match(form, /Se limpiaron los campos de la empresa anterior\./);
});

test('cambiar de cliente conserva los campos de la empresa si la empresa no cambia, y avisa si los limpia', () => {
  const filled = { requestTypeId: 'tipo-1', fieldValues: { equipo: 'NB-0042' } };
  assert.deepEqual(companyFieldsAfterRequesterChange('empresa-a', 'empresa-a', filled), {
    clear: false,
    announce: false,
  });
  assert.deepEqual(companyFieldsAfterRequesterChange(null, undefined, filled), { clear: false, announce: false });
  assert.deepEqual(companyFieldsAfterRequesterChange('empresa-a', 'empresa-b', filled), {
    clear: true,
    announce: true,
  });
  assert.deepEqual(companyFieldsAfterRequesterChange('empresa-a', null, { fieldValues: { equipo: 'x' } }), {
    clear: true,
    announce: true,
  });
  // Nada escrito: se limpia igual, pero no hay nada que avisar.
  assert.deepEqual(companyFieldsAfterRequesterChange('empresa-a', 'empresa-b', {}), { clear: true, announce: false });
  assert.deepEqual(companyFieldsAfterRequesterChange(null, 'empresa-b', { requestTypeId: null, fieldValues: {} }), {
    clear: true,
    announce: false,
  });
});

test('dentro de un diálogo modal, la lista del Combobox se dibuja en el diálogo y no detrás de él', async () => {
  const combobox = await read('app/combobox.tsx');
  assert.match(combobox, /rootRef\.current\?\.closest\('dialog'\) \?\? document\.body/);
  assert.match(combobox, /<\/ul>,\s*layer,\s*\)/);
});
