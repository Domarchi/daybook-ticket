/**
 * Pure logic of Bita's screens: greeting, suggested questions, which parts of an answer become links, the lines of
 * the desk summary and the checks on what the server returns. Nothing here touches the network, so it is tested
 * without a browser.
 */
export const ASSISTANT_NAME = 'Bita';

/** "Joaquín Domarchi" → "Joaquín". A name stored in capitals ("MARIO") becomes "Mario": shouting a greeting is worse
 * than losing an accent. */
export function firstName(fullName: string | null | undefined): string {
  const first = (fullName ?? '').trim().split(/\s+/)[0] ?? '';
  if (!first || first.includes('@')) return '';
  const normal = first.length > 1 && first === first.toUpperCase() ? first.toLowerCase() : first;
  return normal.charAt(0).toUpperCase() + normal.slice(1);
}

export function greetingFor(hour: number): 'Buenos días' | 'Buenas tardes' | 'Buenas noches' {
  if (hour >= 5 && hour < 12) return 'Buenos días';
  if (hour >= 12 && hour < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

/** The hour in mainland Chile, the desk's hour, not the browser's. */
export function hourInChile(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('es-CL', {
    hour: 'numeric',
    hourCycle: 'h23',
    timeZone: 'America/Santiago',
  }).formatToParts(now);
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  return Number.isInteger(hour) ? hour % 24 : now.getHours();
}

export function introduction(name: string, hour: number): string {
  const greeting = greetingFor(hour);
  return `${name ? `${greeting}, ${name}` : greeting}. Soy ${ASSISTANT_NAME} y llevo la bitácora de la mesa de ayuda: te cuento cómo va la bandeja y el SLA, y te sugiero cómo resolver un ticket a partir de los ya solucionados. No respondo a clientes ni cambio tickets.`;
}

export const SUGGESTED_QUESTIONS = [
  '¿Qué vence hoy?',
  '¿Cómo va cada técnico?',
  '¿Qué tickets esperan respuesta?',
] as const;

export function askForSolution(ticketId: number): string {
  return `Sugiéreme cómo resolver el ticket #${ticketId}.`;
}

// --- Links -----------------------------------------------------------------------------------------------------------

export type Piece =
  | { kind: 'text'; text: string }
  | { kind: 'ticket'; text: string; id: number }
  | { kind: 'article'; text: string; id: number };

// "#123", "ticket 123", "ticket N° 123" and "artículo A12" become buttons. A bare number is left alone: "40 tickets"
// is not a ticket. Up to 9 digits, so a long figure is not turned into a link.
const LINK = /(?:\btickets?\s+(?:n(?:\.[°º]|[°º.])?\s*)?#?|#)(\d{1,9})\b|\bart[ií]culos?\s+A(\d{1,9})\b/gi;

export function splitWithLinks(text: string): Piece[] {
  const pieces: Piece[] = [];
  let from = 0;
  for (const match of text.matchAll(LINK)) {
    const start = match.index ?? 0;
    if (start > from) pieces.push({ kind: 'text', text: text.slice(from, start) });
    if (match[1]) pieces.push({ kind: 'ticket', text: match[0], id: Number(match[1]) });
    else pieces.push({ kind: 'article', text: match[0], id: Number(match[2]) });
    from = start + match[0].length;
  }
  if (from < text.length) pieces.push({ kind: 'text', text: text.slice(from) });
  return pieces;
}

// --- What the server returns ------------------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObject = (value: unknown): value is Obj => !!value && typeof value === 'object' && !Array.isArray(value);
const isInteger = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;

export type SummaryTicket = { numero: number; asunto: string; responsable: string | null; prioridad: string };
export type DeskSummaryView = {
  fecha: string;
  totales: {
    activos: number;
    sin_asignar: number;
    en_proceso: number;
    vencidos: number;
    vencen_hoy: number;
    escalados: number;
    esperan_respuesta: number;
  };
  vencidos: SummaryTicket[];
  vencen_hoy: SummaryTicket[];
  sin_asignar: SummaryTicket[];
  escalados: SummaryTicket[];
  esperan_respuesta: SummaryTicket[];
  por_tecnico: { nombre: string; activos: number; vencidos: number; vencen_hoy: number }[];
  parcial: boolean;
};
export type SummaryResponse = { summary: DeskSummaryView; remaining: number | null; limit: number };

const LISTS = ['vencidos', 'vencen_hoy', 'sin_asignar', 'escalados', 'esperan_respuesta'] as const;
const TOTALS = ['activos', 'sin_asignar', 'en_proceso', 'vencidos', 'vencen_hoy', 'escalados', 'esperan_respuesta'];

export function isSummaryResponse(value: unknown): value is SummaryResponse {
  if (!isObject(value) || !isObject(value.summary) || !isInteger(value.limit)) return false;
  if (value.remaining !== null && !isInteger(value.remaining)) return false;
  const summary = value.summary;
  if (!isObject(summary.totales) || !TOTALS.every(key => isInteger((summary.totales as Obj)[key]))) return false;
  if (!Array.isArray(summary.por_tecnico)) return false;
  return LISTS.every(
    key =>
      Array.isArray(summary[key]) &&
      (summary[key] as unknown[]).every(item => isObject(item) && isInteger(item.numero) && Number(item.numero) > 0),
  );
}

export type ChatResponse = { reply: string; remaining: number; limit: number };
export function isChatResponse(value: unknown): value is ChatResponse {
  return isObject(value) && typeof value.reply === 'string' && isInteger(value.remaining) && isInteger(value.limit);
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The short lines under the greeting. An empty desk is a fact, not an error. */
export function summaryLines(summary: DeskSummaryView): { text: string; tickets: number[] }[] {
  const totals = summary.totales;
  if (totals.activos === 0) return [{ text: 'La bandeja está al día: no hay tickets activos.', tickets: [] }];
  const ids = (list: SummaryTicket[]) => list.slice(0, 3).map(item => item.numero);
  const lines: { text: string; tickets: number[] }[] = [
    {
      text: `${plural(totals.activos, 'ticket activo', 'tickets activos')}${summary.parcial ? ' o más' : ''} · ${totals.sin_asignar} sin asignar · ${totals.en_proceso} en proceso`,
      tickets: [],
    },
  ];
  if (totals.vencidos)
    lines.push({ text: plural(totals.vencidos, 'vencido', 'vencidos'), tickets: ids(summary.vencidos) });
  if (totals.vencen_hoy)
    lines.push({ text: `${plural(totals.vencen_hoy, 'vence', 'vencen')} hoy`, tickets: ids(summary.vencen_hoy) });
  if (totals.escalados)
    lines.push({ text: plural(totals.escalados, 'escalado', 'escalados'), tickets: ids(summary.escalados) });
  if (totals.esperan_respuesta)
    lines.push({
      text: `${plural(totals.esperan_respuesta, 'espera', 'esperan')} respuesta del equipo`,
      tickets: ids(summary.esperan_respuesta),
    });
  return lines;
}

// --- Suggestions for one ticket (no model) ------------------------------------------------------------------------

export type SuggestionsView = {
  ticket: { numero: number; asunto: string };
  categoria: { etiqueta: string; confianza: string; palabras: string[] };
  palabras_buscadas: string[];
  similares: {
    numero: number;
    asunto: string;
    categoria: string;
    misma_categoria: boolean;
    respuesta_del_equipo: string;
    nota_interna: string;
  }[];
  articulos: { articulo: number; titulo: string; estado: string; extracto: string }[];
};

export function isSuggestionsResponse(value: unknown): value is { suggestions: SuggestionsView } {
  if (!isObject(value) || !isObject(value.suggestions)) return false;
  const s = value.suggestions;
  return (
    isObject(s.ticket) &&
    isInteger(s.ticket.numero) &&
    isObject(s.categoria) &&
    typeof s.categoria.etiqueta === 'string' &&
    Array.isArray(s.similares) &&
    s.similares.every(item => isObject(item) && isInteger(item.numero) && typeof item.asunto === 'string') &&
    Array.isArray(s.articulos) &&
    s.articulos.every(item => isObject(item) && isInteger(item.articulo) && typeof item.titulo === 'string')
  );
}

/** What the draft route answers: a draft for the composer, or a notice when Bita declined or wrote nothing. */
export type DraftResponse = { draft: string | null; notice?: string; cut?: boolean; remaining: number; limit: number };

export function isDraftResponse(value: unknown): value is DraftResponse {
  return (
    isObject(value) &&
    (typeof value.draft === 'string' || (value.draft === null && typeof value.notice === 'string')) &&
    isInteger(value.remaining) &&
    isInteger(value.limit)
  );
}

/** The draft goes below what the person already wrote, never over it. */
export function withDraft(current: string, draft: string): string {
  return current.trim() ? `${current.trimEnd()}\n\n${draft}` : draft;
}

/** Bita leaves `[completar: …]` where it lacked a fact; a reply must not reach the customer with one still in it. */
export const PENDING_PLACEHOLDER = /\[completar\b[^\]]*\]/i;

/** What the recap route answers: the recap, or a notice (short ticket, refusal, nothing written). */
export type RecapResponse = {
  recap: string | null;
  notice?: string;
  cut?: boolean;
  remaining: number | null;
  limit: number;
};

export function isRecapResponse(value: unknown): value is RecapResponse {
  return (
    isObject(value) &&
    (typeof value.recap === 'string' || (value.recap === null && typeof value.notice === 'string')) &&
    (value.remaining === null || isInteger(value.remaining)) &&
    isInteger(value.limit)
  );
}

/** The recap's lines: the ones that start with a known label get it apart, so the panel can bold it. */
export const RECAP_LABELS = ['Pide:', 'Hecho:', 'En qué quedó:', 'Falta:', 'Ojo:'] as const;
export function recapLines(text: string): { label: string; text: string }[] {
  return text
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean)
    .map(line => {
      const label = RECAP_LABELS.find(item => line.startsWith(item));
      return label ? { label, text: line.slice(label.length).trim() } : { label: '', text: line };
    });
}
