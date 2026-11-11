import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_ASSISTANT_MODEL,
  DEFAULT_DAILY_LIMIT,
  MAX_DAILY_LIMIT,
  assistantAllowedFor,
  assistantAvailableFor,
  assistantDailyLimit,
  assistantEnabled,
  assistantModel,
} from '../lib/assistant-config';
import { MAX_MESSAGE_LENGTH, validateConversation, validateSearch, validateTicketNumber } from '../lib/assistant-input';
import { maskText, messageForModel, safeText, ticketDetail, ticketLine } from '../lib/assistant-privacy';
import { serviceDay, serviceDayEnd, summarizeDesk, type DeskRow } from '../lib/assistant-desk';
import { queryTokens, rankSimilar, classify } from '../lib/assistant-suggestions';
import type { Ticket } from '../lib/types';

const owner = { role: 'owner', organizationId: 'daybook', member: { status: 'active' } };

test('Bita is off unless the flag says yes, and only for owner/admin of the main space', () => {
  assert.equal(assistantEnabled({}), false);
  assert.equal(assistantEnabled({ ASSISTANT_ENABLED: 'prendido' }), false);
  assert.equal(assistantEnabled({ ASSISTANT_ENABLED: '0' }), false);
  for (const yes of ['1', 'true', 'ON', ' sí ']) assert.equal(assistantEnabled({ ASSISTANT_ENABLED: yes }), true);
  const on = { ASSISTANT_ENABLED: '1', ANTHROPIC_API_KEY: 'x' };
  assert.equal(assistantAllowedFor(owner, on), true);
  assert.equal(assistantAllowedFor({ ...owner, role: 'admin' }, on), true);
  assert.equal(assistantAllowedFor({ ...owner, role: 'agent' }, on), false);
  assert.equal(assistantAllowedFor({ ...owner, role: 'client' }, on), false);
  assert.equal(assistantAllowedFor({ ...owner, organizationId: 'piloto-1' }, on), false, 'never a pilot workspace');
  assert.equal(assistantAllowedFor({ ...owner, member: { status: 'revoked' } }, on), false);
  assert.equal(assistantAllowedFor(owner, {}), false);
  assert.equal(assistantAvailableFor(owner, { ASSISTANT_ENABLED: '1' }), false, 'no key, no button');
  assert.equal(assistantAvailableFor(owner, on), true);
});

test('model and daily limit have safe defaults and the limit cannot be typed away', () => {
  assert.equal(assistantModel({}), DEFAULT_ASSISTANT_MODEL);
  assert.equal(DEFAULT_ASSISTANT_MODEL, 'claude-haiku-5-5');
  assert.equal(assistantModel({ ASSISTANT_MODEL: ' claude-sonnet-5-5 ' }), 'claude-sonnet-5-5');
  assert.equal(assistantDailyLimit({}), DEFAULT_DAILY_LIMIT);
  assert.equal(assistantDailyLimit({ ASSISTANT_DAILY_LIMIT: 'veinte' }), DEFAULT_DAILY_LIMIT);
  assert.equal(assistantDailyLimit({ ASSISTANT_DAILY_LIMIT: '0' }), 1);
  assert.equal(assistantDailyLimit({ ASSISTANT_DAILY_LIMIT: '1000000' }), MAX_DAILY_LIMIT);
  assert.equal(assistantDailyLimit({ ASSISTANT_DAILY_LIMIT: '-5' }), DEFAULT_DAILY_LIMIT);
});

test('masking removes emails, phones, RUT, passwords and link tokens from customer text', () => {
  const text =
    'Hola, soy ana.perez@cliente.cl, mi fono es +56 9 8765 4321 o 9 1234-5678. RUT 12.345.678-5. ' +
    'Mi contraseña: Primavera2026! y la clave es hola1234. Link https://portal.ejemplo.cl/reset?token=abc123 ' +
    'Error 0x80070005 en Outlook.';
  const masked = maskText(text);
  for (const leak of ['ana.perez', '8765', '1234-5678', '12.345.678', 'Primavera2026', 'hola1234', 'token=abc123'])
    assert.ok(!masked.includes(leak), `leaked: ${leak} in ${masked}`);
  assert.match(masked, /\[correo omitido\]/);
  assert.match(masked, /\[teléfono omitido\]/);
  assert.match(masked, /contraseña: \[clave omitida\]/);
  assert.match(masked, /https:\/\/portal\.ejemplo\.cl\/reset\?\[omitido\]/);
  assert.match(masked, /0x80070005 en Outlook/, 'technical codes stay');
  assert.equal(safeText('  a\n\n b  '), 'a b');
  assert.equal(safeText('x'.repeat(50), 10), `${'x'.repeat(10)}…`);
  assert.equal(safeText(42), '');
});

const ticket: Ticket = {
  id: 7,
  subject: 'No imprime la impresora HP del segundo piso',
  requesterName: 'Andrea Molina',
  requesterEmail: 'andrea@cliente.cl',
  requesterMemberId: 'm-client',
  customerCompanyId: 'c1',
  version: 1,
  department: 'Soporte',
  assignee: 'Mario',
  assigneeMemberId: 'm-mario',
  status: 'open',
  priority: 'high',
  createdAt: '2026-11-10T12:00:00.000Z',
  updatedAt: '2026-11-11T12:00:00.000Z',
  dueAt: '2026-11-11T10:00:00.000Z',
};

test('what leaves for the model is an allow-list: no requester, no email, client is just "cliente"', () => {
  const now = Date.parse('2026-11-11T15:00:00.000Z');
  const line = ticketLine(ticket, { assigneeName: 'Mario Rojas' }, now);
  const detail = ticketDetail(ticket, { assigneeName: 'Mario Rojas', companyName: 'Cliente SpA' }, now);
  const serialized = JSON.stringify({ line, detail });
  assert.ok(!serialized.includes('Andrea'));
  assert.ok(!serialized.includes('andrea@'));
  assert.ok(!serialized.includes('m-client'));
  assert.deepEqual(Object.keys(line).sort(), [
    'actualizado',
    'asunto',
    'estado',
    'numero',
    'prioridad',
    'responsable',
    'vence',
    'vencido',
  ]);
  assert.equal(line.vencido, true);
  assert.equal(line.estado, 'En proceso');
  const fromClient = messageForModel({
    kind: 'request',
    author: 'Andrea Molina',
    authorRole: 'client',
    body: 'Escríbeme a andrea@cliente.cl',
    createdAt: ticket.createdAt,
    attachments: [{}, {}],
  });
  assert.deepEqual(fromClient, {
    tipo: 'cliente',
    autor: 'cliente',
    fecha: ticket.createdAt,
    texto: 'Escríbeme a [correo omitido]',
    adjuntos: 2,
  });
  const note = messageForModel({ kind: 'note', author: 'Mario', authorRole: 'admin', body: 'ok', createdAt: '' });
  assert.equal(note.tipo, 'nota interna');
  assert.equal(note.autor, 'Mario');
});

test('the conversation and every tool input are validated before anything is spent', () => {
  assert.equal(validateConversation({}).ok, false);
  assert.equal(validateConversation({ messages: [] }).ok, false);
  assert.equal(validateConversation({ messages: [{ role: 'system', content: 'x' }] }).ok, false);
  assert.equal(validateConversation({ messages: [{ role: 'user', content: '  ' }] }).ok, false);
  assert.equal(validateConversation({ messages: [{ role: 'assistant', content: 'hola' }] }).ok, false);
  assert.equal(
    validateConversation({ messages: [{ role: 'user', content: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) }] }).ok,
    false,
  );
  const long = validateConversation({
    messages: [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b'.repeat(5000) },
      { role: 'user', content: 'c' },
    ],
  });
  assert.ok(long.ok && long.value[1].content.length === MAX_MESSAGE_LENGTH, 'long answers are cut, not refused');
  assert.deepEqual(validateTicketNumber({ numero: 12 }), { ok: true, value: 12 });
  for (const bad of [{ numero: '12' }, { numero: 0 }, { numero: 1.5 }, null, { numero: -3 }])
    assert.equal(validateTicketNumber(bad).ok, false);
  assert.deepEqual(validateSearch(undefined), {
    ok: true,
    value: { q: '', queue: 'open', priority: 'all', limit: 10 },
  });
  const search = validateSearch({ texto: ' vpn ', vista: 'vencidos', prioridad: 'urgente', limite: 50 });
  assert.deepEqual(search, { ok: true, value: { q: 'vpn', queue: 'overdue', priority: 'urgent', limit: 10 } });
  assert.equal(validateSearch({ vista: 'borrar' }).ok, false);
  assert.equal(validateSearch({ prioridad: 'máxima' }).ok, false);
  assert.equal(validateSearch({ limite: 0 }).ok, false);
});

test('the Santiago day and its end follow the local clock, daylight saving included', () => {
  // 2026-11-11 is summer time (UTC-3): 02:30 UTC is still the 10th in Santiago.
  assert.equal(serviceDay(Date.parse('2026-11-11T02:30:00Z')), '2026-11-10');
  assert.equal(new Date(serviceDayEnd(Date.parse('2026-11-11T15:00:00Z'))).toISOString(), '2026-11-12T03:00:00.000Z');
  // Winter (UTC-4).
  assert.equal(new Date(serviceDayEnd(Date.parse('2026-07-01T15:00:00Z'))).toISOString(), '2026-07-02T04:00:00.000Z');
  // 2026-04-04: clocks go back from UTC-3 to UTC-4 at midnight going into the 5th.
  const end = serviceDayEnd(Date.parse('2026-04-04T15:00:00Z'));
  assert.equal(serviceDay(end), '2026-04-05');
  assert.equal(serviceDay(end - 1), '2026-04-04');
});

const row = (overrides: Partial<DeskRow> & { id: number }): DeskRow => ({
  subject: `Ticket ${overrides.id}`,
  status: 'open',
  assigneeMemberId: null,
  assigneeName: null,
  priority: 'normal',
  dueAt: '2026-11-20T12:00:00.000Z',
  updatedAt: '2026-11-11T10:00:00.000Z',
  createdAt: '2026-11-10T10:00:00.000Z',
  lastPublicKind: 'reply',
  escalationReason: null,
  ...overrides,
});

test('the desk summary counts what is overdue, due today, unassigned, escalated and waiting, per technician', () => {
  const now = Date.parse('2026-11-11T15:00:00Z'); // 12:00 in Santiago
  const summary = summarizeDesk(
    [
      row({ id: 1, dueAt: '2026-11-11T10:00:00Z', assigneeMemberId: 'mario', assigneeName: 'Mario' }),
      row({ id: 2, dueAt: '2026-11-11T20:00:00Z', assigneeMemberId: 'mario', assigneeName: 'Mario' }),
      row({ id: 3, dueAt: '2026-11-12T02:59:00Z' }), // 23:59 Santiago: today
      row({ id: 4, dueAt: '2026-11-12T03:30:00Z', lastPublicKind: 'request' }), // tomorrow
      row({ id: 5, escalationReason: 'unanswered', assigneeMemberId: 'jo', assigneeName: 'Joaquín' }),
      row({ id: 6, status: 'resolved', dueAt: '2026-11-01T00:00:00Z' }),
    ],
    now,
  );
  assert.deepEqual(summary.totales, {
    activos: 5,
    sin_asignar: 2,
    en_proceso: 3,
    vencidos: 1,
    vencen_hoy: 2,
    escalados: 1,
    esperan_respuesta: 1,
  });
  assert.deepEqual(
    summary.vencen_hoy.map(item => item.numero),
    [2, 3],
  );
  assert.equal(summary.escalados[0].escalado_por, 'sin respuesta');
  assert.deepEqual(summary.por_tecnico, [
    { nombre: 'Mario', activos: 2, vencidos: 1, vencen_hoy: 1 },
    { nombre: 'Joaquín', activos: 1, vencidos: 0, vencen_hoy: 0 },
  ]);
  assert.equal(summary.fecha, '2026-11-11');
  assert.equal(summarizeDesk([], now).totales.activos, 0);
});

test('similar tickets: meaningful words, subject first, and the classifier reorders by category', () => {
  assert.deepEqual(queryTokens('Hola, necesito ayuda: la impresora no imprime', 'Gracias, saludos. Error 123'), [
    'impresora',
    'imprime',
    'error',
  ]);
  assert.ok(queryTokens('x '.repeat(100) + 'a'.repeat(5)).length <= 12);
  const target = classify('No imprime la impresora', 'sale atasco de papel').raw;
  const ranked = rankSimilar(target, [
    { id: 1, subject: 'Outlook no abre', firstBody: 'error al abrir', score: 2, updatedAt: '2026-11-01T00:00:00Z' },
    { id: 2, subject: 'Impresora con atasco', firstBody: 'no imprime', score: 2, updatedAt: '2026-10-01T00:00:00Z' },
  ]);
  assert.equal(ranked[0].id, 2, 'same category wins a tie on words');
  assert.equal(ranked[0].sameCategory, true);
  assert.equal(ranked[1].sameCategory, false);
});

test('the requester name is masked wherever the customer typed it, with or without accents', async () => {
  const { maskPeople } = await import('../lib/assistant-privacy');
  const text = 'Hola, soy Valentina Ortúzar. Saludos, VALENTINA ortuzar. Valentín no es ella.';
  assert.equal(
    maskPeople(text, ['Valentina Ortúzar']),
    'Hola, soy [nombre omitido] [nombre omitido]. Saludos, [nombre omitido] [nombre omitido]. Valentín no es ella.',
  );
  assert.equal(maskPeople('sin nombres', [null, '', 'Al']), 'sin nombres', 'parts under three letters are ignored');
  const tokens = queryTokens(
    safeText('La impresora no imprime', 200, ['Valentina Ortúzar']),
    safeText('Soy Valentina. Mi contraseña: Otoño2026xyz', 1500, ['Valentina Ortúzar']),
  );
  assert.deepEqual(tokens, ['impresora', 'imprime', 'contrasena'], 'no name and no password become search words');
});
