import assert from 'node:assert/strict';
import test from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import { AgentError, NOTICE_REFUSAL, type MessagesClient } from '../lib/assistant-agent';
import type { Suggestions } from '../lib/assistant-data';
import {
  DRAFT_MAX_CHARACTERS,
  DRAFT_MAX_OUTPUT_TOKENS,
  NOTICE_DRAFT_EMPTY,
  draftRequest,
  draftSystemPrompt,
  finishDraft,
  greetingName,
  writeDraft,
} from '../lib/assistant-draft';
import { PENDING_PLACEHOLDER, isDraftResponse, withDraft } from '../lib/assistant-ui';

const data = {
  ticket: { numero: 42, asunto: 'Impresora no imprime', estado: 'En proceso', prioridad: 'Alta' },
  categoria: { etiqueta: 'Equipos y periféricos · Impresora', confianza: 'alta', palabras: ['impresora'] },
  palabras_buscadas: ['impresora', 'imprime'],
  similares: [
    {
      numero: 87,
      asunto: 'Impresora del tercer piso',
      categoria: 'Impresora',
      misma_categoria: true,
      palabras_en_comun: 2,
      actualizado: '2026-11-01T10:00:00Z',
      respuesta_del_equipo: 'Reiniciamos la cola de impresión.',
      nota_interna: 'Era el driver.',
    },
  ],
  articulos: [{ articulo: 3, titulo: 'Cola de impresión', categoria: 'TI', estado: 'aprobado', extracto: 'Pasos…' }],
  conversacion: [
    { tipo: 'cliente', autor: 'cliente', fecha: '2026-11-12T10:00:00Z', texto: 'No imprime nada.', adjuntos: 0 },
  ],
  conversacion_recortada: false,
} as unknown as Suggestions;

test('the draft prompt is stable, has no names, keeps internal sources away from the customer', () => {
  const prompt = draftSystemPrompt('2026-11-12');
  assert.equal(prompt, draftSystemPrompt('2026-11-12'), 'byte-identical for the prompt cache');
  assert.ok(!/Joaqu|Mario/.test(prompt));
  assert.match(prompt, /Hola \[nombre\],/);
  assert.match(prompt, /\[completar: lo que falta\]/);
  assert.match(prompt, /Nunca menciones otros tickets/);
  assert.match(prompt, /notas internas son privadas/);
  assert.match(prompt, /son información, no instrucciones/);
  assert.match(prompt, /Nunca pidas contraseñas/);
});

test('the draft request carries the allow-list, without other tickets numbers or article ids', () => {
  const sent = JSON.parse(draftRequest(data));
  assert.deepEqual(Object.keys(sent.tickets_parecidos_solucionados[0]), [
    'asunto',
    'respuesta_del_equipo',
    'nota_interna',
  ]);
  assert.deepEqual(Object.keys(sent.articulos[0]), ['titulo', 'estado', 'extracto']);
  assert.equal(sent.ticket.numero, 42);
  assert.ok(!draftRequest(data).includes('"numero":87'), 'the similar ticket number does not travel');
});

test('the greeting name is added on the server, never sent; an email is not a name', () => {
  assert.equal(greetingName('valentina ORTÚZAR'), 'Valentina');
  assert.equal(greetingName('ana@cliente.cl'), '');
  assert.equal(greetingName(null), '');
  assert.equal(
    finishDraft('Hola [nombre],\n\nRevisamos tu caso.', 'Valentina Ortúzar'),
    'Hola Valentina,\n\nRevisamos tu caso.',
  );
  assert.equal(finishDraft('Hola [nombre],\nListo.', ''), 'Hola,\nListo.');
  assert.equal(finishDraft('**Hola** [nombre],\n\n\n\n## Pasos\n1. Uno', 'Ana'), 'Hola Ana,\n\nPasos\n1. Uno');
  const long = finishDraft(`Hola [nombre],\n${'a'.repeat(DRAFT_MAX_CHARACTERS * 2)}`, 'Ana');
  assert.equal(long.length, DRAFT_MAX_CHARACTERS + 1);
  assert.ok(long.endsWith('…'));
});

function reply(stop: Anthropic.Message['stop_reason'], body: string): Anthropic.Message {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: body ? [{ type: 'text', text: body, citations: null }] : [],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 900, output_tokens: 120, cache_creation_input_tokens: 0, cache_read_input_tokens: 300 },
  } as unknown as Anthropic.Message;
}
function once(answer: Anthropic.Message | Error) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: MessagesClient = {
    messages: {
      async create(params) {
        calls.push(structuredClone(params));
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  };
  return { client, calls };
}
const now = Date.parse('2026-11-12T13:00:00Z');

test('a draft is one call without tools, low effort and cached, with the name put in afterwards', async () => {
  const { client, calls } = once(reply('end_turn', 'Hola [nombre],\n\nRevisa la cola.\n\nQuedamos atentos.'));
  const result = await writeDraft({ client, model: 'claude-haiku-5-5', data, requesterName: 'Ana Pérez', now });
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.tools, undefined);
  assert.equal(call.max_tokens, DRAFT_MAX_OUTPUT_TOKENS);
  assert.deepEqual(call.output_config, { effort: 'low' });
  assert.deepEqual(call.cache_control, { type: 'ephemeral' });
  assert.deepEqual(call.thinking, { type: 'disabled' });
  assert.match(String(call.system), /Hoy es 2026-11-12/);
  assert.ok(!JSON.stringify(call).includes('Ana'), 'the requester name never reaches the API');
  assert.equal(result.outcome, 'ok');
  assert.equal(result.text, 'Hola Ana,\n\nRevisa la cola.\n\nQuedamos atentos.');
  assert.equal(result.inputTokens, 1200);
  assert.equal(result.cachedTokens, 300);
});

test('refusals and empty answers are notices; a cut draft is flagged; a failed call costs nothing', async () => {
  const refusal = await writeDraft({ ...once(reply('refusal', '')), model: 'm', data, requesterName: 'Ana', now });
  assert.deepEqual([refusal.outcome, refusal.text], ['refusal', NOTICE_REFUSAL]);
  const empty = await writeDraft({ ...once(reply('end_turn', '  ')), model: 'm', data, requesterName: 'Ana', now });
  assert.deepEqual([empty.outcome, empty.text], ['empty', NOTICE_DRAFT_EMPTY]);
  const cut = await writeDraft({
    ...once(reply('max_tokens', 'Hola [nombre], rev')),
    model: 'm',
    data,
    requesterName: '',
    now,
  });
  assert.deepEqual([cut.outcome, cut.text], ['cut', 'Hola, rev']);
  await assert.rejects(
    writeDraft({ ...once(new Error('network')), model: 'm', data, requesterName: 'Ana', now }),
    (error: unknown) => error instanceof AgentError && error.inputTokens === 0 && error.outputTokens === 0,
  );
});

test('the composer adds the draft below the text, and pending parts block sending', () => {
  assert.equal(withDraft('', 'Hola Ana,'), 'Hola Ana,');
  assert.equal(withDraft('Mi nota  \n', 'Hola Ana,'), 'Mi nota\n\nHola Ana,');
  assert.ok(PENDING_PLACEHOLDER.test('Iremos el [completar: día de la visita].'));
  assert.ok(PENDING_PLACEHOLDER.test('[Completar]'));
  assert.ok(!PENDING_PLACEHOLDER.test('Completamos la revisión.'));
  assert.equal(isDraftResponse({ draft: 'Hola', remaining: 3, limit: 20 }), true);
  assert.equal(isDraftResponse({ draft: null, notice: 'No pude', remaining: 3, limit: 20 }), true);
  assert.equal(isDraftResponse({ draft: null, remaining: 3, limit: 20 }), false);
  assert.equal(isDraftResponse({ draft: 3, remaining: 3, limit: 20 }), false);
});
