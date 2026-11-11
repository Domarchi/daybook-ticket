import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adoptConfirmed,
  applyOverlay,
  beginChange,
  canUndo,
  changeMessage,
  emptyOverlay,
  isSaving,
  previousValues,
  settleChange,
} from '../lib/ticket-overlay';
import type { Ticket } from '../lib/types';

const ticket = (over: Partial<Ticket> = {}) =>
  ({
    id: 7,
    subject: 'Reparto',
    requesterName: 'Cliente',
    requesterEmail: 'c@x.test',
    requesterMemberId: null,
    customerCompanyId: null,
    version: 3,
    department: 'Soporte',
    assignee: '',
    assigneeMemberId: null,
    status: 'open',
    priority: 'normal',
    createdAt: '2026-11-10T08:00:00Z',
    updatedAt: '2026-11-10T09:00:00Z',
    dueAt: '2026-11-11T08:00:00Z',
    ...over,
  }) as Ticket;
const server = (over: Partial<Ticket>) => ({ ...ticket(), ownerId: 'secret-owner', ...over }) as Ticket;

test('a change shows immediately and the loaded ticket is left alone', () => {
  const base = ticket();
  const overlay = beginChange(undefined, { priority: 'urgent' }, 1);
  assert.equal(applyOverlay(base, overlay).priority, 'urgent');
  assert.equal(base.priority, 'normal');
  assert.equal(isSaving(overlay, 'priority'), true);
  assert.equal(isSaving(overlay, 'status'), false);
});

test('a confirmed change keeps showing until the refresh catches up, with the server version', () => {
  const base = ticket();
  let overlay = beginChange(undefined, { status: 'pending' }, 1);
  overlay = settleChange(
    overlay,
    ['status'],
    1,
    server({ status: 'pending', version: 4, dueAt: '2026-11-12T08:00:00Z' }),
  );
  const shown = applyOverlay(base, overlay);
  assert.equal(shown.status, 'pending');
  assert.equal(shown.version, 4, 'the next change that needs expectedVersion must send the new one');
  assert.equal(shown.dueAt, '2026-11-12T08:00:00Z');
  assert.equal(isSaving(overlay, 'status'), false);
  assert.equal('ownerId' in shown, false, 'only known fields are adopted from the server row');
  // The regular refresh delivers version 4: the overlay stops mattering.
  const refreshed = ticket({ status: 'pending', version: 4 });
  assert.deepEqual(applyOverlay(refreshed, overlay), refreshed);
});

test('a failed change goes back to what was loaded', () => {
  const base = ticket();
  const overlay = settleChange(beginChange(undefined, { priority: 'urgent' }, 1), ['priority'], 1);
  assert.equal(applyOverlay(base, overlay).priority, 'normal');
  assert.equal(isSaving(overlay, 'priority'), false);
});

test('an older answer cannot undo or confirm a newer change to the same field', () => {
  const base = ticket();
  let overlay = beginChange(undefined, { priority: 'high' }, 1);
  overlay = beginChange(overlay, { priority: 'urgent' }, 2);
  // The first request fails late: the second change must stay on screen and keep waiting.
  overlay = settleChange(overlay, ['priority'], 1);
  assert.equal(applyOverlay(base, overlay).priority, 'urgent');
  assert.equal(isSaving(overlay, 'priority'), true);
  overlay = settleChange(overlay, ['priority'], 2, server({ priority: 'urgent', version: 5 }));
  assert.equal(isSaving(overlay, 'priority'), false);
  assert.equal(applyOverlay(base, overlay).priority, 'urgent');
});

test('answers arriving out of order keep the newest confirmed version', () => {
  const base = ticket();
  let overlay = beginChange(beginChange(undefined, { status: 'pending' }, 1), { priority: 'high' }, 2);
  overlay = settleChange(overlay, ['priority'], 2, server({ status: 'pending', priority: 'high', version: 5 }));
  overlay = settleChange(overlay, ['status'], 1, server({ status: 'pending', priority: 'normal', version: 4 }));
  const shown = applyOverlay(base, overlay);
  assert.equal(shown.version, 5);
  assert.equal(shown.priority, 'high');
  assert.equal(shown.status, 'pending');
});

test('changes to different fields do not disturb each other', () => {
  const base = ticket();
  let overlay = beginChange(beginChange(undefined, { status: 'pending' }, 1), { department: 'Ventas' }, 2);
  overlay = settleChange(overlay, ['status'], 1);
  const shown = applyOverlay(base, overlay);
  assert.equal(shown.status, 'open');
  assert.equal(shown.department, 'Ventas');
  assert.equal(isSaving(overlay, 'department'), true);
});

test('a confirmed ticket for another ticket is ignored', () => {
  const overlay = adoptConfirmed(undefined, server({ id: 99, status: 'resolved', version: 10 }));
  assert.equal(applyOverlay(ticket(), overlay).status, 'open');
});

test('assignment answers raise the version without touching pending fields', () => {
  const base = ticket();
  let overlay = beginChange(undefined, { priority: 'high' }, 1);
  overlay = adoptConfirmed(overlay, server({ assignee: 'Mario', assigneeMemberId: 'm1', version: 4 }));
  const shown = applyOverlay(base, overlay);
  assert.equal(shown.assigneeMemberId, 'm1');
  assert.equal(shown.version, 4);
  assert.equal(shown.priority, 'high');
});

test('undo remembers the replaced values and is withheld around resolving', () => {
  const base = ticket({ status: 'open', priority: 'normal' });
  const patch = { priority: 'urgent' as const, department: 'Ventas' };
  assert.deepEqual(previousValues(base, patch), { priority: 'normal', department: 'Soporte' });
  assert.equal(canUndo({ priority: 'urgent' }, { priority: 'normal' }), true);
  assert.equal(canUndo({ status: 'resolved' }, { status: 'open' }), false);
  assert.equal(
    canUndo({ status: 'open' }, { status: 'resolved' }),
    false,
    'reopening a resolved ticket is not undone back into resolved',
  );
  assert.equal(canUndo({ status: 'pending' }, { status: 'open' }), true);
  assert.equal(canUndo({ status: 'closed' }, { status: 'resolved' }), false, 'closing is not undone');
  assert.equal(canUndo({ status: 'open' }, { status: 'closed' }), false, 'reopening a closed ticket is not undone');
});

test('toast messages name the field', () => {
  assert.equal(changeMessage({ status: 'resolved' }), 'Ticket solucionado');
  assert.equal(changeMessage({ status: 'closed' }), 'Ticket cerrado');
  assert.equal(changeMessage({ priority: 'high' }), 'Prioridad actualizada');
  assert.equal(changeMessage({ department: 'Ventas' }), 'Departamento actualizado');
  assert.equal(changeMessage({ requesterMemberId: null }), 'Cuenta del cliente actualizada');
  assert.equal(changeMessage({ priority: 'low', department: 'x' }), 'Ticket actualizado');
  assert.equal(emptyOverlay.confirmed, null);
});
