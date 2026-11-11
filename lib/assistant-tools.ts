/**
 * The tools Bita can use. All of them are READ-ONLY: Bita never answers a customer, assigns, changes a state or
 * writes a note. Each executor receives the session's validated access and applies the desk's own visibility; no tool
 * takes a member or a role as a parameter, and every result passes through the allow-list in `assistant-privacy.ts`.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { AccessContext } from './access';
import { readDeskSummary, readSuggestions } from './assistant-data';
import {
  MAX_SEARCH_ROWS,
  SEARCH_PRIORITIES,
  SEARCH_VIEWS,
  validateSearch,
  validateTicketNumber,
} from './assistant-input';
import { ticketLine } from './assistant-privacy';
import { ApiError } from './server';
import { getTicketPage } from './ticket-search';

export type ToolContext = { access: AccessContext; now: number };
export type ToolResult = { content: string; isError: boolean };

/** Every character returned is paid again as input on the next turn. Row limits keep results small; this is the net. */
export const MAX_RESULT_CHARACTERS = 9000;

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'resumen_bandeja',
    description:
      'Estado de la bandeja ahora: totales, tickets vencidos, que vencen hoy, sin asignar, escalados y que esperan ' +
      'respuesta del equipo, y carga por técnico. Úsala para «cómo va la bandeja», «qué vence hoy», «cómo va Mario».',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'buscar_tickets',
    description:
      `Lista tickets (máximo ${MAX_SEARCH_ROWS}) por texto (número, asunto o conversación) y vista. ` +
      'Por omisión busca entre los activos. Devuelve una línea por ticket, sin la conversación.',
    input_schema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Palabras a buscar. Vacío lista la vista completa.' },
        vista: { type: 'string', enum: Object.keys(SEARCH_VIEWS) },
        prioridad: { type: 'string', enum: Object.keys(SEARCH_PRIORITIES) },
        limite: { type: 'integer', description: `Cuántos devolver, hasta ${MAX_SEARCH_ROWS}.` },
      },
    },
  },
  {
    name: 'sugerir_solucion',
    description:
      'Para un ticket por su número: sus datos, la conversación reciente, la categoría que propone el clasificador, ' +
      'los tickets solucionados más parecidos (con la respuesta y la nota del equipo) y los artículos de la base de ' +
      'conocimiento relacionados. Úsala para sugerir pasos de diagnóstico y solución, o para resumir un ticket.',
    input_schema: {
      type: 'object',
      properties: { numero: { type: 'integer', description: 'Número del ticket.' } },
      required: ['numero'],
    },
  },
];

const error = (message: string): ToolResult => ({ content: JSON.stringify({ error: message }), isError: true });

function serialize(value: unknown): string {
  const text = JSON.stringify(value);
  if (text.length <= MAX_RESULT_CHARACTERS) return text;
  return JSON.stringify({ aviso: 'Resultado recortado por tamaño.', datos: text.slice(0, MAX_RESULT_CHARACTERS) });
}

export async function runTool(name: string, input: unknown, context: ToolContext): Promise<ToolResult> {
  const { access, now } = context;
  if (name === 'resumen_bandeja') return { content: serialize(await readDeskSummary(access, now)), isError: false };
  if (name === 'buscar_tickets') {
    const search = validateSearch(input);
    if (!search.ok) return error(search.error);
    const page = await getTicketPage(access, {
      ...search.value,
      department: 'all',
      company: 'all',
      agent: 'all',
      cursor: null,
    });
    return {
      content: serialize({
        total: page.total,
        tickets: page.items.map(ticket =>
          ticketLine(ticket, { assigneeName: ticket.assignee || null, requesterName: ticket.requesterName }, now),
        ),
      }),
      isError: false,
    };
  }
  if (name === 'sugerir_solucion') {
    const id = validateTicketNumber(input);
    if (!id.ok) return error(id.error);
    try {
      return {
        content: serialize(await readSuggestions(access, id.value, { conversation: true }, now)),
        isError: false,
      };
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 404) return error(`No existe el ticket #${id.value}.`);
      throw failure;
    }
  }
  return error(`No conozco la herramienta «${name.slice(0, 40)}».`);
}
