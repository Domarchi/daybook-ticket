// Decisión de producto: el cliente ya no elige la prioridad al crear un ticket
// desde el portal; la pone el equipo. El servidor ignora la que llegue desde una
// cuenta de cliente y guarda la de por omisión, y el SLA se calcula con la
// prioridad que de verdad se guarda, no con la que venía en la petición.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createTicketSchema } from '../lib/server';
import { calculateTicketDueAt, createLegacyServicePolicySnapshot } from '../lib/sla-policy';
import { creationPriority, DEFAULT_TICKET_PRIORITY } from '../lib/ticket-priority';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('una cuenta de cliente siempre crea con la prioridad por omisión, pida lo que pida', () => {
  assert.equal(DEFAULT_TICKET_PRIORITY, 'normal');
  for (const requested of ['low', 'normal', 'high', 'urgent', undefined] as const)
    assert.equal(creationPriority('client', requested), 'normal');
});

test('el equipo sigue fijando la prioridad al crear', () => {
  for (const role of ['owner', 'admin', 'agent'] as const) {
    assert.equal(creationPriority(role, 'urgent'), 'urgent');
    assert.equal(creationPriority(role, 'low'), 'low');
    assert.equal(creationPriority(role, undefined), 'normal');
  }
});

test('la prioridad por omisión del esquema es la misma que usa el portal', () => {
  const parsed = createTicketSchema.parse({
    operationId: '00000000-0000-4000-8000-000000000000',
    subject: 'Sin prioridad',
    department: 'Soporte',
    body: 'Texto',
  });
  assert.equal(parsed.priority, DEFAULT_TICKET_PRIORITY);
});

test('el plazo SLA de un cliente que pide «urgente» es el de prioridad normal', () => {
  const policy = createLegacyServicePolicySnapshot({ urgent: 4, high: 8, normal: 24, low: 72 });
  const start = '2026-11-17T12:00:00.000Z';
  const due = calculateTicketDueAt(start, creationPriority('client', 'urgent'), policy);
  assert.equal(due, calculateTicketDueAt(start, 'normal', policy));
  assert.notEqual(due, calculateTicketDueAt(start, 'urgent', policy));
});

test('la ruta de creación guarda y calcula el SLA con la prioridad final, no con la pedida', async () => {
  const route = await read('app/api/tickets/route.ts');
  assert.match(route, /const priority = creationPriority\(fresh\.role, data\.priority\);/);
  assert.match(route, /const dueAt = resolutionDeadline\(now, priority, policy\);/);
  assert.doesNotMatch(route, /data\.priority,/, 'la prioridad pedida no llega al INSERT');
  assert.doesNotMatch(route, /resolutionDeadline\(now, data\.priority/);
});

test('el portal ya no pide prioridad ni explica «Urgente», y Departamento sigue', async () => {
  const portal = await read('app/client-portal.tsx');
  const form = portal.slice(portal.indexOf('<form className="client-new-ticket"'), portal.indexOf('</form>'));
  assert.ok(form.length > 0);
  assert.doesNotMatch(form, /Prioridad/);
  assert.doesNotMatch(portal, /Elige «Urgente»/);
  assert.doesNotMatch(portal, /draft\.priority|priority: saved\.priority/);
  assert.match(form, />\s*Departamento\s*<select/);
  // El detalle del ticket sigue mostrando la prioridad que puso el equipo.
  assert.match(portal, /<dt>Prioridad<\/dt>\s*<dd>\{PRIORITY\[current\.priority\]\}<\/dd>/);
});
