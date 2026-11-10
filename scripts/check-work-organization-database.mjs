import { seedQaWorkspaceProfiles } from './qa-workspace-profile.mjs';
/** Coordinator-only SERIAL QA integration after 0008. All fixtures roll back.
 * node --env-file=.env.test.local --import tsx scripts/check-work-organization-database.mjs
 * This script does not migrate, provision accounts, send mail or call providers.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { getDatabase, getPool } from '../db/index.ts';
import { publicMember } from '../lib/access.ts';
import {
  catalogMutationSchema,
  catalogPatchSchema,
  taskCreateSchema,
  taskPatchSchema,
  savedViewSchema,
  ticketOrganizationPatchSchema,
} from '../lib/work-organization-model.ts';
import {
  createOrganizationCatalog,
  patchOrganizationCatalog,
  readOrganizationCatalog,
  parseOrganizationCatalogQuery,
  prepareTicketOrganization,
  saveTicketOrganization,
  readTicketOrganization,
  patchTicketOrganization,
  createTicketTask,
  listTicketTasks,
  patchTicketTask,
  saveTicketView,
  savedTicketViews,
  deleteTicketView,
} from '../lib/work-organization.ts';

assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
assert.equal(
  new URL(process.env.DATABASE_URL).hostname,
  'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech',
);
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/daybook_ticket');
for (const name of ['RESEND_API_KEY', 'RESEND_INBOUND_API_KEY', 'VAPID_PRIVATE_KEY']) assert.ok(!process.env[name]);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 }),
  tx = await pool.connect(),
  database = getDatabase(),
  originalTransaction = database.transaction.bind(database);
const token = randomUUID(),
  ownerId = `qa-organization-${token}`,
  organizationId = `qa-organization-${token}`,
  otherOwnerId = `qa-organization-other-${token}`,
  otherOrganizationId = `qa-organization-other-${token}`;
const companyId = randomUUID(),
  otherCompanyId = randomUUID(),
  now = new Date().toISOString(),
  dueAt = new Date(Date.now() + 86400000).toISOString();
let savepoint = 0,
  passed = 0,
  externalRequests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  externalRequests++;
  throw new Error('External requests forbidden in organization QA.');
};
database.transaction = async work => {
  const point = `organization_check_${++savepoint}`;
  await tx.query(`SAVEPOINT ${point}`);
  try {
    const result = await work(tx);
    await tx.query(`RELEASE SAVEPOINT ${point}`);
    return result;
  } catch (error) {
    await tx.query(`ROLLBACK TO SAVEPOINT ${point}`);
    await tx.query(`RELEASE SAVEPOINT ${point}`);
    throw error;
  }
};
async function member(name, role, owner = ownerId, organization = organizationId, customerCompanyId = null) {
  const id = randomUUID();
  await tx.query(
    `INSERT INTO members (id,"organizationId","ownerId","userId",email,name,role,status,"customerCompanyId","companyAccess","createdAt","updatedAt","isTest") VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,'own',$9,$9,true)`,
    [id, organization, owner, `user-${id}`, `${id}@example.test`, name, role, customerCompanyId, now],
  );
  const row = (await tx.query('SELECT * FROM members WHERE id=$1', [id])).rows[0];
  return {
    organizationId: organization,
    ownerId: owner,
    userId: row.userId,
    role,
    member: publicMember({ ...row, hasAccount: true }),
  };
}
async function expectStatus(work, status) {
  await assert.rejects(work, error => error?.status === status);
}
const mutation = (kind, definition) => catalogMutationSchema.parse({ kind, definition });
try {
  await tx.query('BEGIN');
  for (const [id, owner] of [
    [organizationId, ownerId],
    [otherOrganizationId, otherOwnerId],
  ])
    await tx.query('INSERT INTO organizations (id,"ownerId",name,"createdAt") VALUES ($1,$2,$3,$4)', [
      id,
      owner,
      'Organización ficticia',
      now,
    ]);
  await seedQaWorkspaceProfiles(tx, [ownerId, otherOwnerId], now);
  for (const id of [companyId, otherCompanyId])
    await tx.query(
      'INSERT INTO "customerCompanies" (id,"organizationId","ownerId",name,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$5)',
      [id, organizationId, ownerId, `Empresa ${id}`, now],
    );
  const admin = await member('QA administrador', 'owner'),
    agent = await member('QA agente', 'agent'),
    client = await member('QA cliente', 'client', ownerId, organizationId, companyId),
    outsider = await member('QA ajeno', 'agent', otherOwnerId, otherOrganizationId);
  const ticket = (
    await tx.query(
      `INSERT INTO tickets ("ownerId","creationKey",subject,"requesterName","requesterEmail","requesterMemberId","customerCompanyId",department,priority,status,"createdAt","updatedAt","dueAt","isTest") VALUES ($1,$2,'Ticket ficticio','QA cliente',$3,$4,$5,'Soporte','normal','open',$6,$6,$7,true) RETURNING *`,
      [ownerId, randomUUID(), client.member.email, client.member.id, companyId, now, dueAt],
    )
  ).rows[0];
  const publicField = await createOrganizationCatalog(
    admin,
    mutation('field', { name: 'Equipo afectado', type: 'text', required: true, visibility: 'public' }),
  );
  const privateField = await createOrganizationCatalog(
    admin,
    mutation('field', { name: 'Contexto interno secreto', type: 'textarea', required: false }),
  );
  const type = await createOrganizationCatalog(admin, mutation('requestType', { name: 'Problema de acceso' }));
  const tag = await createOrganizationCatalog(admin, mutation('tag', { name: 'Acceso', color: 'gold' }));
  const form = await createOrganizationCatalog(
    admin,
    mutation('form', {
      name: 'Acceso empresa',
      customerCompanyId: companyId,
      requestTypeId: type.id,
      fieldIds: [publicField.id, privateField.id],
      published: true,
    }),
  );
  await expectStatus(() => createOrganizationCatalog(agent, mutation('tag', { name: 'Prohibido' })), 403);
  await expectStatus(
    () => createOrganizationCatalog(client, mutation('field', { name: 'Prohibido', type: 'text' })),
    403,
  );
  const clientCatalog = await readOrganizationCatalog(client, parseOrganizationCatalogQuery(new URLSearchParams()));
  assert.equal(clientCatalog.catalog.tags.length, 0);
  assert.equal(clientCatalog.catalog.requestTypes.length, 1);
  assert.ok(!JSON.stringify(clientCatalog).includes(privateField.id));
  assert.ok(!JSON.stringify(clientCatalog).includes('Contexto interno secreto'));
  passed++;
  await expectStatus(
    () =>
      prepareTicketOrganization(tx, client, {
        customerCompanyId: companyId,
        requestTypeId: type.id,
        fieldValues: { [privateField.id]: 'inyectado' },
      }),
    400,
  );
  await expectStatus(
    () =>
      prepareTicketOrganization(tx, client, { customerCompanyId: companyId, requestTypeId: type.id, fieldValues: {} }),
    400,
  );
  await expectStatus(
    () =>
      prepareTicketOrganization(tx, client, {
        customerCompanyId: otherCompanyId,
        requestTypeId: type.id,
        fieldValues: { [publicField.id]: 'Equipo 1' },
      }),
    400,
  );
  const prepared = await prepareTicketOrganization(tx, client, {
    customerCompanyId: companyId,
    requestTypeId: type.id,
    fieldValues: { [publicField.id]: 'Equipo 1' },
  });
  await saveTicketOrganization(tx, client, ticket.id, prepared);
  assert.equal((await readTicketOrganization(client, ticket.id)).values[publicField.id].value, 'Equipo 1');
  passed++;
  const initial = await readTicketOrganization(agent, ticket.id);
  const modified = await patchTicketOrganization(
    agent,
    ticket.id,
    ticketOrganizationPatchSchema.parse({
      expectedVersion: initial.version,
      tagIds: [tag.id],
      waitReason: 'Esperando revisión interna',
      fieldValues: { [publicField.id]: 'Equipo 2' },
    }),
  );
  assert.equal(modified.tags.length, 1);
  assert.equal(modified.waitReason, 'Esperando revisión interna');
  const publicMetadata = await readTicketOrganization(client, ticket.id);
  assert.equal(publicMetadata.tags.length, 0);
  assert.equal(publicMetadata.waitReason, undefined);
  await expectStatus(
    () =>
      patchTicketOrganization(
        client,
        ticket.id,
        ticketOrganizationPatchSchema.parse({ expectedVersion: modified.version, waitReason: 'no' }),
      ),
    403,
  );
  await expectStatus(() => readTicketOrganization(outsider, ticket.id), 404);
  await expectStatus(
    () =>
      patchTicketOrganization(
        agent,
        ticket.id,
        ticketOrganizationPatchSchema.parse({ expectedVersion: initial.version, waitReason: 'obsoleto' }),
      ),
    409,
  );
  passed++;
  const updatedField = await patchOrganizationCatalog(
    admin,
    catalogPatchSchema.parse({
      id: publicField.id,
      expectedVersion: publicField.version,
      definition: {
        name: 'Equipo nuevo',
        type: 'select',
        required: true,
        visibility: 'public',
        options: ['Equipo A', 'Equipo B'],
      },
    }),
  );
  const historical = await readTicketOrganization(client, ticket.id);
  assert.equal(historical.values[publicField.id].definition.type, 'text');
  assert.equal(historical.values[publicField.id].definition.version, 0);
  assert.equal(historical.values[publicField.id].value, 'Equipo 2');
  await patchOrganizationCatalog(
    admin,
    catalogPatchSchema.parse({
      id: form.id,
      expectedVersion: form.version,
      definition: {
        name: form.name,
        customerCompanyId: companyId,
        requestTypeId: type.id,
        fieldIds: [publicField.id, privateField.id],
        published: true,
      },
    }),
  );
  await expectStatus(
    () =>
      prepareTicketOrganization(tx, client, {
        customerCompanyId: companyId,
        requestTypeId: type.id,
        fieldValues: { [publicField.id]: 'Equipo 2' },
      }),
    400,
  );
  const next = await prepareTicketOrganization(tx, client, {
    customerCompanyId: companyId,
    requestTypeId: type.id,
    fieldValues: { [publicField.id]: 'Equipo A' },
  });
  assert.equal(next.values[publicField.id].definition.version, updatedField.version);
  passed++;
  await patchOrganizationCatalog(
    admin,
    catalogPatchSchema.parse({ id: tag.id, expectedVersion: tag.version, archived: true }),
  );
  assert.equal((await readTicketOrganization(agent, ticket.id)).tags[0].archived, true);
  const another = (
    await tx.query(
      `INSERT INTO tickets ("ownerId","creationKey",subject,"requesterName","requesterEmail","requesterMemberId","customerCompanyId",department,priority,status,"createdAt","updatedAt","dueAt","isTest") VALUES ($1,$2,'Otro ticket','QA cliente',$3,$4,$5,'Soporte','normal','open',$6,$6,$7,true) RETURNING id`,
      [ownerId, randomUUID(), client.member.email, client.member.id, companyId, now, dueAt],
    )
  ).rows[0];
  await expectStatus(
    () =>
      patchTicketOrganization(
        agent,
        another.id,
        ticketOrganizationPatchSchema.parse({ expectedVersion: 0, tagIds: [tag.id] }),
      ),
    400,
  );
  passed++;
  const input = taskCreateSchema.parse({
    operationId: randomUUID(),
    title: 'Verificar equipo',
    assigneeMemberId: agent.member.id,
    dueAt,
  });
  const task = await createTicketTask(agent, ticket.id, input),
    replay = await createTicketTask(agent, ticket.id, input);
  assert.equal(task.id, replay.id);
  await expectStatus(() => createTicketTask(agent, ticket.id, { ...input, title: 'Contenido distinto' }), 409);
  await expectStatus(() => listTicketTasks(client, ticket.id), 403);
  await expectStatus(() => listTicketTasks(outsider, ticket.id), 404);
  const completed = await patchTicketTask(
    admin,
    task.id,
    taskPatchSchema.parse({ expectedVersion: task.version, status: 'done' }),
  );
  assert.equal(completed.status, 'done');
  await expectStatus(
    () =>
      patchTicketTask(admin, task.id, taskPatchSchema.parse({ expectedVersion: task.version, status: 'cancelled' })),
    409,
  );
  const after = (
    await tx.query('SELECT status,"dueAt","slaStartedAt","slaPolicySnapshot" FROM tickets WHERE id=$1', [ticket.id])
  ).rows[0];
  assert.equal(after.status, ticket.status);
  assert.equal(after.dueAt, ticket.dueAt);
  assert.equal(after.slaStartedAt, ticket.slaStartedAt);
  assert.equal(after.slaPolicySnapshot, ticket.slaPolicySnapshot);
  passed++;
  const mine = await saveTicketView(
    agent,
    savedViewSchema.parse({ name: 'Pendientes QA', filters: { queue: 'mine' } }),
  );
  assert.equal((await savedTicketViews(agent)).length, 1);
  assert.equal((await savedTicketViews(admin)).length, 0);
  await expectStatus(() => deleteTicketView(admin, mine.id, mine.version), 409);
  await expectStatus(
    () => saveTicketView(client, savedViewSchema.parse({ name: 'No permitido', filters: { company: otherCompanyId } })),
    400,
  );
  await deleteTicketView(agent, mine.id, mine.version);
  assert.equal((await savedTicketViews(agent)).length, 0);
  passed++;
  await tx.query('UPDATE members SET "customerCompanyId"=$1 WHERE id=$2', [otherCompanyId, client.member.id]);
  await expectStatus(() => readTicketOrganization(client, ticket.id), 404);
  await tx.query("UPDATE members SET status='revoked' WHERE id=$1", [agent.member.id]);
  await expectStatus(
    () =>
      createTicketTask(agent, ticket.id, taskCreateSchema.parse({ operationId: randomUUID(), title: 'No permitido' })),
    403,
  );
  passed++;
  assert.equal(externalRequests, 0);
  console.log(JSON.stringify({ passedGroups: passed, externalDeliveries: 0, fixtures: 'rolled back in finally' }));
} finally {
  database.transaction = originalTransaction;
  globalThis.fetch = originalFetch;
  await tx.query('ROLLBACK');
  assert.equal(
    Number(
      (
        await tx.query('SELECT count(*) AS count FROM organizations WHERE id=$1 OR id=$2', [
          organizationId,
          otherOrganizationId,
        ])
      ).rows[0].count,
    ),
    0,
  );
  tx.release();
  await pool.end();
  await getPool().end();
}
