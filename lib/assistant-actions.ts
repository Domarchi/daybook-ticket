/**
 * Feature 6: actions with confirmation. Bita may PROPOSE one of four changes to a ticket — assign it, change its
 * state, change its category, add an internal note — but it never makes them. The `proponer_accion` tool only reads:
 * it checks the proposal against the ticket as it is now (same rules as the desk) and returns it. The chat then shows
 * a card with the exact change and two buttons; only the person's "Confirmar" performs it, through the very routes
 * the ticket page uses (`PATCH /api/tickets/:id`, `POST /api/tickets/:id/messages`), with their permissions, version
 * checks and event history. Nothing is sent to the customer: replies stay with the draft (feature 3).
 */
import { randomUUID } from 'node:crypto';
import type { AccessContext } from './access';
import { maskText } from './assistant-privacy';
import {
  FAULT_GROUPS,
  REQUIREMENTS,
  faultLabel,
  requirementLabel,
  storedCategory,
  validateCategoryCorrection,
  type FaultElementId,
  type FaultGroupId,
  type RequirementId,
} from './ticket-category-model';
import { STATUS_VIEW_LABELS, isFinished, statusChangeProblem, statusLabel } from './ticket-status';
import type { Ticket } from './types';
import { ApiError, db, getTicket } from './server';

export const MAX_NOTE_CHARACTERS = 1500;
export const MAX_PROPOSALS_PER_ANSWER = 3;

/** States a person can ask for, in words; each maps to the stored value the ticket page writes. */
export const STATE_WORDS = { en_proceso: 'open', solucionado: 'resolved', cerrado: 'closed', reabrir: 'open' } as const;
export type StateWord = keyof typeof STATE_WORDS;

export type ProposedChange =
  | { type: 'assign'; memberId: string; memberName: string; fromName: string | null }
  | { type: 'status'; to: 'open' | 'resolved' | 'closed'; toLabel: string; fromLabel: string }
  | {
      type: 'category';
      faultGroup: FaultGroupId | null;
      faultElement: FaultElementId | null;
      requirement: RequirementId | null;
      toLabel: string;
      fromLabel: string;
    }
  | { type: 'note'; body: string };

/** What the chat shows as a card. `id` only tells cards apart; `version` is the ticket's when it was proposed. */
export type ActionProposal = {
  kind: 'ticket_action';
  id: string;
  ticketId: number;
  subject: string;
  version: number;
  summary: string;
  change: ProposedChange;
};

export type ProposalInput = {
  numero: number;
  accion: 'asignar' | 'estado' | 'categoria' | 'nota';
  responsable?: string;
  estado?: StateWord;
  falla_grupo?: string | null;
  falla_elemento?: string | null;
  requerimiento?: string | null;
  nota?: string;
};

type Validation<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export function validateProposal(input: unknown): Validation<ProposalInput> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('La propuesta debe ser un objeto.');
  const value = input as Record<string, unknown>;
  const numero = value.numero;
  if (typeof numero !== 'number' || !Number.isSafeInteger(numero) || numero < 1)
    return fail('«numero» debe ser el número entero del ticket.');
  const accion = value.accion;
  if (accion === 'asignar') {
    if (typeof value.responsable !== 'string' || !value.responsable.trim() || value.responsable.length > 120)
      return fail('Para asignar indica «responsable» con el nombre de la persona del equipo.');
    return { ok: true, value: { numero, accion, responsable: value.responsable.trim() } };
  }
  if (accion === 'estado') {
    if (typeof value.estado !== 'string' || !Object.hasOwn(STATE_WORDS, value.estado))
      return fail(`«estado» debe ser uno de: ${Object.keys(STATE_WORDS).join(', ')}.`);
    return { ok: true, value: { numero, accion, estado: value.estado as StateWord } };
  }
  if (accion === 'categoria') {
    const text = (key: string) => (value[key] === undefined || value[key] === null ? null : value[key]);
    const fields = {
      falla_grupo: text('falla_grupo'),
      falla_elemento: text('falla_elemento'),
      requerimiento: text('requerimiento'),
    };
    if (Object.values(fields).some(field => field !== null && typeof field !== 'string'))
      return fail('Los campos de la categoría deben ser textos o nulos.');
    if (fields.falla_grupo === null && fields.requerimiento === null)
      return fail('Indica al menos la falla («falla_grupo») o el requerimiento.');
    return { ok: true, value: { numero, accion, ...(fields as Record<string, string | null>) } };
  }
  if (accion === 'nota') {
    if (typeof value.nota !== 'string' || !value.nota.trim()) return fail('Para una nota indica su texto en «nota».');
    if (value.nota.length > MAX_NOTE_CHARACTERS)
      return fail(`La nota no puede pasar de ${MAX_NOTE_CHARACTERS} caracteres.`);
    return { ok: true, value: { numero, accion, nota: value.nota.trim() } };
  }
  return fail('«accion» debe ser asignar, estado, categoria o nota.');
}

const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** A team member by name: exact name first, then the only one whose name contains it. Several is a question back. */
export function matchMember(
  asked: string,
  members: { id: string; name: string }[],
): { kind: 'one'; member: { id: string; name: string } } | { kind: 'many' | 'none'; names: string[] } {
  const wanted = fold(asked);
  const exact = members.filter(member => fold(member.name) === wanted);
  if (exact.length === 1) return { kind: 'one', member: exact[0] };
  const partial = members.filter(member => wanted && fold(member.name).includes(wanted));
  if (partial.length === 1) return { kind: 'one', member: partial[0] };
  return {
    kind: partial.length ? 'many' : 'none',
    names: (partial.length ? partial : members).map(m => m.name).slice(0, 15),
  };
}

/**
 * Checks a proposal against the ticket as it is now and builds the card. Pure: the ticket and the active team are
 * parameters. The same rules as the desk: the state transitions of `statusChangeProblem`, the category lists of
 * `validateCategoryCorrection`, and only active owner/admin/agent members can be responsible.
 */
export function buildProposal(
  input: ProposalInput,
  ticket: Pick<
    Ticket,
    | 'id'
    | 'subject'
    | 'version'
    | 'status'
    | 'assigneeMemberId'
    | 'assignee'
    | 'faultGroup'
    | 'faultElement'
    | 'requirement'
    | 'categorySource'
  >,
  team: { id: string; name: string }[],
  id: string = randomUUID(),
): Validation<ActionProposal> {
  const base = {
    kind: 'ticket_action' as const,
    id,
    ticketId: ticket.id,
    subject: maskText(ticket.subject).slice(0, 160),
    version: ticket.version,
  };
  if (input.accion === 'asignar') {
    const match = matchMember(input.responsable ?? '', team);
    if (match.kind !== 'one')
      return fail(
        match.kind === 'many'
          ? `Hay varias personas que coinciden: ${match.names.join(', ')}. Pregunta a cuál.`
          : `No encontré a «${(input.responsable ?? '').slice(0, 60)}» en el equipo. Personas que pueden ser responsables: ${match.names.join(', ') || 'ninguna'}.`,
      );
    if (match.member.id === ticket.assigneeMemberId)
      return fail(`El ticket #${ticket.id} ya está asignado a ${match.member.name}.`);
    return {
      ok: true,
      value: {
        ...base,
        summary: `Asignar #${ticket.id} a ${match.member.name}`,
        change: {
          type: 'assign',
          memberId: match.member.id,
          memberName: match.member.name,
          fromName: ticket.assignee || null,
        },
      },
    };
  }
  if (input.accion === 'estado') {
    const word = input.estado as StateWord;
    const to = STATE_WORDS[word];
    if (word === 'reabrir' && !isFinished(ticket.status))
      return fail(`El ticket #${ticket.id} no está terminado: no hay nada que reabrir.`);
    if (to === ticket.status) return fail(`El ticket #${ticket.id} ya está en ese estado.`);
    const problem = statusChangeProblem(ticket.status, to);
    if (problem) return fail(problem);
    const toLabel =
      to === 'open'
        ? statusLabel({ status: 'open', assigneeMemberId: ticket.assigneeMemberId })
        : STATUS_VIEW_LABELS[to];
    return {
      ok: true,
      value: {
        ...base,
        summary: `${word === 'reabrir' ? 'Reabrir' : 'Cambiar el estado de'} #${ticket.id} a «${toLabel}»`,
        change: { type: 'status', to, toLabel, fromLabel: statusLabel(ticket) },
      },
    };
  }
  if (input.accion === 'categoria') {
    const category = validateCategoryCorrection({
      faultGroup: input.falla_grupo ?? null,
      faultElement: input.falla_elemento ?? null,
      requirement: input.requerimiento ?? null,
    });
    if (!category)
      return fail(
        'La categoría no está en la lista acordada. Fallas: ' +
          FAULT_GROUPS.map(
            group => `${group.id}${group.elements.length ? ` (${group.elements.map(e => e.id).join(', ')})` : ''}`,
          ).join('; ') +
          '. Requerimientos: ' +
          REQUIREMENTS.map(item => item.id).join(', ') +
          '.',
      );
    const fault = category.faultGroup ? { group: category.faultGroup, element: category.faultElement } : null;
    const toLabel = `${faultLabel(fault)} / ${requirementLabel(category.requirement)}`;
    const current = storedCategory(ticket);
    const fromLabel = current
      ? `${faultLabel(current.fault)} / ${requirementLabel(current.requirement)}`
      : 'Sin clasificar';
    if (current && fromLabel === toLabel && ticket.categorySource === 'manual')
      return fail(`El ticket #${ticket.id} ya tiene esa categoría, revisada por el equipo.`);
    return {
      ok: true,
      value: {
        ...base,
        summary: `Clasificar #${ticket.id} como «${toLabel}»`,
        change: { type: 'category', ...category, toLabel, fromLabel },
      },
    };
  }
  const body = maskText(input.nota ?? '').slice(0, MAX_NOTE_CHARACTERS);
  return {
    ok: true,
    value: { ...base, summary: `Agregar una nota interna a #${ticket.id}`, change: { type: 'note', body } },
  };
}

async function activeTeam(access: AccessContext) {
  return (
    await db()
      .prepare(
        `SELECT id,name FROM members WHERE "ownerId"=$1 AND "organizationId"=$2 AND status='active' AND role IN ('owner','admin','agent') ORDER BY name,id LIMIT 200`,
      )
      .bind(access.ownerId, access.organizationId)
      .all<{ id: string; name: string }>()
  ).results;
}

/** The `proponer_accion` tool. Reads the ticket and the team; writes nothing. */
export async function proposeAction(access: AccessContext, input: ProposalInput): Promise<Validation<ActionProposal>> {
  let ticket: Ticket;
  try {
    ticket = await getTicket(access, input.numero);
  } catch (failure) {
    if (failure instanceof ApiError && failure.status === 404) return fail(`No existe el ticket #${input.numero}.`);
    throw failure;
  }
  return buildProposal(input, ticket, input.accion === 'asignar' ? await activeTeam(access) : []);
}
