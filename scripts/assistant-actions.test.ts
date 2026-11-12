import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProposal, matchMember, validateProposal, type ActionProposal } from '../lib/assistant-actions';
import { isActionOffer, isChatResponse } from '../lib/assistant-ui';
import { confirmationRequest, versionAfter } from '../app/bita-action';

const ticket = {
  id: 7,
  subject: 'Impresora no imprime, mi clave es Otoño2026',
  version: 4,
  status: 'open' as const,
  assigneeMemberId: null,
  assignee: '',
  faultGroup: null,
  faultElement: null,
  requirement: null,
  categorySource: null,
};
const team = [
  { id: 'm-mario', name: 'Mario Pino' },
  { id: 'm-joaquin', name: 'Joaquín Domarchi' },
  { id: 'm-maria', name: 'María Paz Rojas' },
];
const ok = (value: ReturnType<typeof buildProposal>) => {
  assert.equal(value.ok, true, value.ok ? '' : value.error);
  return (value as { ok: true; value: ActionProposal }).value;
};

test('the tool input is checked before anything is read', () => {
  assert.equal(validateProposal({ numero: 7, accion: 'asignar', responsable: 'Mario' }).ok, true);
  assert.equal(validateProposal({ numero: 7, accion: 'asignar' }).ok, false);
  assert.equal(validateProposal({ numero: 7, accion: 'estado', estado: 'borrado' }).ok, false);
  assert.equal(validateProposal({ numero: 7, accion: 'categoria' }).ok, false);
  assert.equal(validateProposal({ numero: 7, accion: 'nota', nota: 'x'.repeat(1501) }).ok, false);
  assert.equal(validateProposal({ numero: 7, accion: 'prioridad' }).ok, false, 'priority is not proposed');
  assert.equal(validateProposal({ numero: 0, accion: 'nota', nota: 'x' }).ok, false);
});

test('assigning finds the person by name and asks back when several match', () => {
  assert.deepEqual(matchMember('mario', team), { kind: 'one', member: team[0] });
  assert.deepEqual(matchMember('joaquin domarchi', team), { kind: 'one', member: team[1] });
  assert.equal(matchMember('mari', team).kind, 'many');
  assert.equal(matchMember('Pedro', team).kind, 'none');
  const card = ok(buildProposal({ numero: 7, accion: 'asignar', responsable: 'Mario' }, ticket, team, 'id-1'));
  assert.equal(card.summary, 'Asignar #7 a Mario Pino');
  assert.deepEqual(card.change, { type: 'assign', memberId: 'm-mario', memberName: 'Mario Pino', fromName: null });
  assert.equal(card.version, 4);
  assert.ok(!card.subject.includes('Otoño2026'), 'the card shows the subject masked');
  const already = buildProposal(
    { numero: 7, accion: 'asignar', responsable: 'Mario' },
    { ...ticket, assigneeMemberId: 'm-mario', assignee: 'Mario Pino' },
    team,
  );
  assert.equal(already.ok, false);
});

test('state changes follow the desk rules: close only after solving, reopen only what is finished', () => {
  assert.equal(buildProposal({ numero: 7, accion: 'estado', estado: 'cerrado' }, ticket, []).ok, false);
  assert.equal(buildProposal({ numero: 7, accion: 'estado', estado: 'reabrir' }, ticket, []).ok, false);
  assert.equal(
    buildProposal({ numero: 7, accion: 'estado', estado: 'en_proceso' }, ticket, []).ok,
    false,
    'same state',
  );
  const solve = ok(buildProposal({ numero: 7, accion: 'estado', estado: 'solucionado' }, ticket, []));
  assert.deepEqual(solve.change, { type: 'status', to: 'resolved', toLabel: 'Solucionado', fromLabel: 'Sin asignar' });
  const reopen = ok(
    buildProposal({ numero: 7, accion: 'estado', estado: 'reabrir' }, { ...ticket, status: 'closed' }, []),
  );
  assert.equal(reopen.summary, 'Reabrir #7 a «Sin asignar»');
});

test('a category must be in the agreed lists, with the element inside its group', () => {
  const card = ok(
    buildProposal(
      { numero: 7, accion: 'categoria', falla_grupo: 'equipment', falla_elemento: 'printer', requerimiento: null },
      ticket,
      [],
    ),
  );
  assert.equal(card.summary, 'Clasificar #7 como «Equipos y periféricos · Impresora / Sin requerimiento»');
  assert.equal(
    buildProposal({ numero: 7, accion: 'categoria', falla_grupo: 'access', falla_elemento: 'printer' }, ticket, []).ok,
    false,
  );
  assert.equal(buildProposal({ numero: 7, accion: 'categoria', falla_grupo: 'hardware' }, ticket, []).ok, false);
});

test('a note is masked before it is shown, and is always internal', () => {
  const card = ok(buildProposal({ numero: 7, accion: 'nota', nota: 'Llamar al +56 9 8765 4321 mañana' }, ticket, []));
  assert.equal(card.change.type, 'note');
  assert.ok(card.change.type === 'note' && !card.change.body.includes('8765'));
});

test('confirming sends exactly what the ticket page would, with the version seen', () => {
  const assign = ok(buildProposal({ numero: 7, accion: 'asignar', responsable: 'Mario' }, ticket, team, 'id-1'));
  const request = confirmationRequest(assign, 'op-1');
  assert.equal(request.path, '/api/tickets/7');
  assert.equal(request.init.method, 'PATCH');
  assert.deepEqual(JSON.parse(String(request.init.body)), { assigneeMemberId: 'm-mario', expectedVersion: 4 });
  assert.deepEqual(JSON.parse(String(confirmationRequest(assign, 'op-1', 5).init.body)).expectedVersion, 5);
  const note = ok(buildProposal({ numero: 7, accion: 'nota', nota: 'Revisar driver' }, ticket, []));
  const noteRequest = confirmationRequest(note, 'op-2');
  assert.equal(noteRequest.path, '/api/tickets/7/messages');
  assert.deepEqual(JSON.parse(String(noteRequest.init.body)), {
    operationId: 'op-2',
    kind: 'note',
    body: 'Revisar driver',
    bodyFormat: 'plain',
  });
  assert.equal(versionAfter({ ticket: { version: 5 } }), 5);
  assert.equal(versionAfter({ message: {} }), null);
});

test('the chat only accepts well-formed proposals', () => {
  const card = ok(buildProposal({ numero: 7, accion: 'asignar', responsable: 'Mario' }, ticket, team, 'id-1'));
  assert.equal(isActionOffer(card), true);
  assert.equal(isActionOffer({ ...card, change: { type: 'delete' } }), false);
  assert.equal(isActionOffer({ ...card, change: { type: 'note', body: '' } }), false);
  assert.equal(isChatResponse({ reply: 'listo', remaining: 3, limit: 20, actions: [card] }), true);
});
