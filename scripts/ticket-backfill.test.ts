import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  BACKFILL_LIMIT,
  backfillColumns,
  backfillIds,
  backfillSuggestion,
  describeSuggestion,
} from '../lib/ticket-backfill-model';
import { suggestedCategoryValues } from '../lib/ticket-category';

test('an old ticket gets the same suggestion a new one would', () => {
  for (const source of [
    { id: 1, subject: 'La impresora no imprime', body: 'Se atasca el papel en la impresora del segundo piso' },
    { id: 2, subject: 'Necesito acceso', body: 'Por favor crear una cuenta de usuario para la persona nueva' },
    { id: 3, subject: 'Hola', body: null },
  ]) {
    const suggestion = backfillSuggestion(source);
    const [group, element, requirement, source_, confidence] = suggestedCategoryValues(source);
    assert.equal(source_, 'bot');
    assert.deepEqual(backfillColumns(suggestion), [group, element, requirement, confidence]);
    assert.equal(suggestion.ticketId, source.id);
  }
});

test('the suggestion reads like the ticket history', () => {
  const printer = backfillSuggestion({ id: 1, subject: 'La impresora no imprime', body: null });
  assert.equal(printer.fault?.group, 'equipment');
  assert.match(describeSuggestion(printer), /Impresora/);
  assert.equal(describeSuggestion({ fault: null, requirement: null }), 'Sin falla / Sin requerimiento');
});

test('little text is a low-confidence suggestion, so the reviewer sees it', () => {
  assert.equal(backfillSuggestion({ id: 9, subject: 'Hola', body: 'Ayuda' }).confidence, 'low');
});

test('the ids sent back are a bounded list of distinct positive integers', () => {
  assert.deepEqual(backfillIds([3, 1, 3]), [3, 1]);
  for (const bad of [[], null, 'x', [0], [-1], [1.5], ['1'], [Number.MAX_SAFE_INTEGER + 1]])
    assert.equal(backfillIds(bad), null);
  const full = Array.from({ length: BACKFILL_LIMIT }, (_, index) => index + 1);
  assert.equal(backfillIds(full)?.length, BACKFILL_LIMIT);
  assert.equal(backfillIds([...full, BACKFILL_LIMIT + 1]), null);
});

test('applying never overwrites a category and keeps the inbox order', async () => {
  const source = await readFile('lib/ticket-backfill.ts', 'utf8');
  // Selected and updated only while still unclassified, under the ticket-work lock and a live administrator.
  assert.match(source, /"categorySource" IS NULL`;/);
  assert.match(source, /WHERE id=\$1 AND "ownerId"=\$2 AND "categorySource" IS NULL/);
  assert.match(
    source,
    /acquireTicketWorkLock\(tx, access\.ownerId\)[\s\S]*requireAdmin\(await lockAccess\(tx, access\)\)/,
  );
  assert.doesNotMatch(source, /"updatedAt"=/);
  assert.match(source, /"categorySource"='bot'/);
});

test('the route is administrators only and listed for workspace URLs', async () => {
  const route = await readFile('app/api/tickets/classify/route.ts', 'utf8');
  assert.equal(route.match(/requireAdmin\(await requireAccess\(request\)\)/g)?.length, 2);
  const registry = await readFile('lib/workspace-route-registry.ts', 'utf8');
  assert.match(registry, /\^tickets\/classify\$/);
});
