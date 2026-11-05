import { z } from 'zod';
import type { PoolClient } from 'pg';
import { requireAdmin, requireStaff, type AccessContext } from './access';
import { ApiError, db, shortText } from './server';
import { lockAccess } from './ticket-mutations';
import { acquireTicketWorkLock } from './work-lock';
import { publicAssignmentRule, type AssignmentRuleRecord, type AssignmentRule } from './automatic-assignment';

const memberIds = z.array(z.string().uuid()).min(1, 'Selecciona al menos un agente.').max(50)
  .refine(ids => new Set(ids).size === ids.length, 'No repitas agentes en la regla.');
const fields = {
  name: shortText,
  customerCompanyId: z.string().uuid().nullable(),
  department: shortText.nullable(),
  enabled: z.boolean(),
  position: z.number().int().min(0).max(10000),
  agentMemberIds: memberIds,
};
export const createAssignmentRuleSchema = z.object({ ...fields,
  customerCompanyId: fields.customerCompanyId.default(null), department: fields.department.default(null),
  enabled: fields.enabled.default(false), position: fields.position.default(100),
}).strict();
export const patchAssignmentRuleSchema = z.object({
  name: fields.name.optional(), customerCompanyId: fields.customerCompanyId.optional(), department: fields.department.optional(),
  enabled: fields.enabled.optional(), position: fields.position.optional(), agentMemberIds: fields.agentMemberIds.optional(),
  expectedVersion: z.number().int().nonnegative(),
}).strict().refine(value => Object.keys(value).some(key => key !== 'expectedVersion'), 'No hay cambios para guardar.');
export const assignmentRuleVersionSchema = z.object({ expectedVersion: z.number().int().nonnegative() }).strict();

type RuleInput = z.output<typeof createAssignmentRuleSchema>;
const ruleColumns = 'id,name,"customerCompanyId",department,enabled,position,"agentMemberIdsJson",version,"createdAt","updatedAt"';

/** All administrative updates recheck the actor after waiting for the same
 * per-owner work lock as assignment and ticket creation. */
export async function withAssignmentAdmin<T>(access: AccessContext, work: (tx: PoolClient, fresh: AccessContext) => Promise<T>): Promise<T> {
  return db().transaction(async tx => {
    await acquireTicketWorkLock(tx, access.ownerId);
    const fresh = requireAdmin(await lockAccess(tx, access));
    return work(tx, fresh);
  });
}

export async function validateAssignmentRule(tx: PoolClient, access: AccessContext, data: RuleInput): Promise<void> {
  if (data.customerCompanyId) {
    const company = await tx.query('SELECT id FROM "customerCompanies" WHERE id=$1 AND "ownerId"=$2 AND "organizationId"=$3 FOR SHARE',
      [data.customerCompanyId, access.ownerId, access.organizationId]);
    if (company.rowCount !== 1) throw new ApiError(400, 'Selecciona una empresa de este espacio.');
  }
  if (data.department) {
    const settings = await tx.query<{ data: string }>('SELECT data FROM settings WHERE "ownerId"=$1', [access.ownerId]);
    const parsed = settings.rows[0] ? JSON.parse(settings.rows[0].data) as { departments?: string[] } : null;
    const departments = parsed?.departments || ['Soporte técnico', 'Facturación', 'Ventas'];
    if (!departments.includes(data.department)) throw new ApiError(400, 'Selecciona un departamento válido.');
  }
  const members = await tx.query(`SELECT id FROM members WHERE "ownerId"=$1 AND "organizationId"=$2 AND id=ANY($3::text[])
    AND status='active' AND role IN ('owner','admin','agent') AND "userId" IS NOT NULL ORDER BY id FOR SHARE`,
  [access.ownerId, access.organizationId, data.agentMemberIds]);
  if (members.rowCount !== data.agentMemberIds.length) throw new ApiError(400, 'Selecciona únicamente agentes activos de este espacio.');
}

export async function listAssignmentRules(access: AccessContext): Promise<AssignmentRule[]> {
  return withAssignmentAdmin(access, async tx => {
    const { rows } = await tx.query<AssignmentRuleRecord>(`SELECT ${ruleColumns} FROM "assignmentRules" WHERE "ownerId"=$1 ORDER BY position,id`, [access.ownerId]);
    return rows.map(publicAssignmentRule);
  });
}

export async function createAssignmentRule(access: AccessContext, data: RuleInput): Promise<AssignmentRule> {
  return withAssignmentAdmin(access, async (tx, fresh) => {
    const count = (await tx.query<{ total: number }>('SELECT count(*)::integer AS total FROM "assignmentRules" WHERE "ownerId"=$1', [fresh.ownerId])).rows[0].total;
    if (count >= 100) throw new ApiError(400, 'Puedes configurar hasta 100 reglas.');
    await validateAssignmentRule(tx, fresh, data);
    const now = new Date().toISOString();
    const { rows } = await tx.query<AssignmentRuleRecord>(`INSERT INTO "assignmentRules"
      (id,"ownerId",name,"customerCompanyId",department,enabled,position,"agentMemberIdsJson",version,"createdAt","updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$9) RETURNING ${ruleColumns}`,
    [crypto.randomUUID(), fresh.ownerId, data.name, data.customerCompanyId, data.department, data.enabled, data.position, JSON.stringify(data.agentMemberIds), now]);
    return publicAssignmentRule(rows[0]);
  });
}

export async function updateAssignmentRule(access: AccessContext, id: string, data: z.output<typeof patchAssignmentRuleSchema>): Promise<AssignmentRule> {
  return withAssignmentAdmin(access, async (tx, fresh) => {
    const old = (await tx.query<AssignmentRuleRecord>(`SELECT ${ruleColumns} FROM "assignmentRules" WHERE id=$1 AND "ownerId"=$2 FOR UPDATE`, [id, fresh.ownerId])).rows[0];
    if (!old) throw new ApiError(404, 'La regla no existe o ya no está disponible.');
    if (old.version !== data.expectedVersion) throw new ApiError(409, 'La regla cambió. Actualiza antes de guardar.');
    const { expectedVersion: _expected, ...changes } = data;
    void _expected;
    const next = { ...publicAssignmentRule(old), ...changes };
    // An agent may have been revoked, a department renamed, or an account
    // changed since the rule was configured. Turning that old rule off must
    // remain possible without introducing any new routing references.
    const oldPublic = publicAssignmentRule(old);
    const retainedScope = next.customerCompanyId === oldPublic.customerCompanyId && next.department === oldPublic.department
      && JSON.stringify([...next.agentMemberIds].sort()) === JSON.stringify([...oldPublic.agentMemberIds].sort());
    if (next.enabled || !retainedScope) await validateAssignmentRule(tx, fresh, next);
    const { rows } = await tx.query<AssignmentRuleRecord>(`UPDATE "assignmentRules" SET name=$1,"customerCompanyId"=$2,department=$3,enabled=$4,
      position=$5,"agentMemberIdsJson"=$6,version=version+1,"updatedAt"=$7 WHERE id=$8 AND "ownerId"=$9 AND version=$10 RETURNING ${ruleColumns}`,
    [next.name, next.customerCompanyId, next.department, next.enabled, next.position, JSON.stringify(next.agentMemberIds), new Date().toISOString(), id, fresh.ownerId, data.expectedVersion]);
    if (!rows.length) throw new ApiError(409, 'La regla cambió. Actualiza antes de guardar.');
    return publicAssignmentRule(rows[0]);
  });
}

export async function deleteAssignmentRule(access: AccessContext, id: string, expectedVersion: number): Promise<void> {
  return withAssignmentAdmin(access, async (tx, fresh) => {
    const row = (await tx.query<{ version: number }>('SELECT version FROM "assignmentRules" WHERE id=$1 AND "ownerId"=$2 FOR UPDATE', [id, fresh.ownerId])).rows[0];
    if (!row) throw new ApiError(404, 'La regla no existe o ya no está disponible.');
    if (row.version !== expectedVersion) throw new ApiError(409, 'La regla cambió. Actualiza antes de eliminarla.');
    await tx.query('DELETE FROM "assignmentRules" WHERE id=$1 AND "ownerId"=$2 AND version=$3', [id, fresh.ownerId, expectedVersion]);
  });
}

export interface AgentAvailability {
  memberId: string; name: string; available: boolean; capacity: number; version: number;
  lastAssignedAt: string | null; updatedAt: string | null; openTickets: number;
}
export const patchAgentAvailabilitySchema = z.object({
  memberId: z.string().uuid(), expectedVersion: z.number().int().nonnegative(), available: z.boolean().optional(),
  capacity: z.number().int().min(1).max(500).optional(),
}).strict().refine(value => value.available !== undefined || value.capacity !== undefined, 'No hay cambios para guardar.');

const availabilityColumns = `m.id AS "memberId",m.name,COALESCE(a.available,true) AS available,COALESCE(a.capacity,20) AS capacity,
  COALESCE(a.version,0) AS version,a."lastAssignedAt",a."updatedAt",
  (SELECT count(*)::integer FROM tickets t WHERE t."ownerId"=m."ownerId" AND t."assigneeMemberId"=m.id AND t.status IN ('open','pending')) AS "openTickets"`;

export async function listAgentAvailability(access: AccessContext): Promise<AgentAvailability[]> {
  return db().transaction(async tx => {
    await acquireTicketWorkLock(tx, access.ownerId);
    const fresh = requireStaff(await lockAccess(tx, access));
    const admin = fresh.role === 'owner' || fresh.role === 'admin';
    return (await tx.query<AgentAvailability>(`SELECT ${availabilityColumns} FROM members m
      LEFT JOIN "agentAvailability" a ON a."memberId"=m.id AND a."ownerId"=m."ownerId"
      WHERE m."ownerId"=$1 AND m."organizationId"=$2 AND m.status='active' AND m."userId" IS NOT NULL
        AND m.role IN ('owner','admin','agent') AND ($3::boolean OR m.id=$4) ORDER BY m.name,m.id`,
    [fresh.ownerId, fresh.organizationId, admin, fresh.member.id])).rows;
  });
}

export async function updateAgentAvailability(access: AccessContext, data: z.output<typeof patchAgentAvailabilitySchema>): Promise<AgentAvailability> {
  return db().transaction(async tx => {
    await acquireTicketWorkLock(tx, access.ownerId);
    const fresh = requireStaff(await lockAccess(tx, access));
    const admin = fresh.role === 'owner' || fresh.role === 'admin';
    if (!admin && (data.memberId !== fresh.member.id || data.capacity !== undefined)) throw new ApiError(403, 'Solo puedes cambiar tu propia disponibilidad.');
    const member = await tx.query(`SELECT id FROM members WHERE id=$1 AND "ownerId"=$2 AND "organizationId"=$3
      AND status='active' AND "userId" IS NOT NULL AND role IN ('owner','admin','agent') FOR SHARE`,
    [data.memberId, fresh.ownerId, fresh.organizationId]);
    if (member.rowCount !== 1) throw new ApiError(404, 'La cuenta activa del equipo no está disponible.');
    const old = (await tx.query<{ available: boolean; capacity: number; version: number }>('SELECT available,capacity,version FROM "agentAvailability" WHERE "memberId"=$1 AND "ownerId"=$2 FOR UPDATE', [data.memberId, fresh.ownerId])).rows[0];
    if ((old?.version ?? 0) !== data.expectedVersion) throw new ApiError(409, 'La disponibilidad cambió. Actualiza antes de guardar.');
    const available = data.available ?? old?.available ?? true;
    const capacity = data.capacity ?? old?.capacity ?? 20;
    await tx.query(`INSERT INTO "agentAvailability" ("memberId","ownerId",available,capacity,version,"updatedAt")
      VALUES ($1,$2,$3,$4,1,$5) ON CONFLICT ("memberId") DO UPDATE SET available=EXCLUDED.available,capacity=EXCLUDED.capacity,
        version="agentAvailability".version+1,"updatedAt"=EXCLUDED."updatedAt" WHERE "agentAvailability"."ownerId"=EXCLUDED."ownerId"`,
    [data.memberId, fresh.ownerId, available, capacity, new Date().toISOString()]);
    return (await tx.query<AgentAvailability>(`SELECT ${availabilityColumns} FROM members m
      JOIN "agentAvailability" a ON a."memberId"=m.id AND a."ownerId"=m."ownerId" WHERE m.id=$1 AND m."ownerId"=$2`, [data.memberId, fresh.ownerId])).rows[0];
  });
}
