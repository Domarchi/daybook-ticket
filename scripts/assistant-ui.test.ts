import assert from 'node:assert/strict';
import test from 'node:test';
import {
  askForSolution,
  firstName,
  greetingFor,
  hourInChile,
  introduction,
  isChatResponse,
  isSuggestionsResponse,
  isSummaryResponse,
  splitWithLinks,
  summaryLines,
  type DeskSummaryView,
} from '../lib/assistant-ui';

test('greeting by first name and by the hour in Chile', () => {
  assert.equal(firstName('Joaquín Domarchi'), 'Joaquín');
  assert.equal(firstName('MARIO ROJAS'), 'Mario');
  assert.equal(firstName('mario@daybook.cl'), '', 'an email is not a name');
  assert.equal(firstName(''), '');
  assert.equal(greetingFor(8), 'Buenos días');
  assert.equal(greetingFor(15), 'Buenas tardes');
  assert.equal(greetingFor(23), 'Buenas noches');
  assert.equal(hourInChile(new Date('2026-11-11T12:30:00Z')), 9);
  assert.match(introduction('Mario', 9), /^Buenos días, Mario\. Soy Bita/);
  assert.match(introduction('', 9), /No respondo a clientes ni cambio tickets\./);
  assert.equal(askForSolution(42), 'Sugiéreme cómo resolver el ticket #42.');
});

test('ticket numbers and articles become links; plain numbers do not', () => {
  const pieces = splitWithLinks('Mira #12 y el ticket 87, ticket N° 5 y el artículo A3. Hay 40 tickets.');
  assert.deepEqual(
    pieces.filter(piece => piece.kind !== 'text').map(piece => [piece.kind, 'id' in piece ? piece.id : null]),
    [
      ['ticket', 12],
      ['ticket', 87],
      ['ticket', 5],
      ['article', 3],
    ],
  );
  assert.equal(
    pieces.map(piece => piece.text).join(''),
    'Mira #12 y el ticket 87, ticket N° 5 y el artículo A3. Hay 40 tickets.',
  );
  assert.deepEqual(splitWithLinks('sin enlaces'), [{ kind: 'text', text: 'sin enlaces' }]);
});

const summary: DeskSummaryView = {
  fecha: '2026-11-11',
  totales: {
    activos: 5,
    sin_asignar: 2,
    en_proceso: 3,
    vencidos: 1,
    vencen_hoy: 2,
    escalados: 0,
    esperan_respuesta: 1,
  },
  vencidos: [{ numero: 1, asunto: 'a', responsable: null, prioridad: 'alta' }],
  vencen_hoy: [
    { numero: 2, asunto: 'b', responsable: null, prioridad: 'normal' },
    { numero: 3, asunto: 'c', responsable: null, prioridad: 'normal' },
  ],
  sin_asignar: [],
  escalados: [],
  esperan_respuesta: [{ numero: 4, asunto: 'd', responsable: null, prioridad: 'baja' }],
  por_tecnico: [],
  parcial: false,
};

test('summary lines say the numbers in plain Spanish with up to three tickets each', () => {
  assert.deepEqual(summaryLines(summary), [
    { text: '5 tickets activos · 2 sin asignar · 3 en proceso', tickets: [] },
    { text: '1 vencido', tickets: [1] },
    { text: '2 vencen hoy', tickets: [2, 3] },
    { text: '1 espera respuesta del equipo', tickets: [4] },
  ]);
  const empty = { ...summary, totales: { ...summary.totales, activos: 0 } };
  assert.deepEqual(summaryLines(empty), [{ text: 'La bandeja está al día: no hay tickets activos.', tickets: [] }]);
});

test('the screen only accepts well-formed answers from the server', () => {
  assert.equal(isSummaryResponse({ summary, remaining: 3, limit: 20 }), true);
  assert.equal(isSummaryResponse({ summary, remaining: null, limit: 20 }), true);
  assert.equal(
    isSummaryResponse({ summary: { ...summary, vencidos: [{ numero: 'x' }] }, remaining: 1, limit: 2 }),
    false,
  );
  assert.equal(isChatResponse({ reply: 'hola', remaining: 3, limit: 20 }), true);
  assert.equal(isChatResponse({ reply: 3, remaining: 3, limit: 20 }), false);
  assert.equal(
    isSuggestionsResponse({
      suggestions: {
        ticket: { numero: 1, asunto: 'x' },
        categoria: { etiqueta: 'Otros', confianza: 'baja', palabras: [] },
        palabras_buscadas: [],
        similares: [{ numero: 2, asunto: 'y' }],
        articulos: [{ articulo: 3, titulo: 'z' }],
      },
    }),
    true,
  );
  assert.equal(isSuggestionsResponse({ suggestions: { ticket: {} } }), false);
});
