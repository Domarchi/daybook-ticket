import { acquireTicketWorkLock } from './work-lock';
import { recordSecurityEvent } from './security';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import type { Database } from '../db/database';
import { db, ApiError } from './server';
import { requireAdmin, requireStaff, type AccessContext } from './access';
import { lockAccess, lockTicket, operationHash, recordEvent } from './ticket-mutations';
import { linkContractAttachments } from './attachments';
import {
  serviceSchemas,
  type ServiceResource,
  type ServiceEntity,
  type ServicePage,
  type TicketServiceContext,
  type CustomerAsset,
  type ServiceContract,
  type ServiceReminderConfig,
  type ServiceReminder,
  ticketContextSchema,
  contractDocumentsSchema,
} from './service-context-model';

const tables: Record<ServiceResource, string> = {
  profiles: 'companyProfiles',
  sites: 'companySites',
  assets: 'customerAssets',
  services: 'customerServices',
  contracts: 'serviceContracts',
};
const fields: Record<ServiceResource, string[]> = {
  profiles: ['companyId', 'legalName', 'taxId', 'industry', 'website', 'primaryContactMemberId', 'notes'],
  sites: ['companyId', 'name', 'address', 'primaryContactMemberId', 'notes', 'archived'],
  assets: [
    'companyId',
    'name',
    'category',
    'vendor',
    'model',
    'serial',
    'siteId',
    'assignedContactMemberId',
    'responsibleMemberId',
    'warrantyUntil',
    'notes',
    'archived',
  ],
  services: ['companyId', 'name', 'description', 'responsibleMemberId', 'notes', 'archived'],
  contracts: [
    'companyId',
    'name',
    'reference',
    'provider',
    'startsOn',
    'endsOn',
    'renewalOn',
    'responsibleMemberId',
    'serviceIds',
    'notes',
    'archived',
  ],
};
const uuid = z.string().uuid();
const resourceSchema = z.enum(['profiles', 'sites', 'assets', 'services', 'contracts']);
const reserved = new Set(['expectedVersion', 'operationId', 'resource']);
type Row = Record<string, unknown> & {
  id: string;
  companyId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};
function view(resource: ServiceResource, row: Record<string, unknown>): ServiceEntity {
  const result: Record<string, unknown> = { ...row, id: row.id ?? row.companyId };
  delete result.ownerId;
  if (resource === 'contracts') {
    result.serviceIds = JSON.parse(String(row.serviceIdsJson || '[]'));
    delete result.serviceIdsJson;
  }
  return result as unknown as ServiceEntity;
}
function payload(resource: ServiceResource, input: Record<string, unknown>) {
  return Object.fromEntries(fields[resource].filter(key => key in input).map(key => [key, input[key]]));
}
async function company(tx: PoolClient, access: AccessContext, companyId: string) {
  const value = (
    await tx.query(
      'SELECT id FROM "customerCompanies" WHERE id=$1 AND "ownerId"=$2 AND "organizationId"=$3 FOR SHARE',
      [companyId, access.ownerId, access.organizationId],
    )
  ).rows[0];
  if (!value) throw new ApiError(404, 'La empresa no existe en este espacio.');
}
async function references(
  tx: PoolClient,
  access: AccessContext,
  resource: ServiceResource,
  data: Record<string, unknown>,
) {
  await company(tx, access, String(data.companyId));
  for (const key of ['primaryContactMemberId', 'assignedContactMemberId', 'responsibleMemberId']) {
    if (!data[key]) continue;
    const internal = key === 'responsibleMemberId';
    const clause = internal
      ? `role IN ('owner','admin','agent') AND "userId" IS NOT NULL`
      : `role='client' AND "customerCompanyId"=$4`;
    const row = (
      await tx.query(
        `SELECT id FROM members WHERE id=$1 AND "ownerId"=$2 AND "organizationId"=$3 AND status='active' AND ${clause}`,
        internal
          ? [data[key], access.ownerId, access.organizationId]
          : [data[key], access.ownerId, access.organizationId, data.companyId],
      )
    ).rows[0];
    if (!row)
      throw new ApiError(
        400,
        internal ? 'Selecciona un responsable activo del equipo.' : 'Selecciona un contacto activo de esta empresa.',
      );
  }
  if (resource === 'assets' && data.siteId) {
    if (
      !(
        await tx.query('SELECT id FROM "companySites" WHERE id=$1 AND "ownerId"=$2 AND "companyId"=$3', [
          data.siteId,
          access.ownerId,
          data.companyId,
        ])
      ).rows[0]
    )
      throw new ApiError(400, 'La sede no pertenece a esta empresa.');
  }
  if (resource === 'contracts') {
    const ids = data.serviceIds as string[];
    if (
      ids.length &&
      (
        await tx.query(
          'SELECT id FROM "customerServices" WHERE id=ANY($1::text[]) AND "ownerId"=$2 AND "companyId"=$3',
          [ids, access.ownerId, data.companyId],
        )
      ).rows.length !== ids.length
    )
      throw new ApiError(400, 'Selecciona servicios de esta empresa.');
  }
}
async function audit(
  tx: PoolClient,
  access: AccessContext,
  resource: string,
  id: string,
  companyId: string,
  before: unknown,
  after: unknown,
) {
  await tx.query(
    'INSERT INTO "serviceContextEvents" (id,"ownerId","companyId",resource,"resourceId","actorMemberId","beforeJson","afterJson","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [
      randomUUID(),
      access.ownerId,
      companyId,
      resource,
      id,
      access.member.id,
      before === null ? null : JSON.stringify(before),
      JSON.stringify(after),
      new Date().toISOString(),
    ],
  );
}
async function operation<T>(
  access: AccessContext,
  operationId: string,
  kind: string,
  input: unknown,
  work: (tx: PoolClient, fresh: AccessContext) => Promise<T>,
  database: Database = db(),
): Promise<T> {
  return database.transaction(async tx => {
    await acquireTicketWorkLock(tx, access.ownerId);
    const fresh = requireAdmin(await lockAccess(tx, access));
    const hash = operationHash(input);
    await tx.query(
      'INSERT INTO operations ("operationId","ownerId","memberId",kind,"requestHash","resultJson","createdAt") VALUES ($1,$2,$3,$4,$5,\'null\',$6) ON CONFLICT("operationId") DO NOTHING',
      [operationId, access.ownerId, access.member.id, kind, hash, new Date().toISOString()],
    );
    const old = (await tx.query('SELECT * FROM operations WHERE "operationId"=$1 FOR UPDATE', [operationId])).rows[0];
    if (
      old.ownerId !== access.ownerId ||
      old.memberId !== access.member.id ||
      old.kind !== kind ||
      old.requestHash !== hash
    )
      throw new ApiError(409, 'Este envío ya se utilizó con otros datos.');
    if (old.resultJson !== 'null') return JSON.parse(old.resultJson) as T;
    const result = await work(tx, fresh);
    await tx.query('UPDATE operations SET "resultJson"=$1 WHERE "operationId"=$2', [
      JSON.stringify(result),
      operationId,
    ]);
    return result;
  });
}

export async function listServiceContext(
  access: AccessContext,
  query: URLSearchParams,
  database: Database = db(),
): Promise<ServicePage> {
  const resource = resourceSchema.parse(query.get('resource') || 'assets'),
    companyId = uuid.parse(query.get('companyId'));
  const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .parse(query.get('limit') || 20),
    cursor = query.get('cursor') ? uuid.parse(query.get('cursor')) : null;
  const q = z
      .string()
      .trim()
      .max(160)
      .parse(query.get('q') || ''),
    archived = query.get('includeArchived') === 'true';
  return database.transaction(async tx => {
    await acquireTicketWorkLock(tx, access.ownerId);
    const fresh = requireStaff(await lockAccess(tx, access));
    await company(tx, fresh, companyId);
    if (resource === 'profiles') {
      const row = (
        await tx.query('SELECT * FROM "companyProfiles" WHERE "companyId"=$1 AND "ownerId"=$2', [
          companyId,
          access.ownerId,
        ])
      ).rows[0];
      return {
        items: [
          view(
            resource,
            row || {
              ...serviceSchemas.profiles.parse({ companyId }),
              id: companyId,
              version: 0,
              createdAt: '',
              updatedAt: '',
            },
          ),
        ],
        nextCursor: null,
      };
    }
    const rows = (
      await tx.query(
        `SELECT * FROM "${tables[resource]}" WHERE "ownerId"=$1 AND "companyId"=$2 AND ($3::text IS NULL OR id>$3) AND ($4::boolean OR NOT archived) AND ($5='' OR name ILIKE '%' || $5 || '%') ORDER BY id LIMIT $6`,
        [access.ownerId, companyId, cursor, archived, q, limit + 1],
      )
    ).rows;
    const items = rows.slice(0, limit).map(row => view(resource, row));
    return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
  });
}
export async function createServiceContext(
  access: AccessContext,
  input: Record<string, unknown>,
  database: Database = db(),
) {
  const resource = resourceSchema.parse(input.resource),
    operationId = uuid.parse(input.operationId);
  for (const key of Object.keys(input))
    if (!reserved.has(key) && !fields[resource].includes(key))
      throw new ApiError(400, 'El formulario contiene campos no permitidos.');
  const data = serviceSchemas[resource].parse(payload(resource, input)) as unknown as Record<string, unknown>;
  if (resource === 'profiles') throw new ApiError(400, 'Edita la ficha existente de la empresa.');
  return operation(
    access,
    operationId,
    `service_context:${resource}`,
    { resource, data },
    async (tx, fresh) => {
      await references(tx, fresh, resource, data);
      const id = randomUUID(),
        now = new Date().toISOString();
      const values: Record<string, unknown> = {
        ...data,
        id,
        ownerId: access.ownerId,
        version: 0,
        createdAt: now,
        updatedAt: now,
      };
      if (resource === 'contracts') {
        values.serviceIdsJson = JSON.stringify(data.serviceIds);
        delete values.serviceIds;
      }
      if (resource === 'assets' || resource === 'contracts') values.reminderBaselineAt = now;
      const keys = Object.keys(values),
        params = keys.map((_, i) => `$${i + 1}`);
      const row = (
        await tx.query(
          `INSERT INTO "${tables[resource]}" (${keys.map(key => `"${key}"`).join(',')}) VALUES (${params.join(',')}) RETURNING *`,
          Object.values(values),
        )
      ).rows[0];
      const item = view(resource, row);
      await audit(tx, fresh, resource, id, String(data.companyId), null, item);
      return { item };
    },
    database,
  );
}
export async function updateServiceContext(
  access: AccessContext,
  resourceValue: string,
  idValue: string,
  input: Record<string, unknown>,
  database: Database = db(),
) {
  const resource = resourceSchema.parse(resourceValue),
    id = uuid.parse(idValue),
    expectedVersion = z.number().int().min(0).parse(input.expectedVersion);
  for (const key of Object.keys(input))
    if (key !== 'expectedVersion' && !fields[resource].includes(key))
      throw new ApiError(400, 'El formulario contiene campos no permitidos.');
  return database.transaction(async tx => {
    await acquireTicketWorkLock(tx, access.ownerId);
    const fresh = requireAdmin(await lockAccess(tx, access));
    const key = resource === 'profiles' ? 'companyId' : 'id';
    if (
      resource === 'profiles' &&
      !(
        await tx.query(
          'SELECT id FROM "customerCompanies" WHERE id=$1 AND "ownerId"=$2 AND "organizationId"=$3 FOR UPDATE',
          [id, access.ownerId, access.organizationId],
        )
      ).rows[0]
    )
      throw new ApiError(404, 'La empresa no existe.');
    const old = (
      await tx.query(`SELECT * FROM "${tables[resource]}" WHERE "${key}"=$1 AND "ownerId"=$2 FOR UPDATE`, [
        id,
        access.ownerId,
      ])
    ).rows[0] as Row | undefined;
    if (!old && resource !== 'profiles') throw new ApiError(404, 'El registro no existe.');
    const current =
      resource === 'profiles' && !old
        ? { ...serviceSchemas.profiles.parse({ companyId: id }), version: 0, createdAt: '' }
        : view(resource, old!);
    if (current.version !== expectedVersion)
      throw new ApiError(409, 'Este registro cambió. Actualiza antes de guardar.');
    const data = serviceSchemas[resource].parse({
      ...payload(resource, current as unknown as Record<string, unknown>),
      ...payload(resource, input),
    }) as unknown as Record<string, unknown>;
    if (data.companyId !== current.companyId)
      throw new ApiError(400, 'La empresa de un registro histórico no puede trasladarse.');
    await references(tx, fresh, resource, data);
    const now = new Date().toISOString();
    if (!old) {
      const keys = Object.keys(data),
        values = [...Object.values(data), access.ownerId, 1, now];
      const row = (
        await tx.query(
          `INSERT INTO "companyProfiles" (${keys.map(k => `"${k}"`).join(',')},"ownerId",version,"createdAt","updatedAt") VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')},$${keys.length + 1},$${keys.length + 2},$${keys.length + 3},$${keys.length + 3}) RETURNING *`,
          values,
        )
      ).rows[0];
      const item = view(resource, row);
      await audit(tx, fresh, resource, id, id, null, item);
      return { item };
    }
    const values: Record<string, unknown> = { ...data, version: expectedVersion + 1, updatedAt: now };
    delete values.companyId;
    if (resource === 'contracts') {
      values.serviceIdsJson = JSON.stringify(data.serviceIds);
      delete values.serviceIds;
      if (data.endsOn !== old.endsOn || data.renewalOn !== old.renewalOn) values.reminderBaselineAt = now;
    }
    if (resource === 'assets' && data.warrantyUntil !== old.warrantyUntil) values.reminderBaselineAt = now;
    const keys = Object.keys(values),
      params = [...Object.values(values), id, access.ownerId];
    const row = (
      await tx.query(
        `UPDATE "${tables[resource]}" SET ${keys.map((k, i) => `"${k}"=$${i + 1}`).join(',')} WHERE "${key}"=$${keys.length + 1} AND "ownerId"=$${keys.length + 2} RETURNING *`,
        params,
      )
    ).rows[0];
    const item = view(resource, row);
    await audit(tx, fresh, resource, id, current.companyId, current, item);
    return { item };
  });
}
async function ticketContext(tx: PoolClient, access: AccessContext, ticketId: number): Promise<TicketServiceContext> {
  const ticket = await lockTicket(tx, access, ticketId);
  const version =
    (
      await tx.query('SELECT version FROM "ticketServiceContext" WHERE "ticketId"=$1 AND "ownerId"=$2', [
        ticketId,
        access.ownerId,
      ])
    ).rows[0]?.version || 0;
  const assets = (
    await tx.query(
      'SELECT a.* FROM "ticketAssetLinks" l JOIN "customerAssets" a ON a.id=l."assetId" AND a."ownerId"=l."ownerId" WHERE l."ticketId"=$1 AND l."ownerId"=$2 AND a."companyId"=$3 ORDER BY a.name,a.id',
      [ticketId, access.ownerId, ticket.customerCompanyId],
    )
  ).rows.map(row => view('assets', row) as CustomerAsset);
  const contracts = (
    await tx.query(
      'SELECT a.* FROM "ticketContractLinks" l JOIN "serviceContracts" a ON a.id=l."contractId" AND a."ownerId"=l."ownerId" WHERE l."ticketId"=$1 AND l."ownerId"=$2 AND a."companyId"=$3 ORDER BY a.name,a.id',
      [ticketId, access.ownerId, ticket.customerCompanyId],
    )
  ).rows.map(row => view('contracts', row) as ServiceContract);
  return { version, assetIds: assets.map(a => a.id), contractIds: contracts.map(a => a.id), assets, contracts };
}
export async function readTicketServiceContext(access: AccessContext, ticketId: number, database: Database = db()) {
  return database.transaction(async tx => {
    await acquireTicketWorkLock(tx, access.ownerId);
    return ticketContext(tx, requireStaff(await lockAccess(tx, access)), ticketId);
  });
}
export async function saveTicketServiceContext(
  access: AccessContext,
  ticketId: number,
  input: z.infer<typeof ticketContextSchema>,
  database: Database = db(),
) {
  return database.transaction(async tx => {
    await acquireTicketWorkLock(tx, access.ownerId);
    const fresh = requireStaff(await lockAccess(tx, access)),
      ticket = await lockTicket(tx, fresh, ticketId),
      before = await ticketContext(tx, fresh, ticketId);
    if (before.version !== input.expectedVersion)
      throw new ApiError(409, 'Los vínculos cambiaron. Actualiza antes de guardarlos.');
    if ((input.assetIds.length || input.contractIds.length) && !ticket.customerCompanyId)
      throw new ApiError(400, 'Vincula primero el ticket a una empresa.');
    for (const [table, ids] of [
      ['customerAssets', input.assetIds],
      ['serviceContracts', input.contractIds],
    ] as const) {
      if (
        ids.length &&
        (
          await tx.query(
            `SELECT id FROM "${table}" WHERE "ownerId"=$1 AND "companyId"=$2 AND id=ANY($3::text[]) FOR SHARE`,
            [access.ownerId, ticket.customerCompanyId, ids],
          )
        ).rows.length !== ids.length
      )
        throw new ApiError(400, 'Selecciona equipos y contratos de la empresa del ticket.');
    }
    if (
      JSON.stringify([...input.assetIds].sort()) === JSON.stringify([...before.assetIds].sort()) &&
      JSON.stringify([...input.contractIds].sort()) === JSON.stringify([...before.contractIds].sort())
    )
      return before;
    const now = new Date().toISOString();
    await tx.query(
      'INSERT INTO "ticketServiceContext" ("ticketId","ownerId",version,"updatedAt") VALUES ($1,$2,1,$3) ON CONFLICT("ticketId") DO UPDATE SET version="ticketServiceContext".version+1,"updatedAt"=EXCLUDED."updatedAt"',
      [ticketId, access.ownerId, now],
    );
    await tx.query('DELETE FROM "ticketAssetLinks" WHERE "ticketId"=$1 AND "ownerId"=$2', [ticketId, access.ownerId]);
    await tx.query('DELETE FROM "ticketContractLinks" WHERE "ticketId"=$1 AND "ownerId"=$2', [
      ticketId,
      access.ownerId,
    ]);
    for (const [column, table, ids] of [
      ['assetId', 'ticketAssetLinks', input.assetIds],
      ['contractId', 'ticketContractLinks', input.contractIds],
    ] as const)
      for (const id of ids)
        await tx.query(
          `INSERT INTO "${table}" ("ticketId","${column}","ownerId","createdAt","createdBy") VALUES ($1,$2,$3,$4,$5)`,
          [ticketId, id, access.ownerId, now, access.member.id],
        );
    await recordEvent(
      tx,
      fresh,
      ticketId,
      'service_context',
      { assetIds: before.assetIds, contractIds: before.contractIds },
      { assetIds: input.assetIds, contractIds: input.contractIds },
    );
    return ticketContext(tx, fresh, ticketId);
  });
}
export async function assetTicketHistory(
  access: AccessContext,
  idValue: string,
  cursorValue: string | null,
  database: Database = db(),
) {
  const id = uuid.parse(idValue),
    cursor = cursorValue ? z.coerce.number().int().positive().parse(cursorValue) : 2147483647;
  return database.transaction(async tx => {
    await acquireTicketWorkLock(tx, access.ownerId);
    const fresh = requireStaff(await lockAccess(tx, access));
    const asset = (
      await tx.query('SELECT "companyId" FROM "customerAssets" WHERE id=$1 AND "ownerId"=$2', [id, access.ownerId])
    ).rows[0];
    if (!asset) throw new ApiError(404, 'El equipo no existe.');
    await company(tx, fresh, asset.companyId);
    const rows = (
      await tx.query(
        'SELECT t.id,t.subject,t.status,t.priority,t.department,t."createdAt",t."updatedAt",t."dueAt",t.assignee FROM "ticketAssetLinks" l JOIN tickets t ON t.id=l."ticketId" AND t."ownerId"=l."ownerId" WHERE l."assetId"=$1 AND l."ownerId"=$2 AND t."customerCompanyId"=$3 AND t.id<$4 ORDER BY t.id DESC LIMIT 21',
        [id, access.ownerId, asset.companyId, cursor],
      )
    ).rows;
    return { items: rows.slice(0, 20), nextCursor: rows.length > 20 ? String(rows[19].id) : null };
  });
}
export async function listContractDocuments(access: AccessContext, idValue: string, database: Database = db()) {
  const id = uuid.parse(idValue);
  return database.transaction(async tx => {
    await acquireTicketWorkLock(tx, access.ownerId);
    requireStaff(await lockAccess(tx, access));
    if (
      !(await tx.query('SELECT id FROM "serviceContracts" WHERE id=$1 AND "ownerId"=$2', [id, access.ownerId])).rows[0]
    )
      throw new ApiError(404, 'El contrato no existe.');
    const rows = (
      await tx.query(
        'SELECT id,name,size,"contentType" FROM attachments WHERE "contractId"=$1 AND "ownerId"=$2 AND kind=\'contract\' AND status=\'attached\' ORDER BY "createdAt",id LIMIT 100',
        [id, access.ownerId],
      )
    ).rows;
    return { attachments: rows };
  });
}
export async function attachContractDocuments(
  access: AccessContext,
  idValue: string,
  input: z.infer<typeof contractDocumentsSchema>,
  database: Database = db(),
) {
  const id = uuid.parse(idValue);
  return operation(
    access,
    input.operationId,
    'contract_documents',
    { id, ...input },
    async (tx, fresh) => {
      const contract = (
        await tx.query('SELECT id,"companyId" FROM "serviceContracts" WHERE id=$1 AND "ownerId"=$2 FOR UPDATE', [
          id,
          access.ownerId,
        ])
      ).rows[0];
      if (!contract) throw new ApiError(404, 'El contrato no existe.');
      await linkContractAttachments(tx, fresh, { ids: input.attachmentIds, draftId: input.draftId, contractId: id });
      await audit(tx, fresh, 'contract_documents', id, contract.companyId, null, {
        attachmentIds: input.attachmentIds,
      });
      return { attached: input.attachmentIds };
    },
    database,
  );
}
export async function getServiceReminderConfig(
  access: AccessContext,
  database: Database = db(),
): Promise<ServiceReminderConfig & { configured: boolean; health: Record<string, unknown> | null }> {
  return database.transaction(async tx => {
    await acquireTicketWorkLock(tx, access.ownerId);
    requireStaff(await lockAccess(tx, access));
    const row = (
      await tx.query(
        'SELECT enabled,"activatedAt",version,"updatedAt" FROM "serviceContextNotificationSettings" WHERE "ownerId"=$1',
        [access.ownerId],
      )
    ).rows[0];
    const health =
      (
        await tx.query(
          'SELECT "lastStartedAt","lastSucceededAt","lastFailedAt","lastErrorCode","lastInvocationId" FROM "serviceContextJobHealth" WHERE "ownerId"=$1',
          [access.ownerId],
        )
      ).rows[0] || null;
    return {
      ...(row || { enabled: false, activatedAt: null, version: 0, updatedAt: null }),
      configured: serviceReminderJobConfigured(),
      health,
    };
  });
}
export function serviceReminderJobConfigured() {
  return (
    process.env.DAYBOOK_SERVICE_CONTEXT_JOB_ENABLED === 'true' &&
    (process.env.DAYBOOK_SERVICE_CONTEXT_JOB_SECRET?.length || 0) >= 32
  );
}
export async function saveServiceReminderConfig(
  access: AccessContext,
  input: { expectedVersion: number; enabled: boolean },
  database: Database = db(),
) {
  if (input.enabled && !serviceReminderJobConfigured())
    throw new ApiError(503, 'La programación de estos avisos aún no está disponible.');
  return database.transaction(async tx => {
    await acquireTicketWorkLock(tx, access.ownerId);
    const fresh = requireAdmin(await lockAccess(tx, access));
    const now = new Date().toISOString();
    await tx.query(
      'INSERT INTO "serviceContextNotificationSettings" ("ownerId",enabled,version,"updatedAt") VALUES ($1,false,0,$2) ON CONFLICT DO NOTHING',
      [access.ownerId, now],
    );
    const old = (
      await tx.query('SELECT * FROM "serviceContextNotificationSettings" WHERE "ownerId"=$1 FOR UPDATE', [
        access.ownerId,
      ])
    ).rows[0];
    if (old.version !== input.expectedVersion)
      throw new ApiError(409, 'La configuración cambió. Actualiza antes de guardar.');
    await recordSecurityEvent(tx, fresh, 'configuration_changed');
    return (
      await tx.query(
        'UPDATE "serviceContextNotificationSettings" SET enabled=$1,"activatedAt"=$2,version=version+1,"updatedAt"=$3 WHERE "ownerId"=$4 RETURNING enabled,"activatedAt",version,"updatedAt"',
        [input.enabled, input.enabled && !old.enabled ? now : old.activatedAt, now, access.ownerId],
      )
    ).rows[0];
  });
}
export async function listServiceReminders(
  access: AccessContext,
  query: URLSearchParams,
  database: Database = db(),
): Promise<ServicePage<ServiceReminder>> {
  const companyId = query.get('companyId') ? uuid.parse(query.get('companyId')) : null,
    cursor = query.get('cursor') ? uuid.parse(query.get('cursor')) : null;
  return database.transaction(async tx => {
    await acquireTicketWorkLock(tx, access.ownerId);
    requireStaff(await lockAccess(tx, access));
    const rows = (
      await tx.query(
        'SELECT r.id,r."entityKind",r."entityId",r."entityName",r."companyId",r."dateValue",r.stage,r."readAt",r."createdAt" FROM "serviceContextReminders" r JOIN "customerCompanies" c ON c.id=r."companyId" AND c."ownerId"=r."ownerId" WHERE r."ownerId"=$1 AND r."recipientMemberId"=$2 AND ($3::text IS NULL OR r."companyId"=$3) AND ($4::text IS NULL OR (r."createdAt",r.id)<(SELECT cursor."createdAt",cursor.id FROM "serviceContextReminders" cursor WHERE cursor.id=$4 AND cursor."ownerId"=$1 AND cursor."recipientMemberId"=$2)) ORDER BY r."createdAt" DESC,r.id DESC LIMIT 21',
        [access.ownerId, access.member.id, companyId, cursor],
      )
    ).rows as ServiceReminder[];
    return { items: rows.slice(0, 20), nextCursor: rows.length > 20 ? rows[19].id : null };
  });
}
export async function markServiceReminderRead(access: AccessContext, idValue: string, database: Database = db()) {
  const id = uuid.parse(idValue);
  return database.transaction(async tx => {
    await acquireTicketWorkLock(tx, access.ownerId);
    requireStaff(await lockAccess(tx, access));
    const row = (
      await tx.query(
        'UPDATE "serviceContextReminders" SET "readAt"=COALESCE("readAt",$1) WHERE id=$2 AND "ownerId"=$3 AND "recipientMemberId"=$4 RETURNING id,"readAt"',
        [new Date().toISOString(), id, access.ownerId, access.member.id],
      )
    ).rows[0];
    if (!row) throw new ApiError(404, 'El aviso no existe.');
    return row;
  });
}
