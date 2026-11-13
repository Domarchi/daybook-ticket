import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { describeFulfillmentEvent, formatDay } from '../lib/fulfillment-display';
import { FULFILLMENT_LIST_FILTERS, isFulfillmentListFilter } from '../lib/fulfillment';
import { WORKSPACE_ROUTE_REGISTRY } from '../lib/workspace-route-registry';
import { createTicketSchema } from '../lib/server';
import { requestedCategoryValues } from '../lib/ticket-category';

test('follow-up history lines read like a parcel tracker', () => {
  assert.equal(formatDay('2026-11-20'), '20 nov 2026');
  assert.equal(formatDay('2026-02-30'), '');
  assert.equal(formatDay(null), '');
  assert.equal(
    describeFulfillmentEvent('fulfillment', JSON.stringify({ stage: 'requested', expectedOn: '2026-11-20' })),
    'Requerimiento en seguimiento · fecha comprometida 20 nov 2026',
  );
  assert.equal(
    describeFulfillmentEvent('fulfillment', JSON.stringify({ stage: 'requested', expectedOn: null })),
    'Requerimiento en seguimiento',
  );
  assert.equal(
    describeFulfillmentEvent('fulfillment', JSON.stringify({ stage: 'in_progress', reason: null })),
    'En gestión',
  );
  assert.equal(
    describeFulfillmentEvent('fulfillment', JSON.stringify({ stage: 'cancelled', reason: 'Ya no se necesita' })),
    'Cancelado · Ya no se necesita',
  );
  assert.equal(
    describeFulfillmentEvent(
      'fulfillment_delay',
      JSON.stringify({ reason: 'supplier', note: 'El proveedor despacha el lunes', expectedOn: '2026-11-25' }),
    ),
    'Retraso: Proveedor · nueva fecha 25 nov 2026 · El proveedor despacha el lunes',
  );
  assert.equal(
    describeFulfillmentEvent('fulfillment_date', JSON.stringify({ expectedOn: '2026-12-01' })),
    'Fecha comprometida: 1 dic 2026',
  );
  // Damaged or foreign values never break the history.
  assert.equal(describeFulfillmentEvent('fulfillment', 'not json'), 'Etapa actualizada');
  assert.equal(describeFulfillmentEvent('fulfillment', JSON.stringify({ stage: 'teleported' })), 'Etapa actualizada');
  assert.equal(describeFulfillmentEvent('fulfillment_delay', null), 'Retraso: Otro');
});

test('the list filters are a closed set', () => {
  assert.deepEqual([...FULFILLMENT_LIST_FILTERS], ['active', 'requested', 'in_progress', 'ready', 'overdue', 'closed']);
  assert.equal(isFulfillmentListFilter('overdue'), true);
  assert.equal(isFulfillmentListFilter('delivered'), false);
});

test('follow-up routes are reachable in a workspace; writes are staff-only and delivery is not done here', () => {
  const find = (path: string) => WORKSPACE_ROUTE_REGISTRY.find(item => item.pattern.test(path));
  const ticketRoute = find('tickets/12/fulfillment');
  assert.deepEqual(ticketRoute?.names, ['id']);
  for (const method of ['GET', 'POST', 'PATCH'])
    assert.equal(typeof (ticketRoute?.handlers as Record<string, unknown>)[method], 'function', method);
  assert.equal(typeof (find('fulfillments')?.handlers as Record<string, unknown>).GET, 'function');
  const route = readFileSync('app/api/tickets/[id]/fulfillment/route.ts', 'utf8');
  assert.equal(
    route.match(/requireStaff\(await requireAccess\(request\)\)/g)?.length,
    2,
    'POST and PATCH are staff-only',
  );
  const server = readFileSync('lib/fulfillment.ts', 'utf8').replace(/\s+/g, ' ');
  assert.match(server, /if \(to === 'delivered'\) throw new ApiError\(400/, 'delivery has its own action (F6-B4)');
  assert.match(server, /Para cambiar la fecha comprometida usa «Informar retraso»/, 'a date moves only with a reason');
  assert.match(server, /FOR UPDATE/, 'changes lock the follow-up row');
  assert.match(server, /checkVersion\(existing, input\.expectedVersion\)/, 'changes check the version');
});

test('a requirement asked for in the portal is classified by the person and followed from the start (F6-B3)', () => {
  assert.deepEqual(requestedCategoryValues('user_accounts'), [null, null, 'user_accounts', 'manual', null]);
  const base = {
    operationId: '0b6f3a3e-9d0c-4a51-8f2e-6d7c5b4a3f21',
    subject: 'Necesito acceso al sistema de remuneraciones',
    department: 'Soporte',
    body: 'Para revisar mis liquidaciones.',
  };
  for (const requirement of ['equipment', 'user_accounts', 'applications', 'folder_permissions', 'other'])
    assert.equal(createTicketSchema.safeParse({ ...base, requirement }).success, true, requirement);
  assert.equal(createTicketSchema.safeParse({ ...base, requirement: 'pizza' }).success, false);
  const route = readFileSync('app/api/tickets/route.ts', 'utf8').replace(/\s+/g, ' ');
  assert.match(route, /data\.requirement \? requestedCategoryValues\(data\.requirement\) : suggestedCategoryValues/);
  const insert = route.indexOf('INSERT INTO tickets'),
    start = route.indexOf('startRequestedFulfillment(tx, fresh, ticket.id, now)');
  assert.ok(insert > 0 && start > insert, 'the follow-up starts after the ticket exists, in the same transaction');
});

test('"Mis requerimientos" uses the same ticket access as the portal and is reachable in a workspace', () => {
  const server = readFileSync('lib/fulfillment.ts', 'utf8').replace(/\s+/g, ' ');
  assert.match(server, /const scope = ticketAccessSql\(access, 't', 2\)/);
  assert.match(server, /WHERE f\."ownerId" = \$1 AND \$\{scope\.sql\}/);
  const mine = WORKSPACE_ROUTE_REGISTRY.find(item => item.pattern.test('fulfillments/mine'));
  assert.equal(typeof (mine?.handlers as Record<string, unknown>).GET, 'function');
  assert.notEqual(
    mine,
    WORKSPACE_ROUTE_REGISTRY.find(item => item.pattern.test('fulfillments')),
  );
});
