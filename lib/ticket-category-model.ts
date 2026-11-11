/**
 * The fixed classification of a ticket: what failed (group → element) and what is being requested.
 * The description of the failure is the ticket body itself. Identifiers are stable and stored; labels are shown.
 *
 * "Equipos y periféricos" and "Conectividad" are provisional names: the request listed those two blocks without
 * naming them.
 */
export const FAULT_GROUPS = [
  {
    id: 'equipment',
    label: 'Equipos y periféricos',
    elements: [
      { id: 'monitor', label: 'Monitor' },
      { id: 'computer', label: 'Computador' },
      { id: 'keyboard', label: 'Teclado' },
      { id: 'mouse', label: 'Mouse' },
      { id: 'printer', label: 'Impresora' },
      { id: 'docking', label: 'Docking' },
      { id: 'phone', label: 'Celular' },
      { id: 'other_device', label: 'Otro' },
    ],
  },
  {
    id: 'connectivity',
    label: 'Conectividad',
    elements: [
      { id: 'internet', label: 'Servicios Internet' },
      { id: 'mobile_network', label: 'Redes móviles' },
      { id: 'computer_network', label: 'Red computacional' },
      { id: 'wifi', label: 'Red WiFi' },
    ],
  },
  { id: 'access', label: 'Acceso y contraseñas', elements: [] },
  { id: 'microsoft_apps', label: 'Aplicaciones Microsoft', elements: [] },
  { id: 'other_apps', label: 'Aplicaciones No Microsoft', elements: [] },
  { id: 'daybook_apps', label: 'Aplicaciones DayBook', elements: [] },
  { id: 'other', label: 'Otros', elements: [] },
] as const;

export const REQUIREMENTS = [
  { id: 'equipment', label: 'Equipos' },
  { id: 'user_accounts', label: 'Cuentas de usuarios' },
  { id: 'applications', label: 'Aplicaciones' },
  { id: 'folder_permissions', label: 'Permisos de carpetas' },
  { id: 'other', label: 'Otros' },
] as const;

export type FaultGroupId = (typeof FAULT_GROUPS)[number]['id'];
export type FaultElementId = (typeof FAULT_GROUPS)[number]['elements'][number]['id'];
export type RequirementId = (typeof REQUIREMENTS)[number]['id'];

/** What failed. `element` is null for groups without elements, or when only the group is known. */
export type FaultCategory = { group: FaultGroupId; element: FaultElementId | null };

export type TicketCategory = {
  /** Null when the ticket only asks for something and nothing failed. */
  fault: FaultCategory | null;
  requirement: RequirementId | null;
};

export function isFaultGroup(value: unknown): value is FaultGroupId {
  return FAULT_GROUPS.some(group => group.id === value);
}
export function isRequirement(value: unknown): value is RequirementId {
  return REQUIREMENTS.some(requirement => requirement.id === value);
}
/** An element is valid only inside its own group; null is always valid. */
export function isValidFault(group: unknown, element: unknown): group is FaultGroupId {
  const found = FAULT_GROUPS.find(item => item.id === group);
  if (!found) return false;
  return element === null || (found.elements as readonly { id: string }[]).some(item => item.id === element);
}

export function faultLabel(fault: FaultCategory | null): string {
  if (!fault) return 'Sin falla';
  const group = FAULT_GROUPS.find(item => item.id === fault.group);
  if (!group) return 'Otros';
  const element = (group.elements as readonly { id: string; label: string }[]).find(item => item.id === fault.element);
  return element ? `${group.label} · ${element.label}` : group.label;
}
export function requirementLabel(requirement: RequirementId | null): string {
  return REQUIREMENTS.find(item => item.id === requirement)?.label ?? 'Sin requerimiento';
}

/** How a category was set: suggested by the classifier, or chosen by a person (which the classifier never overwrites). */
export type CategorySource = 'bot' | 'manual';
export type StoredCategory = {
  faultGroup: string | null;
  faultElement: string | null;
  requirement: string | null;
  categorySource: string | null;
  categoryConfidence: string | null;
};
export type CategoryCorrection = {
  faultGroup: FaultGroupId | null;
  faultElement: FaultElementId | null;
  requirement: RequirementId | null;
};

/** A person's correction: the element must belong to its group, and nothing outside the agreed lists is accepted. */
export function validateCategoryCorrection(input: {
  faultGroup: unknown;
  faultElement: unknown;
  requirement: unknown;
}): CategoryCorrection | null {
  const { faultGroup, faultElement, requirement } = input;
  if (faultGroup === null) {
    if (faultElement !== null) return null;
  } else if (!isValidFault(faultGroup, faultElement)) return null;
  if (requirement !== null && !isRequirement(requirement)) return null;
  return {
    faultGroup: faultGroup as FaultGroupId | null,
    faultElement: faultElement as FaultElementId | null,
    requirement: requirement as RequirementId | null,
  };
}

/** The stored columns read back as a category, or null if the ticket was never classified. */
export function storedCategory(row: Partial<StoredCategory>): TicketCategory | null {
  if (!row.categorySource) return null;
  return {
    fault:
      row.faultGroup && isValidFault(row.faultGroup, row.faultElement ?? null)
        ? { group: row.faultGroup, element: (row.faultElement ?? null) as FaultElementId | null }
        : null,
    requirement: isRequirement(row.requirement) ? row.requirement : null,
  };
}

/** Inbox filter values: every fault group, plus plain requests and tickets nobody classified (older ones). */
export const CATEGORY_FILTERS = ['all', ...FAULT_GROUPS.map(group => group.id), 'requests', 'unclassified'] as const;
export function isCategoryFilter(value: unknown): boolean {
  return typeof value === 'string' && (CATEGORY_FILTERS as readonly string[]).includes(value);
}
