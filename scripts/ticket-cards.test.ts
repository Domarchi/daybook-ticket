import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TicketCards } from '../app/desk-parts/ticket-cards';
import type { Ticket } from '../lib/types';

const now = Date.parse('2026-11-10T12:00:00Z');
const base = {
  requesterName: 'Cliente de prueba',
  requesterEmail: 'c@example.test',
  department: 'Soporte técnico',
  createdAt: '2026-11-10T08:00:00Z',
  version: 1,
};
const late = {
  ...base,
  id: 7,
  subject: 'Reparto y SLA',
  status: 'open',
  priority: 'high',
  assignee: 'Mario Pino',
  assigneeMemberId: 'member-mario',
  updatedAt: '2026-11-10T11:00:00Z',
  dueAt: '2026-11-10T10:00:00Z',
} as unknown as Ticket;
const done = {
  ...base,
  id: 12,
  subject: 'Factura duplicada',
  status: 'resolved',
  priority: 'low',
  assignee: '',
  updatedAt: '2026-11-10T11:59:50Z',
  dueAt: '2026-11-11T10:00:00Z',
} as unknown as Ticket;
const render = (selected: number[] = []) =>
  renderToStaticMarkup(
    createElement(TicketCards, {
      tickets: [late, done],
      selected,
      setSelected: () => undefined,
      now,
      onOpen: () => undefined,
    }),
  );

test('each ticket is a card with a real link, readable status and a labelled checkbox', () => {
  const html = render();
  assert.equal((html.match(/<li /g) || []).length, 2);
  assert.match(html, /<a [^>]*class="ticket-card-main"[^>]*href="\?ticket=7"/);
  assert.match(html, /href="\?ticket=12"/);
  assert.match(html, /aria-label="Seleccionar ticket 7"/);
  assert.match(html, /Seleccionar tickets de esta vista/);
  assert.match(html, /En proceso/);
  assert.match(html, /Solucionado/);
  assert.doesNotMatch(html, /Abierto|Resuelto|En espera/);
  assert.match(html, /#0007/);
});

test('overdue work is marked, assignment is explicit and a fresh update reads naturally', () => {
  const html = render();
  assert.match(html, /<span class="late-text">Vencido<\/span>/);
  assert.match(html, /Sin asignar/);
  assert.match(html, /Mario/);
  assert.match(html, /Actualizado hace 1 h/);
  assert.match(html, /Actualizado ahora/);
  assert.doesNotMatch(html, /hace Ahora/);
  const resolved = html.slice(html.indexOf('href="?ticket=12"'));
  assert.doesNotMatch(resolved, /restantes|Vencido/, 'a resolved ticket shows no deadline');
});

test('selected cards are marked and checked', () => {
  const html = render([12]);
  assert.match(html, /ticket-card is-selected/);
  assert.equal((html.match(/is-selected/g) || []).length, 1);
  assert.match(html, /<input type="checkbox" aria-label="Seleccionar ticket 12" checked=""/);
});
