import { z } from 'zod';

const name = z.string().trim().min(1).max(100);
export const catalogKinds = ['tag', 'requestType', 'field', 'form'] as const;
export type CatalogKind = (typeof catalogKinds)[number];
export const fieldDefinitionSchema = z
  .object({
    name,
    type: z.enum(['text', 'textarea', 'select', 'date', 'boolean']),
    required: z.boolean().default(false),
    visibility: z.enum(['internal', 'public']).default('internal'),
    options: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.type === 'select' &&
      (!value.options.length ||
        new Set(value.options.map(v => v.toLocaleLowerCase('es'))).size !== value.options.length)
    )
      ctx.addIssue({ code: 'custom', message: 'Agrega opciones únicas para la selección.', path: ['options'] });
    if (value.type !== 'select' && value.options.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Las opciones corresponden solo a campos de selección.',
        path: ['options'],
      });
  });
export type FieldDefinition = z.output<typeof fieldDefinitionSchema>;
export interface FieldSnapshot extends FieldDefinition {
  id: string;
  version: number;
}
export const tagDefinitionSchema = z
  .object({ name, color: z.enum(['gold', 'blue', 'green', 'red', 'gray']).default('gold') })
  .strict();
export const requestTypeDefinitionSchema = z
  .object({ name, description: z.string().trim().max(1000).default('') })
  .strict();
export const formDefinitionSchema = z
  .object({
    name,
    customerCompanyId: z.string().uuid().nullable().default(null),
    requestTypeId: z.string().uuid(),
    fieldIds: z
      .array(z.string().uuid())
      .max(20)
      .refine(v => new Set(v).size === v.length, 'Hay campos repetidos.'),
    published: z.boolean().default(false),
  })
  .strict();
export type FormDefinition = z.output<typeof formDefinitionSchema> & { fields: FieldSnapshot[] };
export interface CatalogItem<T = Record<string, unknown>> {
  id: string;
  kind: CatalogKind;
  name: string;
  version: number;
  archived: boolean;
  definition: T;
  createdAt: string;
  updatedAt: string;
}
export interface OrganizationCatalog {
  tags: CatalogItem<z.output<typeof tagDefinitionSchema>>[];
  requestTypes: CatalogItem<z.output<typeof requestTypeDefinitionSchema>>[];
  fields: CatalogItem<FieldDefinition>[];
  forms: CatalogItem<FormDefinition>[];
}
export const catalogMutationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tag'), definition: tagDefinitionSchema }).strict(),
  z.object({ kind: z.literal('requestType'), definition: requestTypeDefinitionSchema }).strict(),
  z.object({ kind: z.literal('field'), definition: fieldDefinitionSchema }).strict(),
  z.object({ kind: z.literal('form'), definition: formDefinitionSchema }).strict(),
]);
export const catalogPatchSchema = z
  .object({
    id: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
    archived: z.boolean().optional(),
    definition: z.unknown().optional(),
  })
  .strict()
  .refine(v => v.archived !== undefined || v.definition !== undefined, 'No hay cambios.');
export type FieldValue = string | boolean | null;
export type FieldValues = Record<string, FieldValue>;
const fieldValuesSchema = z
  .custom<FieldValues>(
    value =>
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).every(key => z.string().uuid().safeParse(key).success),
    'Los campos enviados no son válidos.',
  )
  .pipe(z.record(z.string().uuid(), z.union([z.string().max(4000), z.boolean(), z.null()])));
export interface StoredFieldValue {
  definition: FieldSnapshot;
  value: FieldValue;
}
export interface PreparedOrganization {
  requestType: { id: string; name: string; version: number } | null;
  form: { id: string; name: string; version: number; published: boolean; customerCompanyId: string | null } | null;
  values: Record<string, StoredFieldValue>;
}
export const organizationSubmissionSchema = z
  .object({ requestTypeId: z.string().uuid().nullable().optional(), fieldValues: fieldValuesSchema.optional() })
  .strict();
export const ticketOrganizationPatchSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    tagIds: z.array(z.string().uuid()).max(20).optional(),
    waitReason: z.string().trim().max(500).optional(),
    requestTypeId: z.string().uuid().nullable().optional(),
    fieldValues: fieldValuesSchema.optional(),
  })
  .strict();
export interface TicketOrganization extends PreparedOrganization {
  customerCompanyId: string | null;
  version: number;
  tags: CatalogItem<z.output<typeof tagDefinitionSchema>>[];
  waitReason?: string;
}

/** The submitted definition never comes from the browser; it is the form's frozen version. */
export function validateOrganizationValues(
  fields: FieldSnapshot[],
  values: FieldValues,
  staff: boolean,
  enforceRequired = true,
): Record<string, StoredFieldValue> {
  const available = new Map(
    fields.filter(field => staff || field.visibility === 'public').map(field => [field.id, field]),
  );
  for (const id of Object.keys(values))
    if (!available.has(id)) throw new Error('El formulario cambió o contiene un campo no permitido.');
  const output: Record<string, StoredFieldValue> = {};
  for (const [id, field] of available) {
    const value = values[id] ?? null;
    if (value === null || (typeof value === 'string' && !value.trim())) {
      if (field.required && enforceRequired) throw new Error(`Completa «${field.name}».`);
      output[id] = { definition: structuredClone(field), value: null };
      continue;
    }
    if (field.type === 'boolean') {
      if (typeof value !== 'boolean') throw new Error(`Selecciona sí o no en «${field.name}».`);
    } else {
      if (typeof value !== 'string') throw new Error(`Revisa «${field.name}».`);
      if ((field.type === 'text' && value.length > 500) || (field.type === 'textarea' && value.length > 4000))
        throw new Error(`El valor de «${field.name}» es demasiado largo.`);
      if (field.type === 'select' && !field.options.includes(value))
        throw new Error(`Selecciona una opción válida en «${field.name}».`);
      if (
        field.type === 'date' &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value)
      )
        throw new Error(`Selecciona una fecha válida en «${field.name}».`);
    }
    output[id] = { definition: structuredClone(field), value: typeof value === 'string' ? value.trim() : value };
  }
  return output;
}
export function visibleOrganization(prepared: PreparedOrganization, staff: boolean): PreparedOrganization {
  if (!staff && !prepared.form?.published) return { requestType: null, form: null, values: {} };
  return {
    requestType: prepared.requestType,
    form: prepared.form,
    values: Object.fromEntries(
      Object.entries(prepared.values).filter(([, item]) => staff || item.definition.visibility === 'public'),
    ),
  };
}
export function selectCompanyForm(
  forms: CatalogItem<FormDefinition>[],
  requestTypeId: string,
  companyId: string | null,
  staff: boolean,
) {
  return forms
    .filter(
      item =>
        !item.archived &&
        item.definition.requestTypeId === requestTypeId &&
        (staff || item.definition.published) &&
        (item.definition.customerCompanyId === null || item.definition.customerCompanyId === companyId),
    )
    .sort(
      (a, b) =>
        Number(b.definition.customerCompanyId === companyId && companyId !== null) -
          Number(a.definition.customerCompanyId === companyId && companyId !== null) ||
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.id.localeCompare(b.id),
    )[0];
}
export const taskCreateSchema = z
  .object({
    operationId: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    assigneeMemberId: z.string().uuid().nullable().default(null),
    dueAt: z.string().datetime({ offset: true }).nullable().default(null),
  })
  .strict();
export const taskPatchSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(200).optional(),
    assigneeMemberId: z.string().uuid().nullable().optional(),
    dueAt: z.string().datetime({ offset: true }).nullable().optional(),
    status: z.enum(['open', 'done', 'cancelled']).optional(),
  })
  .strict()
  .refine(v => Object.keys(v).some(k => k !== 'expectedVersion'), 'No hay cambios.');
export interface TicketTask {
  id: string;
  ticketId: number;
  title: string;
  assigneeMemberId: string | null;
  assigneeName: string | null;
  dueAt: string | null;
  status: 'open' | 'done' | 'cancelled';
  version: number;
  createdAt: string;
  updatedAt: string;
}
export const savedViewFiltersSchema = z
  .object({
    q: z.string().max(200).default(''),
    queue: z.enum(['all', 'open', 'pending', 'resolved', 'mine', 'unassigned', 'overdue']).default('all'),
    priority: z.enum(['all', 'urgent', 'high', 'normal', 'low']).default('all'),
    department: z.string().min(1).max(160).default('all'),
    company: z.string().min(1).max(160).default('all'),
    agent: z.string().min(1).max(160).default('all'),
  })
  .strict();
export const savedViewSchema = z.object({ name, filters: savedViewFiltersSchema }).strict();
export interface SavedTicketView {
  id: string;
  name: string;
  filters: z.output<typeof savedViewFiltersSchema>;
  version: number;
}
export function csvOrganizationCell(value: unknown): string {
  const text = String(value ?? '');
  return `"${(/^[\s]*[=+@-]/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`;
}
