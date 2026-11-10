import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  catalogMutationSchema,
  catalogPatchSchema,
  csvOrganizationCell,
  fieldDefinitionSchema,
  formDefinitionSchema,
  organizationSubmissionSchema,
  savedViewSchema,
  selectCompanyForm,
  taskCreateSchema,
  taskPatchSchema,
  validateOrganizationValues,
  visibleOrganization,
  type CatalogItem,
  type FieldSnapshot,
  type FormDefinition,
  type PreparedOrganization,
} from '../lib/work-organization-model';

const id = '11111111-1111-4111-8111-111111111111',
  internalId = '22222222-2222-4222-8222-222222222222',
  typeId = '33333333-3333-4333-8333-333333333333',
  companyId = '44444444-4444-4444-8444-444444444444';
const field = (changes: Partial<FieldSnapshot> = {}): FieldSnapshot => ({
  id,
  version: 0,
  name: 'Equipo',
  type: 'text',
  required: false,
  visibility: 'public',
  options: [],
  ...changes,
});
function form(
  changes: Partial<CatalogItem<FormDefinition>> = {},
  definition: Partial<FormDefinition> = {},
): CatalogItem<FormDefinition> {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    kind: 'form',
    name: 'Formulario',
    version: 0,
    archived: false,
    createdAt: '2026-11-05T10:00:00Z',
    updatedAt: '2026-11-05T10:00:00Z',
    ...changes,
    definition: {
      name: 'Formulario',
      customerCompanyId: null,
      requestTypeId: typeId,
      fieldIds: [id],
      fields: [field()],
      published: true,
      ...definition,
    },
  };
}
test('new fields and forms are private until explicitly published', () => {
  assert.equal(fieldDefinitionSchema.parse({ name: 'Contraseña técnica', type: 'text' }).visibility, 'internal');
  assert.equal(formDefinitionSchema.parse({ name: 'Acceso', requestTypeId: typeId, fieldIds: [id] }).published, false);
  assert.equal(
    catalogMutationSchema.safeParse({ kind: 'tag', definition: { name: 'Acceso', ownerId: 'otro' } }).success,
    false,
  );
});
test('select fields require unique bounded options and other kinds cannot carry them', () => {
  assert.equal(fieldDefinitionSchema.safeParse({ name: 'Sede', type: 'select', options: [] }).success, false);
  assert.equal(
    fieldDefinitionSchema.safeParse({ name: 'Sede', type: 'select', options: ['Santiago', 'santiago'] }).success,
    false,
  );
  assert.equal(fieldDefinitionSchema.safeParse({ name: 'Sede', type: 'text', options: ['Santiago'] }).success, false);
  assert.equal(
    fieldDefinitionSchema.safeParse({
      name: 'Sede',
      type: 'select',
      options: Array.from({ length: 21 }, (_, i) => String(i)),
    }).success,
    false,
  );
});
test('client cannot supply internal or unknown values even as null', () => {
  assert.throws(
    () => validateOrganizationValues([field({ visibility: 'internal' })], { [id]: 'secreto' }, false),
    /no permitido/,
  );
  assert.throws(() => validateOrganizationValues([field()], { [internalId]: null }, false), /no permitido/);
});
test('boolean false satisfies required and string false is rejected', () => {
  assert.equal(
    validateOrganizationValues([field({ type: 'boolean', required: true })], { [id]: false }, false)[id].value,
    false,
  );
  assert.throws(() => validateOrganizationValues([field({ type: 'boolean' })], { [id]: 'false' }, false), /sí o no/);
  assert.throws(() => validateOrganizationValues([field({ type: 'boolean', required: true })], {}, false), /Completa/);
});
test('date-only values validate actual calendar dates without reinterpretation', () => {
  assert.equal(
    validateOrganizationValues([field({ type: 'date' })], { [id]: '2028-02-29' }, true)[id].value,
    '2028-02-29',
  );
  for (const invalid of ['2027-02-29', '2026-02-30', '2026-13-01', '2026-01-01T00:00:00Z'])
    assert.throws(() => validateOrganizationValues([field({ type: 'date' })], { [id]: invalid }, true), /fecha válida/);
});
test('text limits, option validation and whitespace requirements apply server-side', () => {
  assert.throws(() => validateOrganizationValues([field()], { [id]: 'a'.repeat(501) }, true), /demasiado largo/);
  assert.throws(
    () => validateOrganizationValues([field({ type: 'select', options: ['Uno'] })], { [id]: 'Dos' }, true),
    /opción válida/,
  );
  assert.throws(() => validateOrganizationValues([field({ required: true })], { [id]: '  ' }, true), /Completa/);
  assert.equal(validateOrganizationValues([field()], { [id]: '  Equipo 1  ' }, true)[id].value, 'Equipo 1');
});
test('stored fields retain their exact definition version after catalog edits', () => {
  const definition = field({ version: 2, options: [] });
  const values = validateOrganizationValues([definition], { [id]: 'Histórico' }, true);
  definition.name = 'Nombre nuevo';
  definition.version = 3;
  definition.visibility = 'internal';
  assert.equal(values[id].definition.name, 'Equipo');
  assert.equal(values[id].definition.version, 2);
  assert.equal(values[id].definition.visibility, 'public');
});
test('private forms and internal field metadata do not appear to clients', () => {
  const prepared: PreparedOrganization = {
    requestType: { id: typeId, name: 'Acceso', version: 0 },
    form: { id: form().id, name: 'Formulario', version: 0, published: true, customerCompanyId: null },
    values: {
      [id]: { definition: field(), value: 'Público' },
      [internalId]: {
        definition: field({ id: internalId, name: 'Secreto interno', visibility: 'internal' }),
        value: 'Oculto',
      },
    },
  };
  const visible = visibleOrganization(prepared, false);
  assert.deepEqual(Object.keys(visible.values), [id]);
  assert.ok(!JSON.stringify(visible).includes('Secreto interno'));
  assert.deepEqual(visibleOrganization({ ...prepared, form: { ...prepared.form!, published: false } }, false), {
    requestType: null,
    form: null,
    values: {},
  });
  assert.equal(Object.keys(visibleOrganization(prepared, true).values).length, 2);
});
test('company form overrides shared form and cannot select another company or archived form', () => {
  const shared = form(),
    specific = form({ id: internalId }, { customerCompanyId: companyId }),
    foreign = form({ id: typeId }, { customerCompanyId: id });
  assert.equal(selectCompanyForm([foreign, shared, specific], typeId, companyId, false)?.id, internalId);
  assert.equal(selectCompanyForm([{ ...specific, archived: true }, shared], typeId, companyId, false)?.id, shared.id);
  assert.equal(selectCompanyForm([form({}, { published: false })], typeId, null, false), undefined);
  assert.ok(selectCompanyForm([form({}, { published: false })], typeId, null, true));
});
test('task creation and changes reject undocumented statuses and arbitrary ownership', () => {
  const operationId = id;
  assert.equal(taskCreateSchema.parse({ operationId, title: 'Revisar' }).assigneeMemberId, null);
  assert.equal(taskCreateSchema.safeParse({ operationId, title: 'Revisar', ownerId: 'otro' }).success, false);
  assert.equal(taskPatchSchema.safeParse({ expectedVersion: 0, status: 'resolved' }).success, false);
  assert.equal(taskPatchSchema.safeParse({ expectedVersion: 0 }).success, false);
  assert.equal(taskPatchSchema.safeParse({ expectedVersion: 0, status: 'done' }).success, true);
});
test('personal views preserve supported filters without executing arbitrary filters', () => {
  const view = savedViewSchema.parse({ name: 'Mis urgentes', filters: { queue: 'mine', priority: 'urgent' } });
  assert.equal(view.filters.company, 'all');
  assert.equal(view.filters.queue, 'mine');
  assert.equal(savedViewSchema.safeParse({ name: 'Vista', filters: { querySql: 'DROP TABLE' } }).success, false);
  assert.equal(organizationSubmissionSchema.safeParse({ fieldValues: JSON.parse('{"__proto__":"x"}') }).success, false);
  assert.equal(catalogPatchSchema.safeParse({ id, expectedVersion: 0, archived: true }).success, true);
  assert.equal(catalogPatchSchema.safeParse({ id, expectedVersion: 0, ownerId: 'x' }).success, false);
});
test('CSV text cannot become a spreadsheet formula and quotes stay escaped', () => {
  assert.equal(csvOrganizationCell('  =HYPERLINK("x")'), '"\'  =HYPERLINK(""x"")"');
  assert.equal(csvOrganizationCell('nombre, normal'), '"nombre, normal"');
  assert.equal(csvOrganizationCell('@SUM(1)'), '"\'@SUM(1)"');
});
