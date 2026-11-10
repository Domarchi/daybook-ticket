import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { filterOptions, firstEnabled, normalizeSearch, resultsAnnouncement, stepActive, type ComboboxOption } from '../lib/combobox';
import { Combobox } from '../app/combobox';

const people: ComboboxOption[] = [
  { value: '', label: 'Sin asignar' },
  { value: 'a', label: 'María López', hint: 'maria@empresa.com' },
  { value: 'b', label: 'Mario Pino', hint: 'mario@empresa.com' },
  { value: 'c', label: 'Álvaro Marín', hint: 'alvaro@otra.org', disabled: true },
  { value: 'd', label: 'Joaquín Domarchi', hint: 'joaquin@empresa.com' },
];

test('search ignores accents, case and extra spaces', () => {
  assert.equal(normalizeSearch('  María   LÓPEZ '), 'maria lopez');
  assert.deepEqual(filterOptions(people, 'maria lopez').map(o => o.value), ['a']);
  assert.deepEqual(filterOptions(people, 'JOAQUIN').map(o => o.value), ['d']);
  assert.deepEqual(filterOptions(people, 'alvaro').map(o => o.value), ['c'], 'disabled options still show so the reason is visible');
});

test('every word must match, in the label or in the hint', () => {
  assert.deepEqual(filterOptions(people, 'mar empresa').map(o => o.value), ['a', 'b', 'd'], '"mar" is also inside Domarchi, which ranks after the names that start with it');
  assert.deepEqual(filterOptions(people, 'mario empresa').map(o => o.value), ['b']);
  assert.deepEqual(filterOptions(people, 'otra.org').map(o => o.value), ['c']);
  assert.deepEqual(filterOptions(people, 'zzz'), []);
  assert.equal(filterOptions(people, '   ').length, people.length);
});

test('matches at the start of the name come first, the rest keep their order', () => {
  const list: ComboboxOption[] = [{ value: '1', label: 'Hotel Marina' }, { value: '2', label: 'Marina Sur' }, { value: '3', label: 'Casa', hint: 'marina@x.test' }];
  assert.deepEqual(filterOptions(list, 'marina').map(o => o.value), ['2', '1', '3']);
});

test('arrows skip disabled options and wrap around', () => {
  assert.equal(stepActive(people, 2, 1), 4, 'skips the disabled Álvaro');
  assert.equal(stepActive(people, 4, 1), 0, 'wraps to the first');
  assert.equal(stepActive(people, 0, -1), 4, 'wraps to the last');
  assert.equal(stepActive(people, -1, 1), 0);
  assert.equal(stepActive(people, -1, -1), 4);
  assert.equal(stepActive([], 0, 1), -1);
  assert.equal(stepActive([{ value: 'x', label: 'X', disabled: true }], -1, 1), -1);
  assert.equal(firstEnabled([{ value: 'x', label: 'X', disabled: true }, { value: 'y', label: 'Y' }]), 1);
});

test('the result count is announced in Spanish', () => {
  assert.equal(resultsAnnouncement(0), 'Sin resultados');
  assert.equal(resultsAnnouncement(1), '1 resultado');
  assert.equal(resultsAnnouncement(5), '5 resultados');
});

const render = (props: Partial<Parameters<typeof Combobox>[0]> = {}) => renderToStaticMarkup(createElement(Combobox, { label: 'Responsable', options: people, value: 'b', onChange: () => undefined, ...props }));

test('closed, it is a labelled combobox showing the chosen name', () => {
  const html = render();
  assert.match(html, /<label for="[^"]+">Responsable<\/label>/);
  assert.match(html, /role="combobox"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-autocomplete="list"/);
  assert.match(html, /value="Mario Pino"/);
  assert.doesNotMatch(html, /role="listbox"/);
  assert.match(html, /aria-label="Abrir lista"/);
});

test('without a visible label it takes an aria-label; the description is linked; a name adds a hidden field', () => {
  const html = render({ label: undefined, ariaLabel: 'Filtrar por agente', description: 'Texto de ayuda', name: 'assigneeMemberId', compact: true });
  assert.doesNotMatch(html, /<label/);
  assert.match(html, /aria-label="Filtrar por agente"/);
  assert.match(html, /aria-describedby="([^"]+)"/);
  const id = /aria-describedby="([^"]+)"/.exec(html)![1];
  assert.match(html, new RegExp(`<small id="${id.replace(/[:]/g, '\\:')}"[^>]*>Texto de ayuda</small>`));
  assert.match(html, /<input type="hidden" name="assigneeMemberId" value="b"\/>/);
  assert.match(html, /combobox-field compact/);
});

test('a disabled combobox cannot be opened and a value outside the options shows empty', () => {
  assert.match(render({ disabled: true }), /<input[^>]*disabled=""/);
  assert.match(render({ value: 'gone' }), /value=""/);
  assert.match(render({ busy: true }), /aria-busy="true"/);
});
