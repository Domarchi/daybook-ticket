import assert from 'node:assert/strict';
import test from 'node:test';
import { assetTagProblem, normalizeAssetTag } from '../lib/asset-tag';
import {
  DELAY_REASONS,
  FULFILLMENT_STAGES,
  STAGE_LABELS,
  TRACK_STAGES,
  delayProblem,
  deliveryNeedsAsset,
  deliveryProblem,
  expectedDateProblem,
  isCalendarDate,
  isFinalStage,
  isOverdue,
  receiptProblem,
  stageChangeProblem,
  stageOptions,
  ticketStatusAfter,
  todayIn,
  trackingSteps,
  type FulfillmentStage,
} from '../lib/fulfillment-model';

test('the agreed names of stages and delay reasons', () => {
  assert.deepEqual(
    FULFILLMENT_STAGES.map(stage => STAGE_LABELS[stage]),
    ['Solicitado', 'En gestión', 'Listo para entregar', 'Entregado', 'Cancelado'],
  );
  assert.deepEqual(
    DELAY_REASONS.map(reason => reason.label),
    ['Proveedor', 'Sin stock', 'Aprobación pendiente', 'Logística', 'Otro'],
  );
  assert.deepEqual([...TRACK_STAGES], ['requested', 'in_progress', 'ready', 'delivered']);
});

test('every stage change, checked against the rules', () => {
  // Expected outcome for each pair, with a reason given: true = allowed.
  const allowed: Record<FulfillmentStage, FulfillmentStage[]> = {
    requested: ['in_progress', 'ready', 'delivered', 'cancelled'],
    in_progress: ['ready', 'delivered', 'cancelled'],
    ready: ['in_progress', 'delivered', 'cancelled'],
    delivered: [],
    cancelled: [],
  };
  for (const from of FULFILLMENT_STAGES)
    for (const to of FULFILLMENT_STAGES) {
      const problem = stageChangeProblem(from, to, 'un motivo');
      assert.equal(problem === null, allowed[from].includes(to), `${from} → ${to}: ${problem}`);
    }
  for (const from of FULFILLMENT_STAGES) assert.deepEqual(stageOptions(from), allowed[from], `options from ${from}`);
});

test('cancelling and stepping back need a reason; moving forward does not', () => {
  assert.equal(stageChangeProblem('requested', 'in_progress'), null);
  assert.equal(stageChangeProblem('in_progress', 'delivered'), null);
  assert.match(stageChangeProblem('in_progress', 'cancelled') ?? '', /por qué se cancela/);
  assert.match(stageChangeProblem('in_progress', 'cancelled', '   ') ?? '', /por qué se cancela/);
  assert.match(stageChangeProblem('ready', 'in_progress') ?? '', /vuelve a «En gestión»/);
  assert.equal(stageChangeProblem('ready', 'in_progress', 'El equipo llegó dañado'), null);
  assert.match(stageChangeProblem('ready', 'cancelled', 'x'.repeat(501)) ?? '', /hasta 500/);
  assert.match(stageChangeProblem('in_progress', 'requested', 'motivo') ?? '', /no puede volver/);
  assert.match(stageChangeProblem('delivered', 'in_progress', 'motivo') ?? '', /entregado ya no cambia/);
  assert.match(stageChangeProblem('cancelled', 'requested', 'motivo') ?? '', /cancelado ya no cambia/);
  assert.match(stageChangeProblem('ready', 'ready') ?? '', /ya está en «Listo para entregar»/);
});

test('only delivering solves the ticket', () => {
  for (const stage of FULFILLMENT_STAGES)
    assert.equal(ticketStatusAfter(stage), stage === 'delivered' ? 'resolved' : null);
  assert.deepEqual(FULFILLMENT_STAGES.filter(isFinalStage), ['delivered', 'cancelled']);
});

test('calendar dates and "today" in the workspace time zone', () => {
  assert.equal(isCalendarDate('2026-11-12'), true);
  assert.equal(isCalendarDate('2026-02-29'), false);
  assert.equal(isCalendarDate('2028-02-29'), true);
  assert.equal(isCalendarDate('2026-13-01'), false);
  assert.equal(isCalendarDate('12-11-2026'), false);
  assert.equal(isCalendarDate(20261112), false);
  // 02:30 UTC on the 13th is still the 12th in Santiago (UTC−3).
  assert.equal(todayIn('America/Santiago', new Date('2026-11-13T02:30:00Z')), '2026-11-12');
  assert.equal(todayIn('UTC', new Date('2026-11-13T02:30:00Z')), '2026-11-13');
});

test('the committed date is optional, real and not in the past', () => {
  const today = '2026-11-12';
  assert.equal(expectedDateProblem(null, today), null);
  assert.equal(expectedDateProblem('', today), null);
  assert.equal(expectedDateProblem('2026-11-12', today), null);
  assert.match(expectedDateProblem('2026-11-11', today) ?? '', /pasado/);
  assert.match(expectedDateProblem('2026-11-31', today) ?? '', /no es válida/);
});

test('"Atrasado" is derived: open, with a date, and that day is over', () => {
  const today = '2026-11-12';
  assert.equal(isOverdue({ stage: 'in_progress', expectedOn: '2026-11-11' }, today), true);
  assert.equal(isOverdue({ stage: 'in_progress', expectedOn: '2026-11-12' }, today), false, 'the due day is not late');
  assert.equal(isOverdue({ stage: 'requested', expectedOn: null }, today), false, 'no date, never late');
  assert.equal(isOverdue({ stage: 'delivered', expectedOn: '2026-01-01' }, today), false);
  assert.equal(isOverdue({ stage: 'cancelled', expectedOn: '2026-01-01' }, today), false);
});

test('reporting a delay needs a listed reason, a note for "Otro" and a new date', () => {
  const today = '2026-11-12';
  const ok = { reason: 'supplier', newExpectedOn: '2026-11-20' };
  assert.equal(delayProblem('in_progress', ok, today), null);
  assert.equal(delayProblem('ready', { ...ok, reason: 'logistics', note: 'Courier sin cupo' }, today), null);
  assert.match(delayProblem('in_progress', { ...ok, reason: 'weather' }, today) ?? '', /Elige el motivo/);
  assert.match(delayProblem('in_progress', { ...ok, reason: 'other' }, today) ?? '', /Explica el motivo/);
  assert.equal(delayProblem('in_progress', { ...ok, reason: 'other', note: 'Feriado regional' }, today), null);
  assert.match(delayProblem('in_progress', { ...ok, newExpectedOn: '' }, today) ?? '', /nueva fecha/);
  assert.match(delayProblem('in_progress', { ...ok, newExpectedOn: '2026-11-01' }, today) ?? '', /pasado/);
  assert.match(delayProblem('in_progress', { ...ok, note: 'x'.repeat(501) }, today) ?? '', /hasta 500/);
  assert.match(delayProblem('delivered', ok, today) ?? '', /abierto/);
});

test('delivering equipment requires its inventory ID; other requirements do not', () => {
  assert.equal(deliveryNeedsAsset('equipment'), true);
  for (const other of ['user_accounts', 'applications', 'folder_permissions', 'other', null])
    assert.equal(deliveryNeedsAsset(other), false);
  assert.equal(deliveryProblem('ready', 'equipment', 'NB-0042'), null);
  assert.equal(deliveryProblem('ready', 'applications', null), null);
  assert.match(deliveryProblem('ready', 'equipment', '') ?? '', /ID del equipo entregado/);
  assert.match(deliveryProblem('ready', 'equipment', null) ?? '', /ID del equipo entregado/);
  assert.match(deliveryProblem('ready', 'equipment', 'Ñandú-1') ?? '', /solo admite/);
  assert.match(deliveryProblem('delivered', 'equipment', 'NB-0042') ?? '', /ya no cambia/);
});

test('confirming receipt is optional, once, after delivery', () => {
  assert.equal(receiptProblem({ stage: 'delivered', receivedAt: null }), null);
  assert.match(receiptProblem({ stage: 'delivered', receivedAt: '2026-11-12T15:00:00Z' }) ?? '', /ya fue confirmada/);
  assert.match(receiptProblem({ stage: 'ready', receivedAt: null }) ?? '', /entregado/);
});

test('the tracking line marks done, current and pending steps', () => {
  const states = (stage: FulfillmentStage, from?: FulfillmentStage) =>
    trackingSteps(stage, from).map(step => `${step.stage}:${step.state}`);
  assert.deepEqual(states('requested'), [
    'requested:current',
    'in_progress:pending',
    'ready:pending',
    'delivered:pending',
  ]);
  assert.deepEqual(states('ready'), ['requested:done', 'in_progress:done', 'ready:current', 'delivered:pending']);
  assert.deepEqual(states('delivered'), ['requested:done', 'in_progress:done', 'ready:done', 'delivered:done']);
  assert.deepEqual(states('cancelled', 'in_progress'), ['requested:done', 'in_progress:done', 'cancelled:current']);
  assert.deepEqual(states('cancelled'), ['requested:done', 'cancelled:current'], 'unknown history: from the request');
});

test('inventory IDs are normalized before they are compared', () => {
  assert.equal(normalizeAssetTag('  nb-0042 '), 'NB-0042');
  assert.equal(normalizeAssetTag('pc   ventas  3'), 'PC VENTAS 3');
  assert.equal(assetTagProblem('nb-0042'), null);
  assert.equal(assetTagProblem('SN.2026/07_A'), null);
  assert.match(assetTagProblem('   ') ?? '', /Escribe el ID/);
  assert.match(assetTagProblem(42) ?? '', /Escribe el ID/);
  assert.match(assetTagProblem('-0042') ?? '', /solo admite/);
  assert.match(assetTagProblem('equipo#1') ?? '', /solo admite/);
  assert.match(assetTagProblem('A'.repeat(65)) ?? '', /hasta 64/);
});
