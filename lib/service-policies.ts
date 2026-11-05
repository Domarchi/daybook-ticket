import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { requireAdmin, type AccessContext } from './access';
import { ApiError } from './server';
import { lockAccess } from './ticket-mutations';
import { acquireTicketWorkLock } from './work-lock';
import { DEFAULT_SETTINGS, type TicketPriority } from './types';
import {
  addSlaHours, createLegacyServicePolicySnapshot, readServicePolicySnapshot,
  serviceCalendarSchema, slaHoursSchema, SlaCalculationError,
  type ServiceCalendar, type ServicePolicySnapshot,
} from './sla-policy';

type SlaHours = Record<TicketPriority, number>;
interface PolicyRow {
  id: string; scopeKey: string; customerCompanyId: string | null;
  calendarJson: string; slaHoursJson: string; version: number;
  createdAt: string; updatedAt: string;
}
export interface ServicePolicyView {
  id: string | null;
  scopeKey: string;
  customerCompanyId: string | null;
  version: number;
  override: boolean;
  sourceScopeKey: string;
  calendar: ServiceCalendar;
  slaHours: SlaHours;
  createdAt: string | null;
  updatedAt: string | null;
}
export const saveServicePolicySchema = z.object({
  expectedId: z.string().uuid().nullable(),
  expectedVersion: z.number().int().nonnegative(),
  calendar: serviceCalendarSchema,
  slaHours: slaHoursSchema,
}).strict();
export const deleteServicePolicySchema = z.object({
  expectedId: z.string().uuid().nullable(), expectedVersion: z.number().int().nonnegative(),
}).strict();
const scopeSchema = z.union([z.literal('default'), z.string().uuid('Selecciona una empresa válida.')]);
const columns = 'id,"scopeKey","customerCompanyId","calendarJson","slaHoursJson",version,"createdAt","updatedAt"';

function snapshot(row: PolicyRow): ServicePolicySnapshot {
  let value: ServicePolicySnapshot | null = null;
  try { value = readServicePolicySnapshot({ version: 1, calendar: JSON.parse(row.calendarJson), slaHours: JSON.parse(row.slaHoursJson) }); } catch { /* Classified below; never silently replace a stored contract. */ }
  if (!value) throw new ApiError(409, 'La política de servicio guardada necesita revisión.');
  return value;
}
function view(row: PolicyRow): ServicePolicyView {
  const policy = snapshot(row);
  return { id: row.id, scopeKey: row.scopeKey, customerCompanyId: row.customerCompanyId, version: row.version,
    override: true, sourceScopeKey: row.scopeKey, calendar: policy.calendar, slaHours: policy.slaHours,
    createdAt: row.createdAt, updatedAt: row.updatedAt };
}
async function settingsData(tx: PoolClient, ownerId: string, locking = false): Promise<Record<string, unknown>> {
  const row = (await tx.query<{ data: string }>(`SELECT data FROM settings WHERE "ownerId"=$1${locking ? ' FOR UPDATE' : ''}`, [ownerId])).rows[0];
  if (!row) return structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
  try {
    const parsed = JSON.parse(row.data);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch { /* Preserve malformed data for an administrator to repair. */ }
  throw new ApiError(409, 'La configuración del espacio necesita revisión antes de guardar su SLA.');
}
async function legacyHours(tx: PoolClient, ownerId: string): Promise<SlaHours> {
  const data = await settingsData(tx, ownerId);
  const parsed = slaHoursSchema.safeParse(data.slaHours ?? DEFAULT_SETTINGS.slaHours);
  if (!parsed.success) throw new ApiError(409, 'Revisa los plazos generales antes de configurar las empresas.');
  return parsed.data;
}
async function validateScope(tx: PoolClient, access: AccessContext, scope: string): Promise<string> {
  const selected = scopeSchema.parse(scope);
  if (selected !== 'default') {
    const company = await tx.query('SELECT id FROM "customerCompanies" WHERE id=$1 AND "ownerId"=$2 AND "organizationId"=$3 FOR SHARE', [selected, access.ownerId, access.organizationId]);
    if (!company.rows.length) throw new ApiError(404, 'La empresa no existe en este espacio.');
  }
  return selected;
}
function inheritedView(scope: string, policy: ServicePolicySnapshot, source: string): ServicePolicyView {
  return { id: null, scopeKey: scope, customerCompanyId: scope === 'default' ? null : scope, version: 0,
    override: false, sourceScopeKey: source, calendar: policy.calendar, slaHours: policy.slaHours, createdAt: null, updatedAt: null };
}
async function policyView(tx: PoolClient, ownerId: string, scope: string): Promise<ServicePolicyView> {
  const rows = (await tx.query<PolicyRow>(`SELECT ${columns} FROM "servicePolicies" WHERE "ownerId"=$1 AND "scopeKey"=ANY($2::text[])
    ORDER BY CASE WHEN "scopeKey"=$3 THEN 0 ELSE 1 END`, [ownerId, scope === 'default' ? ['default'] : [scope, 'default'], scope])).rows;
  const exact = rows.find(row => row.scopeKey === scope);
  if (exact) return view(exact);
  const defaultRow = rows.find(row => row.scopeKey === 'default');
  return inheritedView(scope, defaultRow ? snapshot(defaultRow) : createLegacyServicePolicySnapshot(await legacyHours(tx, ownerId)), defaultRow ? 'default' : 'legacy');
}

/** Called inside the ticket mutation's existing transaction. No external pool
 * query, no policy backfill and no recalculation of existing tickets. */
export async function getEffectiveServicePolicy(tx: PoolClient, ownerId: string, companyId: string | null, hours: SlaHours): Promise<ServicePolicySnapshot> {
  const rows = (await tx.query<PolicyRow>(`SELECT ${columns} FROM "servicePolicies" WHERE "ownerId"=$1 AND "scopeKey"=ANY($2::text[])
    ORDER BY CASE WHEN "scopeKey"=$3 THEN 0 ELSE 1 END FOR SHARE`, [ownerId, companyId ? [companyId, 'default'] : ['default'], companyId || 'default'])).rows;
  return rows[0] ? snapshot(rows[0]) : createLegacyServicePolicySnapshot(hours);
}
export async function listServicePolicies(tx: PoolClient, access: AccessContext) {
  const fresh = requireAdmin(await lockAccess(tx, access));
  const rows = (await tx.query<PolicyRow>(`SELECT ${columns} FROM "servicePolicies" WHERE "ownerId"=$1 ORDER BY "scopeKey"`, [fresh.ownerId])).rows;
  const defaultRow = rows.find(row => row.scopeKey === 'default');
  return { policies: rows.map(view), defaultPolicy: defaultRow ? view(defaultRow) : inheritedView('default', createLegacyServicePolicySnapshot(await legacyHours(tx, fresh.ownerId)), 'legacy') };
}
export async function getServicePolicy(tx: PoolClient, access: AccessContext, rawScope: string) {
  const fresh = requireAdmin(await lockAccess(tx, access));
  const scope = await validateScope(tx, fresh, rawScope);
  return policyView(tx, fresh.ownerId, scope);
}
export async function saveServicePolicy(tx: PoolClient, access: AccessContext, rawScope: string, input: z.output<typeof saveServicePolicySchema>) {
  await acquireTicketWorkLock(tx, access.ownerId);
  const fresh = requireAdmin(await lockAccess(tx, access));
  const scope = await validateScope(tx, fresh, rawScope);
  const data = saveServicePolicySchema.parse(input);
  try { addSlaHours(new Date().toISOString(), Math.max(...Object.values(data.slaHours)), data.calendar); }
  catch (error) { if (error instanceof SlaCalculationError) throw new ApiError(400, error.message); throw error; }
  const old = (await tx.query<PolicyRow>(`SELECT ${columns} FROM "servicePolicies" WHERE "ownerId"=$1 AND "scopeKey"=$2 FOR UPDATE`, [fresh.ownerId, scope])).rows[0];
  // Row identity prevents ABA: deleting/recreating an override restarts its
  // version, but an editor holding the old UUID must never overwrite it.
  if ((old?.id ?? null) !== data.expectedId || (old?.version ?? 0) !== data.expectedVersion) throw new ApiError(409, 'La política cambió. Actualiza antes de volver a guardar.');
  const now = new Date().toISOString();
  const values = [JSON.stringify(data.calendar), JSON.stringify(data.slaHours), now, fresh.ownerId, scope];
  let saved: PolicyRow;
  if (old) saved = (await tx.query<PolicyRow>(`UPDATE "servicePolicies" SET "calendarJson"=$1,"slaHoursJson"=$2,"updatedAt"=$3,version=version+1
    WHERE "ownerId"=$4 AND "scopeKey"=$5 AND id=$6 AND version=$7 RETURNING ${columns}`, [...values, data.expectedId, data.expectedVersion])).rows[0];
  else saved = (await tx.query<PolicyRow>(`INSERT INTO "servicePolicies" (id,"ownerId","scopeKey","customerCompanyId","calendarJson","slaHoursJson",version,"createdAt","updatedAt")
    VALUES ($1,$2,$3,$4,$5,$6,1,$7,$7) RETURNING ${columns}`, [randomUUID(), fresh.ownerId, scope, scope === 'default' ? null : scope, values[0], values[1], now])).rows[0];
  if (!saved) throw new ApiError(409, 'La política cambió. Actualiza antes de volver a guardar.');
  if (scope === 'default') {
    const current = await settingsData(tx, fresh.ownerId, true);
    current.slaHours = data.slaHours;
    await tx.query('INSERT INTO settings ("ownerId",data) VALUES ($1,$2) ON CONFLICT ("ownerId") DO UPDATE SET data=excluded.data', [fresh.ownerId, JSON.stringify(current)]);
  }
  return view(saved);
}
export async function deleteServicePolicy(tx: PoolClient, access: AccessContext, rawScope: string, input: z.output<typeof deleteServicePolicySchema>) {
  const data = deleteServicePolicySchema.parse(input);
  await acquireTicketWorkLock(tx, access.ownerId);
  const fresh = requireAdmin(await lockAccess(tx, access));
  const scope = await validateScope(tx, fresh, rawScope);
  const old = (await tx.query<PolicyRow>(`SELECT ${columns} FROM "servicePolicies" WHERE "ownerId"=$1 AND "scopeKey"=$2 FOR UPDATE`, [fresh.ownerId, scope])).rows[0];
  if ((old?.id ?? null) !== data.expectedId || (old?.version ?? 0) !== data.expectedVersion) throw new ApiError(409, 'La política cambió. Actualiza antes de eliminarla.');
  if (!old) throw new ApiError(404, 'Esta política ya utiliza la configuración general.');
  // Default deletion deliberately preserves the current legacy hours. Only its
  // calendar override is removed; stored ticket snapshots remain untouched.
  const deleted = await tx.query('DELETE FROM "servicePolicies" WHERE id=$1 AND "ownerId"=$2 AND version=$3 RETURNING id', [data.expectedId, fresh.ownerId, data.expectedVersion]);
  if (deleted.rowCount !== 1) throw new ApiError(409, 'La política cambió. Actualiza antes de eliminarla.');
  return policyView(tx, fresh.ownerId, scope);
}
