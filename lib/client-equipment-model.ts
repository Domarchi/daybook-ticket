/**
 * The equipment asked for when a client is invited ("ID del equipo", F6-A). Pure: shared by the form and the API.
 * The kinds are the equipment elements of the ticket classification (F5), so a report can join both.
 */
import { z } from 'zod';
import { FAULT_GROUPS } from './ticket-category-model';
import { assetTagProblem } from './asset-tag';
import type { TicketStatus } from './ticket-status';

export const EQUIPMENT_KINDS = FAULT_GROUPS[0].elements.map(element => ({ id: element.id, label: element.label }));
export type EquipmentKind = (typeof FAULT_GROUPS)[0]['elements'][number]['id'];
const KIND_IDS = EQUIPMENT_KINDS.map(kind => kind.id) as [EquipmentKind, ...EquipmentKind[]];

export function equipmentKindLabel(kind: string): string {
  return EQUIPMENT_KINDS.find(item => item.id === kind)?.label ?? 'Equipo';
}

export const SERIAL_MAX_LENGTH = 120;
/** What the invite form sends. The inventory ID is checked with `assetTagProblem` so the message names the rule. */
export const inviteEquipmentSchema = z
  .object({
    assetTag: z.string().max(200),
    kind: z.enum(KIND_IDS),
    serial: z.string().trim().max(SERIAL_MAX_LENGTH).optional(),
  })
  .strict();
export type InviteEquipment = z.infer<typeof inviteEquipmentSchema>;

/**
 * The rule for a new client: a company and one piece of equipment are required (the equipment inventory belongs to a
 * company). Staff accounts never carry equipment. Returns the message to show, or null.
 */
export function clientInviteProblem(input: {
  role: string;
  customerCompanyId?: string | null;
  equipment?: InviteEquipment | null;
}): string | null {
  if (input.role !== 'client')
    return input.equipment ? 'Solo las cuentas de cliente registran un equipo al invitarlas.' : null;
  if (!input.customerCompanyId) return 'Selecciona la empresa del cliente. Si no existe, créala primero en «Empresas».';
  if (!input.equipment) return 'Indica el ID del equipo del cliente.';
  return assetTagProblem(input.equipment.assetTag);
}

/** What happens to an inventory ID that already exists, decided from its current row. Null means "assign it". */
export function existingEquipmentProblem(
  tag: string,
  current: { companyId: string; archived: boolean; assignedName: string | null },
  companyId: string,
): string | null {
  if (current.archived) return `El equipo ${tag} está dado de baja. Usa otro ID o reactívalo en el inventario.`;
  if (current.companyId !== companyId) return `El equipo ${tag} pertenece a otra empresa.`;
  if (current.assignedName) return `El equipo ${tag} ya está asignado a ${current.assignedName}.`;
  return null;
}

/** The equipment inventory as the staff sees it (F6-A2). */
export type EquipmentItem = {
  id: string;
  assetTag: string | null;
  name: string;
  category: string;
  serial: string;
  companyId: string;
  companyName: string;
  assignedMemberId: string | null;
  assignedName: string | null;
  /** Dado de baja: out of the active inventory, the client's equipment and new tickets. */
  archived: boolean;
  version: number;
  updatedAt: string;
};
export type EquipmentClient = {
  id: string;
  name: string;
  email: string;
  companyId: string | null;
  companyName: string | null;
};
export type EquipmentInventory = {
  equipment: EquipmentItem[];
  /** Active clients of a company: who equipment can be assigned to. */
  clients: EquipmentClient[];
  /** Clients without any active equipment, including older accounts and those without a company. */
  clientsWithoutEquipment: EquipmentClient[];
};
export const EQUIPMENT_FILTERS = ['all', 'unassigned', 'assigned', 'archived'] as const;
export type EquipmentFilter = (typeof EQUIPMENT_FILTERS)[number];
export function isEquipmentFilter(value: unknown): value is EquipmentFilter {
  return typeof value === 'string' && (EQUIPMENT_FILTERS as readonly string[]).includes(value);
}

const uuid = z.string().uuid('Selecciona una opción válida.');
export const createEquipmentSchema = z
  .object({
    companyId: uuid,
    assetTag: z.string().max(200),
    kind: z.enum(KIND_IDS),
    serial: z.string().trim().max(SERIAL_MAX_LENGTH).optional(),
    assignedMemberId: uuid.nullable().optional(),
  })
  .strict();
export const assignEquipmentSchema = z
  .object({ expectedVersion: z.number().int().min(0), assignedMemberId: uuid.nullable() })
  .strict();
/** «Dar de baja» (archived: true) or «Reactivar» (archived: false). */
export const archiveEquipmentSchema = z
  .object({ expectedVersion: z.number().int().min(0), archived: z.boolean() })
  .strict();
/** What a change to one piece of equipment sends: an assignment, or taking it out of or back into the inventory. */
export const equipmentChangeSchema = z.union([assignEquipmentSchema, archiveEquipmentSchema]);

/** Equipment goes only to an active client of its own company. Returns the message to show, or null. */
export function assigneeProblem(
  member: { role: string; status: string; customerCompanyId: string | null } | null,
  companyId: string,
): string | null {
  if (!member || member.role !== 'client' || member.status === 'revoked')
    return 'Solo puedes asignar el equipo a un cliente con acceso.';
  if (member.customerCompanyId !== companyId) return 'Ese cliente pertenece a otra empresa que el equipo.';
  return null;
}

/** A piece of equipment as its owner, or a ticket that names it, sees it (F6-A2b). */
export type OwnEquipment = {
  id: string;
  assetTag: string | null;
  name: string;
  category: string;
  serial: string;
  companyName: string;
};
/** How a piece of equipment is named in a list or a select. */
export function equipmentLabel(item: Pick<OwnEquipment, 'assetTag' | 'name' | 'category'>): string {
  return item.assetTag ? `${item.assetTag} · ${item.category}` : item.name;
}
/** A ticket can name one piece of equipment, and only one that belongs to the person it is for. */
export function ticketEquipmentProblem(
  asset: { assignedMemberId: string | null; archived: boolean } | null,
  requesterMemberId: string | null,
): string | null {
  if (!asset || asset.archived) return 'Ese equipo no existe en este espacio o fue dado de baja.';
  if (!requesterMemberId || asset.assignedMemberId !== requesterMemberId)
    return 'Elige un equipo asignado a la persona que hace la solicitud.';
  return null;
}

/** One line of a piece of equipment's history, newest first (F6-A3). */
export type EquipmentHistoryEntry = { at: string; actorName: string | null; text: string };
/** A ticket that named a piece of equipment, newest first. */
export type EquipmentTicket = {
  id: number;
  subject: string;
  status: TicketStatus;
  assigneeMemberId: string | null;
  linkedAt: string;
};
export type EquipmentHistory = { entries: EquipmentHistoryEntry[]; tickets: EquipmentTicket[] };
/** At most this many history lines and tickets are shown for one piece of equipment. */
export const EQUIPMENT_HISTORY_LIMIT = 50;

type Snapshot = { assignedContactMemberId?: unknown; archived?: unknown } | null;
const holder = (row: Snapshot) =>
  typeof row?.assignedContactMemberId === 'string' ? row.assignedContactMemberId : null;

/** The member ids a history entry mentions, so their names can be read in one query. */
export function equipmentHistoryMemberIds(rows: { before: Snapshot; after: Snapshot }[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) for (const id of [holder(row.before), holder(row.after)]) if (id) ids.add(id);
  return [...ids];
}

/**
 * How one recorded change reads in the history. `before` is null when the equipment was registered. Names come
 * from `names`; an id that is not there (an account from elsewhere) reads as «otra cuenta».
 */
export function describeEquipmentChange(before: Snapshot, after: Snapshot, names: ReadonlyMap<string, string>): string {
  const name = (id: string) => names.get(id) ?? 'otra cuenta';
  const from = holder(before),
    to = holder(after);
  if (!before) return to ? `Registrado y asignado a ${name(to)}` : 'Registrado sin asignar';
  if (!before.archived && after?.archived) return from ? `Dado de baja (estaba con ${name(from)})` : 'Dado de baja';
  if (before.archived && !after?.archived) return 'Reactivado sin asignar';
  if (from !== to) {
    if (!from) return `Asignado a ${name(to!)}`;
    if (!to) return `Liberado (estaba con ${name(from)})`;
    return `Reasignado de ${name(from)} a ${name(to)}`;
  }
  return 'Datos del equipo actualizados';
}
