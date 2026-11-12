/**
 * The equipment asked for when a client is invited ("ID del equipo", F6-A). Pure: shared by the form and the API.
 * The kinds are the equipment elements of the ticket classification (F5), so a report can join both.
 */
import { z } from 'zod';
import { FAULT_GROUPS } from './ticket-category-model';
import { assetTagProblem } from './asset-tag';

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
export const EQUIPMENT_FILTERS = ['all', 'unassigned', 'assigned'] as const;
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
