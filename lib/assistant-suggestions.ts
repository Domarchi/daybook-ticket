/**
 * "Sugerir solución" (feature 2), rules part: which category the classifier proposes for a ticket and which solved
 * tickets and knowledge articles look like it. No model and no cost: the ticket page shows this as it is, and the
 * chat hands the same result to the model, which only writes the steps and cites these sources.
 *
 * Pure: the database reads live in `assistant-data.ts`. Similarity is deliberately simple and explainable: shared
 * words (the subject counts double) plus a bonus when the classifier puts both tickets in the same category.
 */
import { classifyTicketText, type Classification } from './ticket-classifier';
import { faultLabel, requirementLabel } from './ticket-category-model';

export const MAX_QUERY_TOKENS = 12;
export const MAX_SIMILAR = 5;
export const MAX_ARTICLES = 3;
export const MAX_CANDIDATES = 40;
/** Text read from the first message to find words. Long emails add quoted history, not signal. */
export const MAX_QUERY_BODY = 1500;

// Words that appear in almost every help-desk message and say nothing about the problem.
const STOPWORDS = new Set(
  (
    'para como con del las los una unos unas que por desde este esta esto estos estas tengo tiene tienen hay ' +
    'hola buenos buenas dias tardes noches favor gracias saludos atentamente estimado estimada estimados ' +
    'ayuda ayudar problema problemas necesito necesitamos podrian podrias puede pueden poder quisiera ' +
    'ticket solicitud consulta urgente hoy ayer mañana manana ahora tambien pero mas muy cuando donde ' +
    'equipo usuario usuaria nuestro nuestra mismo misma algo nada todo todos soy estoy tus sus les nos ' +
    'ese esa eso the and ' +
    // What masking leaves behind is not a search word.
    'omitido omitida clave correo telefono numero nombre'
  ).split(' '),
);

const plain = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Distinct meaningful words, subject first. Lower case without accents, 3–40 letters or digits. */
export function queryTokens(subject: string, body = ''): string[] {
  const words = (text: string) => plain(text).match(/[\p{L}\p{N}]{3,40}/gu) ?? [];
  const tokens: string[] = [];
  for (const word of [...words(subject), ...words(body.slice(0, MAX_QUERY_BODY))]) {
    if (STOPWORDS.has(word) || /^\d+$/.test(word) || tokens.includes(word)) continue;
    tokens.push(word);
    if (tokens.length >= MAX_QUERY_TOKENS) break;
  }
  return tokens;
}

export function categoryLabel(classification: Pick<Classification, 'fault' | 'requirement'>): string {
  const parts: string[] = [];
  if (classification.fault) parts.push(`Falla: ${faultLabel(classification.fault)}`);
  if (classification.requirement) parts.push(`Requerimiento: ${requirementLabel(classification.requirement)}`);
  return parts.join(' · ') || 'Sin categoría';
}

export function classify(subject: string, body: string) {
  const result = classifyTicketText({ subject, body });
  return {
    etiqueta: categoryLabel(result),
    confianza: result.confidence === 'high' ? 'alta' : 'baja',
    palabras: result.matched.slice(0, 6),
    raw: result,
  };
}

export type Candidate = {
  id: number;
  subject: string;
  requesterName?: string | null;
  firstBody: string;
  score: number;
  updatedAt: string;
};

function sameCategoryBonus(target: Classification, other: Classification): number {
  let bonus = 0;
  if (target.fault && other.fault && target.fault.group === other.fault.group && target.fault.group !== 'other') {
    bonus += 2;
    if (target.fault.element && target.fault.element === other.fault.element) bonus += 2;
  }
  if (target.requirement && target.requirement === other.requirement && target.requirement !== 'other') bonus += 2;
  return bonus;
}

/** The best candidates: word score plus category bonus, then the most recent. Only candidates with a word in
 * common reach this function, so the bonus reorders but never invents a match. */
export function rankSimilar(target: Classification, candidates: Candidate[], limit = MAX_SIMILAR) {
  return candidates
    .map(candidate => {
      const category = classifyTicketText({ subject: candidate.subject, body: candidate.firstBody });
      const bonus = sameCategoryBonus(target, category);
      return { ...candidate, category, sameCategory: bonus > 0, total: candidate.score + bonus };
    })
    .sort((a, b) => b.total - a.total || Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.id - a.id)
    .slice(0, limit);
}
