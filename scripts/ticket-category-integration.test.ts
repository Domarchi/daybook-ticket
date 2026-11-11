import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATEGORY_FILTERS, storedCategory, validateCategoryCorrection } from '../lib/ticket-category-model';
import { CATEGORY_INSERT_COLUMNS, suggestedCategoryValues } from '../lib/ticket-category';
import { parseTicketSearch, SearchQueryError } from '../lib/ticket-search-query';
import { normalizeTeamFilters } from '../hooks/use-team-filters';
import { savedViewFiltersSchema } from '../lib/work-organization-model';
import { patchTicketSchema } from '../lib/server';
import { TicketCategoryPanel } from '../app/desk-parts/ticket-category';
import type { Ticket } from '../lib/types';

test('a correction must use the agreed lists, with each element inside its own group', () => {
  assert.deepEqual(
    validateCategoryCorrection({ faultGroup: 'equipment', faultElement: 'printer', requirement: null }),
    { faultGroup: 'equipment', faultElement: 'printer', requirement: null },
  );
  assert.ok(validateCategoryCorrection({ faultGroup: 'access', faultElement: null, requirement: 'user_accounts' }));
  assert.ok(validateCategoryCorrection({ faultGroup: null, faultElement: null, requirement: 'equipment' }));
  assert.ok(validateCategoryCorrection({ faultGroup: null, faultElement: null, requirement: null }));
  for (const bad of [
    { faultGroup: 'equipment', faultElement: 'wifi', requirement: null },
    { faultGroup: null, faultElement: 'printer', requirement: null },
    { faultGroup: 'hardware', faultElement: null, requirement: null },
    { faultGroup: 'access', faultElement: null, requirement: 'everything' },
    { faultGroup: 'access', faultElement: 'monitor', requirement: null },
  ])
    assert.equal(validateCategoryCorrection(bad), null, JSON.stringify(bad));
});

test('the API accepts a category correction only in its exact shape', () => {
  const ok = patchTicketSchema.safeParse({
    category: { faultGroup: 'access', faultElement: null, requirement: null },
    expectedVersion: 3,
  });
  assert.equal(ok.success, true);
  assert.equal(patchTicketSchema.safeParse({ category: { faultGroup: 'access' } }).success, false);
  assert.equal(
    patchTicketSchema.safeParse({
      category: { faultGroup: 'access', faultElement: null, requirement: null, categorySource: 'bot' },
    }).success,
    false,
    'the source is set by the server, never by the request',
  );
});

test('stored columns read back as a category; never classified reads as null', () => {
  assert.equal(storedCategory({ faultGroup: null, requirement: null, categorySource: null }), null);
  assert.deepEqual(storedCategory({ faultGroup: 'equipment', faultElement: 'printer', categorySource: 'bot' }), {
    fault: { group: 'equipment', element: 'printer' },
    requirement: null,
  });
  // A value no longer in the list is shown as missing instead of breaking the screen.
  assert.deepEqual(storedCategory({ faultGroup: 'legacy', requirement: 'nope', categorySource: 'manual' }), {
    fault: null,
    requirement: null,
  });
});

test('the suggestion is stored in the same order as its columns', () => {
  assert.equal(
    CATEGORY_INSERT_COLUMNS,
    '"faultGroup","faultElement","requirement","categorySource","categoryConfidence"',
  );
  assert.deepEqual(suggestedCategoryValues({ subject: 'La impresora no imprime', body: 'Sin tóner' }), [
    'equipment',
    'printer',
    null,
    'bot',
    'high',
  ]);
  assert.deepEqual(suggestedCategoryValues({ subject: 'Necesito acceso a la carpeta compartida de RRHH' }), [
    null,
    null,
    'folder_permissions',
    'bot',
    'high',
  ]);
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mjs)$/.test(name) ? [path] : [];
  });
}
test('every place that creates tickets also stores the suggestion', () => {
  const creators = ['app', 'lib']
    .flatMap(sourceFiles)
    .filter(path => /INSERT INTO tickets\s*\(/.test(readFileSync(path, 'utf8')));
  assert.ok(creators.length >= 2, creators.join(', '));
  for (const path of creators) assert.match(readFileSync(path, 'utf8'), /CATEGORY_INSERT_COLUMNS/, path);
});

test('the inbox can filter by category; saved filters without one still load', () => {
  const params = (category?: string) => new URLSearchParams(category === undefined ? {} : { category });
  assert.equal(parseTicketSearch(params()).category, 'all');
  for (const value of CATEGORY_FILTERS) assert.equal(parseTicketSearch(params(value)).category, value);
  assert.throws(() => parseTicketSearch(params('printer')), SearchQueryError);
  assert.equal(normalizeTeamFilters({ queue: 'all' }).category, 'all');
  assert.equal(normalizeTeamFilters({ category: 'access' }).category, 'access');
  assert.equal(normalizeTeamFilters({ category: 'whatever' }).category, 'all');
  assert.equal(savedViewFiltersSchema.parse({}).category, 'all');
});

const ticket = (fields: Partial<Ticket>) => ({ id: 1, version: 2, status: 'open', ...fields }) as unknown as Ticket;
const panel = (fields: Partial<Ticket>) =>
  renderToStaticMarkup(
    createElement(TicketCategoryPanel, { ticket: ticket(fields), disabled: false, onSave: () => {} }),
  );

test('the panel says where the classification came from', () => {
  const suggested = panel({
    faultGroup: 'equipment',
    faultElement: 'printer',
    categorySource: 'bot',
    categoryConfidence: 'high',
  });
  assert.match(suggested, /Sugerida automáticamente a partir de la descripción/);
  assert.match(suggested, /Confirmar clasificación/);
  assert.match(suggested, /<option value="equipment:printer" selected="">Impresora<\/option>/);
  assert.match(panel({ faultGroup: 'other', categorySource: 'bot', categoryConfidence: 'low' }), /poca certeza/);
  const reviewed = panel({ requirement: 'user_accounts', categorySource: 'manual' });
  assert.match(reviewed, /Revisada por el equipo/);
  assert.doesNotMatch(reviewed, /Confirmar clasificación/);
  assert.match(reviewed, /<option value="" selected="">Sin falla<\/option>/);
  assert.match(panel({}), /Ticket anterior a la clasificación automática/);
  assert.match(panel({}), /Sin clasificar/);
});
