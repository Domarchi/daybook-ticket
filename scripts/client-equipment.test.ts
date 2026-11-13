import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import { assignInviteEquipment } from '../lib/client-equipment';
import {
  EQUIPMENT_FILTERS,
  EQUIPMENT_KINDS,
  assigneeProblem,
  assignEquipmentSchema,
  createEquipmentSchema,
  isEquipmentFilter,
  clientInviteProblem,
  equipmentLabel,
  ticketEquipmentProblem,
  existingEquipmentProblem,
  inviteEquipmentSchema,
} from '../lib/client-equipment-model';
import { FAULT_GROUPS } from '../lib/ticket-category-model';
import { ApiError, createTicketSchema, inviteMemberSchema } from '../lib/server';
import { WORKSPACE_ROUTE_REGISTRY } from '../lib/workspace-route-registry';

const equipment = { assetTag: 'nb-0042', kind: 'computer' as const };

test('equipment kinds are the equipment elements of the ticket classification', () => {
  assert.deepEqual(
    EQUIPMENT_KINDS.map(kind => kind.label),
    FAULT_GROUPS[0].elements.map(element => element.label),
  );
  assert.deepEqual(
    EQUIPMENT_KINDS.map(kind => kind.label),
    ['Monitor', 'Computador', 'Teclado', 'Mouse', 'Impresora', 'Docking', 'Celular', 'Otro'],
  );
});

test('a client needs a company and equipment; staff never carry equipment', () => {
  assert.equal(clientInviteProblem({ role: 'client', customerCompanyId: 'c1', equipment }), null);
  assert.match(clientInviteProblem({ role: 'client', equipment }) ?? '', /empresa del cliente/);
  assert.match(clientInviteProblem({ role: 'client', customerCompanyId: 'c1' }) ?? '', /ID del equipo/);
  assert.match(
    clientInviteProblem({ role: 'client', customerCompanyId: 'c1', equipment: { ...equipment, assetTag: '  ' } }) ?? '',
    /Escribe el ID/,
  );
  assert.match(
    clientInviteProblem({ role: 'client', customerCompanyId: 'c1', equipment: { ...equipment, assetTag: 'Ñ-1' } }) ??
      '',
    /solo admite/,
  );
  assert.equal(clientInviteProblem({ role: 'agent' }), null);
  assert.equal(clientInviteProblem({ role: 'admin' }), null);
  assert.match(clientInviteProblem({ role: 'agent', equipment }) ?? '', /Solo las cuentas de cliente/);
});

test('the invite schema accepts the equipment block and nothing unexpected inside it', () => {
  const base = {
    name: 'Ana',
    email: 'ana@example.test',
    role: 'client',
    customerCompanyId: '6f1b8a52-3c1d-4f7e-9a10-2b5c8d9e0f11',
  };
  assert.equal(inviteMemberSchema.safeParse({ ...base, equipment }).success, true);
  assert.equal(inviteMemberSchema.safeParse({ ...base, equipment: { ...equipment, serial: ' SN1 ' } }).success, true);
  assert.equal(inviteEquipmentSchema.safeParse({ ...equipment, kind: 'toaster' }).success, false);
  assert.equal(inviteEquipmentSchema.safeParse({ ...equipment, owner: 'x' }).success, false);
  assert.equal(inviteEquipmentSchema.safeParse({ ...equipment, serial: 'x'.repeat(121) }).success, false);
});

test('an existing inventory ID is assigned only when it is free, active and of the same company', () => {
  const free = { companyId: 'c1', archived: false, assignedName: null };
  assert.equal(existingEquipmentProblem('NB-1', free, 'c1'), null);
  assert.match(existingEquipmentProblem('NB-1', { ...free, archived: true }, 'c1') ?? '', /dado de baja/);
  assert.match(existingEquipmentProblem('NB-1', free, 'c2') ?? '', /otra empresa/);
  assert.match(existingEquipmentProblem('NB-1', { ...free, assignedName: 'Pedro' }, 'c1') ?? '', /asignado a Pedro/);
});

/** A transaction double: answers the lookup with `existing` and records every statement. */
function fakeTx(existing: Record<string, unknown> | null, failInsert?: { code: string }) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const tx = {
    async query(sql: string, values: unknown[] = []) {
      calls.push({ sql, values });
      if (sql.includes('FOR UPDATE OF a')) return { rows: existing ? [existing] : [] };
      if (sql.startsWith('INSERT INTO "customerAssets"')) {
        if (failInsert) throw Object.assign(new Error('duplicate'), failInsert);
        return { rows: [{ id: values[0], assetTag: values[6] }] };
      }
      if (sql.startsWith('SELECT * FROM "customerAssets"')) return { rows: [{ id: values[0], before: true }] };
      if (sql.startsWith('UPDATE "customerAssets"')) return { rows: [{ id: values[0], after: true }] };
      return { rows: [] };
    },
  };
  return { tx: tx as unknown as PoolClient, calls };
}
const input = {
  ownerId: 'owner-1',
  companyId: 'c1',
  memberId: 'member-new',
  actorMemberId: 'member-admin',
  equipment: { ...equipment, serial: 'SN-77' },
  now: '2026-11-12T16:00:00.000Z',
};

test('a new inventory ID creates the equipment, assigned and normalized, with a history entry', async () => {
  const { tx, calls } = fakeTx(null);
  const result = await assignInviteEquipment(tx, input);
  assert.equal(result.assetTag, 'NB-0042');
  assert.equal(result.created, true);
  assert.deepEqual(calls[0].values, ['owner-1', 'NB-0042'], 'looked up normalized, in this workspace');
  const insert = calls.find(call => call.sql.startsWith('INSERT INTO "customerAssets"'))!;
  assert.deepEqual(insert.values.slice(1), [
    'owner-1',
    'c1',
    'Computador NB-0042',
    'Computador',
    'SN-77',
    'NB-0042',
    'member-new',
    '2026-11-12T16:00:00.000Z',
  ]);
  const event = calls.find(call => call.sql.startsWith('INSERT INTO "serviceContextEvents"'))!;
  assert.deepEqual(event.values.slice(1, 6), ['owner-1', 'c1', 'assets', result.id, 'member-admin']);
  assert.equal(event.values[6], null, 'no "before" for a new equipment');
});

test('a free equipment of the same company is assigned, not duplicated', async () => {
  const { tx, calls } = fakeTx({ id: 'asset-9', companyId: 'c1', archived: false, assignedName: null });
  const result = await assignInviteEquipment(tx, input);
  assert.deepEqual(result, { id: 'asset-9', assetTag: 'NB-0042', created: false });
  assert.equal(calls.filter(call => call.sql.startsWith('INSERT INTO "customerAssets"')).length, 0);
  const update = calls.find(call => call.sql.startsWith('UPDATE "customerAssets"'))!;
  assert.deepEqual(update.values, ['asset-9', 'member-new', '2026-11-12T16:00:00.000Z']);
  const event = calls.find(call => call.sql.startsWith('INSERT INTO "serviceContextEvents"'))!;
  assert.notEqual(event.values[6], null, 'the history keeps the row before the assignment');
});

test('equipment that belongs to someone, to another company or is archived is refused without writing', async () => {
  for (const existing of [
    { id: 'a', companyId: 'c1', archived: false, assignedName: 'Pedro' },
    { id: 'a', companyId: 'c2', archived: false, assignedName: null },
    { id: 'a', companyId: 'c1', archived: true, assignedName: null },
  ]) {
    const { tx, calls } = fakeTx(existing);
    await assert.rejects(assignInviteEquipment(tx, input), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 409);
      return true;
    });
    assert.equal(calls.length, 1, 'only the lookup ran');
  }
});

test('a concurrent duplicate becomes a clear 409, other database errors are not hidden', async () => {
  await assert.rejects(assignInviteEquipment(fakeTx(null, { code: '23505' }).tx, input), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 409);
    return true;
  });
  await assert.rejects(
    assignInviteEquipment(fakeTx(null, { code: '57014' }).tx, input),
    (error: unknown) => !(error instanceof ApiError),
  );
});

test('the invite route checks the rule before writing and assigns inside the same transaction', () => {
  const route = readFileSync('app/api/members/route.ts', 'utf8').replace(/\s+/g, ' ');
  const check = route.indexOf('clientInviteProblem(data)'),
    transaction = route.indexOf('database.transaction('),
    insert = route.indexOf('INSERT INTO members'),
    assign = route.indexOf('assignInviteEquipment(tx,');
  assert.ok(check > 0 && check < transaction, 'rule checked before the transaction');
  assert.ok(insert > transaction && assign > insert, 'equipment assigned after the member exists, in the same tx');
});

test('equipment goes only to an active client of its own company (F6-A2)', () => {
  const client = { role: 'client', status: 'active', customerCompanyId: 'c1' };
  assert.equal(assigneeProblem(client, 'c1'), null);
  assert.equal(assigneeProblem({ ...client, status: 'invited' }, 'c1'), null, 'an invited client can already have it');
  assert.match(assigneeProblem(null, 'c1') ?? '', /cliente con acceso/);
  assert.match(
    assigneeProblem({ ...client, role: 'agent', customerCompanyId: null }, 'c1') ?? '',
    /cliente con acceso/,
  );
  assert.match(assigneeProblem({ ...client, status: 'revoked' }, 'c1') ?? '', /cliente con acceso/);
  assert.match(assigneeProblem(client, 'c2') ?? '', /otra empresa/);
});

test('inventory requests are strict: known filters, uuids, a version for every reassignment', () => {
  const company = '6f1b8a52-3c1d-4f7e-9a10-2b5c8d9e0f11';
  assert.deepEqual([...EQUIPMENT_FILTERS], ['all', 'unassigned', 'assigned']);
  assert.equal(isEquipmentFilter('unassigned'), true);
  assert.equal(isEquipmentFilter('archived'), false);
  assert.equal(
    createEquipmentSchema.safeParse({ companyId: company, assetTag: 'MON-7', kind: 'monitor' }).success,
    true,
  );
  assert.equal(
    createEquipmentSchema.safeParse({ companyId: company, assetTag: 'MON-7', kind: 'monitor', assignedMemberId: null })
      .success,
    true,
  );
  assert.equal(createEquipmentSchema.safeParse({ companyId: 'c1', assetTag: 'MON-7', kind: 'monitor' }).success, false);
  assert.equal(assignEquipmentSchema.safeParse({ assignedMemberId: null }).success, false, 'version required');
  assert.equal(assignEquipmentSchema.safeParse({ expectedVersion: 2, assignedMemberId: null }).success, true);
  assert.equal(
    assignEquipmentSchema.safeParse({ expectedVersion: 2, assignedMemberId: company, companyId: company }).success,
    false,
  );
});

test('the inventory API is staff-only and reachable through the workspace route registry', () => {
  for (const [path, method] of [
    ['equipment', 'GET'],
    ['equipment', 'POST'],
    ['equipment/6f1b8a52-3c1d-4f7e-9a10-2b5c8d9e0f11', 'PATCH'],
  ] as const) {
    const route = WORKSPACE_ROUTE_REGISTRY.find(item => item.pattern.test(path));
    assert.ok(route, path);
    assert.equal(typeof (route.handlers as Record<string, unknown>)[method], 'function', `${method} ${path}`);
  }
  for (const file of ['app/api/equipment/route.ts', 'app/api/equipment/[id]/route.ts']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /requireStaff\(await requireAccess\(request\)\)/, file);
  }
  const inventory = readFileSync('lib/equipment-inventory.ts', 'utf8').replace(/\s+/g, ' ');
  assert.match(inventory, /WHERE a\."ownerId" = \$1 AND a\.archived = false/, 'listing is scoped to the workspace');
  assert.match(inventory, /FOR UPDATE/, 'reassignment locks the row');
  assert.match(inventory, /expectedVersion/, 'reassignment checks the version');
});

test('a ticket names only equipment that belongs to the person it is for (F6-A2b)', () => {
  assert.equal(ticketEquipmentProblem({ assignedMemberId: 'rosa', archived: false }, 'rosa'), null);
  assert.match(ticketEquipmentProblem(null, 'rosa') ?? '', /no existe/);
  assert.match(ticketEquipmentProblem({ assignedMemberId: 'rosa', archived: true }, 'rosa') ?? '', /dado de baja/);
  assert.match(
    ticketEquipmentProblem({ assignedMemberId: 'pedro', archived: false }, 'rosa') ?? '',
    /asignado a la persona/,
  );
  assert.match(
    ticketEquipmentProblem({ assignedMemberId: null, archived: false }, 'rosa') ?? '',
    /asignado a la persona/,
  );
  assert.match(
    ticketEquipmentProblem({ assignedMemberId: 'rosa', archived: false }, null) ?? '',
    /asignado a la persona/,
    'a ticket without a client account cannot name equipment',
  );
  assert.equal(
    equipmentLabel({ assetTag: 'NB-0042', name: 'Computador NB-0042', category: 'Computador' }),
    'NB-0042 · Computador',
  );
  assert.equal(
    equipmentLabel({ assetTag: null, name: 'Impresora del piso 3', category: 'Equipo' }),
    'Impresora del piso 3',
  );
});

test('a new ticket may carry the equipment id, checked inside the creation transaction', () => {
  const base = {
    operationId: '0b6f3a3e-9d0c-4a51-8f2e-6d7c5b4a3f21',
    subject: 'El notebook no enciende',
    department: 'Soporte',
    body: 'No prende desde esta mañana.',
  };
  assert.equal(createTicketSchema.safeParse(base).success, true);
  assert.equal(
    createTicketSchema.safeParse({ ...base, assetId: '6f1b8a52-3c1d-4f7e-9a10-2b5c8d9e0f11' }).success,
    true,
  );
  assert.equal(createTicketSchema.safeParse({ ...base, assetId: 'NB-0042' }).success, false);
  const route = readFileSync('app/api/tickets/route.ts', 'utf8').replace(/\s+/g, ' ');
  const insert = route.indexOf('INSERT INTO tickets'),
    link = route.indexOf('linkTicketEquipment(tx, fresh,');
  assert.ok(insert > 0 && link > insert, 'linked after the ticket exists, in the same transaction');
  assert.match(route, /requesterMemberId: requester\.requesterMemberId/, 'checked against the ticket requester');
});

test('own and ticket equipment routes are reachable in a workspace, before the equipment id route', () => {
  const find = (path: string) => WORKSPACE_ROUTE_REGISTRY.find(item => item.pattern.test(path));
  const mine = find('equipment/mine');
  assert.equal(
    typeof (mine?.handlers as Record<string, unknown>).GET,
    'function',
    'equipment/mine is not the [id] route',
  );
  assert.deepEqual(find('tickets/12/equipment')?.names, ['id']);
  assert.equal(typeof (find('tickets/12/equipment')?.handlers as Record<string, unknown>).GET, 'function');
  const inventory = readFileSync('lib/equipment-inventory.ts', 'utf8').replace(/\s+/g, ' ');
  assert.match(
    inventory,
    /a\."assignedContactMemberId" = \$2 AND a\.archived = false/,
    'mine = assigned to me, active',
  );
  assert.match(inventory, /await getTicket\(access, ticketId\)/, 'ticket equipment follows ticket access');
});
