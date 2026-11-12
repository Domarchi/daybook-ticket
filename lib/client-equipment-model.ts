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
