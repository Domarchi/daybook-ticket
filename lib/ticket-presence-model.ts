import type { Ticket, TicketStatus } from './types';

export const PRESENCE_HEARTBEAT_MS = 20_000;
export const PRESENCE_TTL_MS = 45_000;
export const PRESENCE_IDLE_MS = 120_000;
export const PRESENCE_TYPING_MS = 10_000;
export const PRESENCE_MAX_TABS = 8;
export const PRESENCE_ACTIVITIES = ['viewing', 'reply', 'note'] as const;
export type PresenceActivity = (typeof PRESENCE_ACTIVITIES)[number];
export interface PresencePerson {
  memberId: string;
  name: string;
  activity: PresenceActivity;
  updatedAt: string;
}
export interface PresenceRow extends PresencePerson {
  expiresAt: string;
}
export interface PresencePage {
  people: PresencePerson[];
  expiresInMs: number;
}

export function presenceShouldRun(visible: boolean, lastInteraction: number, now: number): boolean {
  return visible && now >= lastInteraction && now - lastInteraction < PRESENCE_IDLE_MS;
}
export function currentPresenceActivity(
  activity: PresenceActivity,
  lastTypedAt: number,
  now: number,
): PresenceActivity {
  return lastTypedAt > 0 && now >= lastTypedAt && now - lastTypedAt <= PRESENCE_TYPING_MS ? activity : 'viewing';
}

/** Tabs are ephemeral, server-owned leases. Neither tab identifiers nor draft
 * content leave the server in the list shown to colleagues. */
export function visiblePresence(rows: PresenceRow[], viewerId: string, now = new Date()): PresencePerson[] {
  const people = new Map<string, PresencePerson>();
  for (const row of rows) {
    if (
      row.memberId === viewerId ||
      !Number.isFinite(Date.parse(row.updatedAt)) ||
      Date.parse(row.updatedAt) > now.getTime() ||
      Date.parse(row.updatedAt) + PRESENCE_TTL_MS <= now.getTime() ||
      Date.parse(row.expiresAt) <= now.getTime() ||
      !Number.isFinite(Date.parse(row.expiresAt)) ||
      !PRESENCE_ACTIVITIES.includes(row.activity)
    )
      continue;
    const activity = currentPresenceActivity(row.activity, Date.parse(row.updatedAt), now.getTime());
    const previous = people.get(row.memberId);
    const typing = activity !== 'viewing',
      previousTyping = previous?.activity !== 'viewing';
    if (!previous || (typing && !previousTyping) || (typing === previousTyping && row.updatedAt > previous.updatedAt)) {
      people.set(row.memberId, { memberId: row.memberId, name: row.name, activity, updatedAt: row.updatedAt });
    }
  }
  return [...people.values()].sort(
    (a, b) => a.name.localeCompare(b.name, 'es') || a.memberId.localeCompare(b.memberId),
  );
}

export interface PublicTicketProgress {
  ticketId: number;
  status: TicketStatus;
  responsibleName: string | null;
  receivedAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  deadlineAt: string | null;
  nextStep: string;
}
export interface PublicProgressInput {
  ticket: Pick<Ticket, 'id' | 'status' | 'createdAt' | 'dueAt'>;
  responsibleName: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  lastPublicAuthorRole: string | null;
}
const validTime = (value: string | null) => (value && Number.isFinite(Date.parse(value)) ? value : null);

/** Input comes exclusively from the authorized ticket and public-message
 * aggregates. Do not accept a staff directory, notes, or private event history. */
export function publicTicketProgress(input: PublicProgressInput): PublicTicketProgress {
  const { ticket } = input;
  const nextStep =
    ticket.status === 'resolved'
      ? 'Tu caso está resuelto. Si necesitas más ayuda, responde aquí para retomarlo.'
      : ticket.status === 'pending'
        ? 'Tu caso sigue en seguimiento. Puedes añadir información a la conversación.'
        : input.lastPublicAuthorRole === 'client' || !input.firstResponseAt
          ? 'El equipo revisará tu último mensaje y continuará la atención aquí.'
          : 'Revisa la respuesta del equipo y cuéntanos si necesitas algo más.';
  return {
    ticketId: ticket.id,
    status: ticket.status,
    responsibleName: input.responsibleName?.trim() || null,
    receivedAt: ticket.createdAt,
    firstResponseAt: validTime(input.firstResponseAt),
    resolvedAt: ticket.status === 'resolved' ? validTime(input.resolvedAt) : null,
    deadlineAt: ticket.status === 'resolved' ? null : validTime(ticket.dueAt),
    nextStep,
  };
}
