import { ApiError, auth, db, getSettings } from './server';
import type { Member, MemberRole, MemberStatus, CompanyAccess, CustomerCompany } from './types';
import type { Database } from '../db/database';
import type { PoolClient } from 'pg';
import type { DatabaseValue } from '../db/database';
import { assertSecurityAccess, requireFreshSecurity } from './security';
import { securityActionNeedsReauthentication } from './security-model';
import { workspaceIdFromPath,isWorkspaceSetupPath } from './workspace-model';
import { readCommercialWorkspace } from './workspaces';

export interface MemberRecord extends Member {
  organizationId: string;
  ownerId: string;
  userId: string | null;
}
export interface AccessContext {
  organizationId: string;
  ownerId: string;
  userId: string;
  member: Member;
  role: MemberRole;
  sessionId?: string;
  workspaceSetup?: boolean;
}
export const memberColumns = '"isTest", id, name, email, role, status, ("userId" IS NOT NULL) AS "hasAccount", "customerCompanyId", "companyAccess", "createdAt", "updatedAt"';
const memberRecordColumns = `${memberColumns}, "organizationId", "ownerId", "userId"`;
export function publicMember(row: MemberRecord | Member): Member {
  return { isTest: Boolean(row.isTest), id: row.id, name: row.name, email: row.email, role: row.role, status: row.status, hasAccount: Boolean(row.hasAccount), customerCompanyId: row.customerCompanyId ?? null, companyAccess: row.companyAccess ?? 'own', createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export type TicketAccessContext = Pick<AccessContext, 'ownerId' | 'role'> & {
  member: Pick<Member, 'id' | 'status' | 'customerCompanyId' | 'companyAccess'>;
};
type TicketAccessRecord = { ownerId: string; requesterMemberId: string | null; customerCompanyId: string | null };

/** This rule also guards delivery: changing company or access never moves ticket history. */
export function canAccessTicket(access: TicketAccessContext, ticket: TicketAccessRecord): boolean {
  if (access.member.status !== 'active' || ticket.ownerId !== access.ownerId) return false;
  if (['owner', 'admin', 'agent'].includes(access.role)) return true;
  if (access.role !== 'client') return false;
  const companyId = access.member.customerCompanyId ?? null;
  const ticketCompanyId = ticket.customerCompanyId ?? null;
  return (ticket.requesterMemberId === access.member.id && (ticketCompanyId === null || ticketCompanyId === companyId))
    || (access.member.companyAccess === 'manager' && companyId !== null && ticketCompanyId === companyId);
}

/** Parameterized SQL equivalent of canAccessTicket; aliases are application-owned identifiers. */
export function ticketAccessSql(access: TicketAccessContext, alias = 't', parameterStart = 1): { sql: string; values: DatabaseValue[] } {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias) || !Number.isInteger(parameterStart) || parameterStart < 1) throw new Error('Invalid ticket access SQL context');
  if (access.member.status !== 'active' || !['owner', 'admin', 'agent', 'client'].includes(access.role)) return { sql: 'FALSE', values: [] };
  const values: DatabaseValue[] = [access.ownerId];
  const owner = `${alias}."ownerId" = $${parameterStart}`;
  if (access.role !== 'client') return { sql: owner, values };
  values.push(access.member.id, access.member.customerCompanyId ?? null, access.member.companyAccess === 'manager');
  const member = `$${parameterStart + 1}`, company = `$${parameterStart + 2}::text`, manager = `$${parameterStart + 3}::boolean`;
  return { sql: `(${owner} AND ((${alias}."requesterMemberId" = ${member} AND (${alias}."customerCompanyId" IS NULL OR ${alias}."customerCompanyId" = ${company})) OR (${manager} AND ${company} IS NOT NULL AND ${alias}."customerCompanyId" = ${company})))`, values };
}

export async function getCustomerCompany(access: Pick<AccessContext, 'ownerId' | 'organizationId'>, id: string): Promise<CustomerCompany> {
  const company = await db().prepare('SELECT id, name, "createdAt", "updatedAt" FROM "customerCompanies" WHERE id = $1 AND "ownerId" = $2 AND "organizationId" = $3')
    .bind(id, access.ownerId, access.organizationId).first<CustomerCompany>();
  if (!company) throw new ApiError(400, 'Selecciona una empresa de este espacio.');
  return company;
}

export async function getCustomerCompanies(access: AccessContext): Promise<CustomerCompany[]> {
  const values: DatabaseValue[] = [access.ownerId, access.organizationId];
  const scope = access.role === 'client' ? ' AND id = $3' : '';
  if (access.role === 'client') values.push(access.member.customerCompanyId ?? null);
  return (await db().prepare(`SELECT id, name, "createdAt", "updatedAt" FROM "customerCompanies" WHERE "ownerId" = $1 AND "organizationId" = $2${scope} ORDER BY name, id`)
    .bind(...values).all<CustomerCompany>()).results;
}

export async function validateMemberCompany(access: AccessContext, member: { role: MemberRole; customerCompanyId: string | null; companyAccess: CompanyAccess }) {
  if (member.role !== 'client' && (member.customerCompanyId !== null || member.companyAccess !== 'own')) throw new ApiError(400, 'Los permisos de empresa corresponden solo a cuentas de cliente.');
  if (member.companyAccess === 'manager' && !member.customerCompanyId) throw new ApiError(400, 'Selecciona la empresa de la persona encargada.');
  if (member.customerCompanyId) await getCustomerCompany(access, member.customerCompanyId);
}

export async function requireAccess(request?: Request, options: { allowSecuritySetup?: boolean } = {}): Promise<AccessContext> {
  return resolveWorkspaceAccess(await auth(request),request,options);
}
/** Identity comes exclusively from the authenticated session; URL selects scope, never identity or role. */
export async function resolveWorkspaceAccess(user:{userId:string;sessionId?:string},request:Request|undefined,options:{allowSecuritySetup?:boolean}={},database:Database=db()):Promise<AccessContext>{
  const query={query:async(sql:string,values?:DatabaseValue[])=>{const value=await database.prepare(sql).bind(...values??[]).all();return {rows:value.results,rowCount:value.meta.changes};}} as Pick<PoolClient,'query'>;
  const workspaceId=request?workspaceIdFromPath(new URL(request.url).pathname):'daybook';
  const organization = await database.prepare("SELECT id, \"ownerId\" FROM organizations WHERE id = $1").bind(workspaceId).first<{ id: string; ownerId: string }>();
  if (!organization) throw new ApiError(503, 'El propietario debe activar Daybook Ticket.');
  const member = await database.prepare(`SELECT ${memberRecordColumns} FROM members WHERE "organizationId" = $1 AND "userId" = $2`).bind(organization.id, user.userId).first<MemberRecord>();
  if (!member || member.status !== 'active' || member.ownerId !== organization.ownerId) throw new ApiError(403, 'Tu cuenta no tiene acceso a Daybook Ticket. Solicita una invitación al equipo.');
  const expectedMember = request?.headers.get('X-Daybook-Member-Id');
  if (expectedMember && expectedMember !== member.id) throw new ApiError(409, 'La cuenta cambió. Actualiza la página antes de continuar.');
  const access:AccessContext = { organizationId: organization.id, ownerId: organization.ownerId, userId: user.userId, sessionId: user.sessionId, member: publicMember(member), role: member.role };
  if(workspaceId!=='daybook'){
    const profile=await readCommercialWorkspace(workspaceId,database);
    if(!profile||profile.ownerId!==organization.ownerId)throw new ApiError(403,'Este espacio no está disponible.');
    const setupPath=request&&isWorkspaceSetupPath(new URL(request.url).pathname);
    if(profile.state!=='active'&&!(profile.state==='draft'&&access.role==='owner'&&setupPath))throw new ApiError(423,'Este espacio está en incorporación o en pausa. Sus datos se conservan.');
    if(profile.state==='draft'&&access.role==='owner')access.workspaceSetup=true;
  }
  if (!options.allowSecuritySetup) {
    await assertSecurityAccess(access,query);
    if (request && securityActionNeedsReauthentication(new URL(request.url).pathname, request.method)) await requireFreshSecurity(access,query);
  }
  return access;
}

export function requireStaff(access: AccessContext) {
  if (!['owner', 'admin', 'agent'].includes(access.role)) throw new ApiError(403, 'Esta acción está disponible solo para el equipo.');
  return access;
}
export function requireAdmin(access: AccessContext) {
  if (!['owner', 'admin'].includes(access.role)) throw new ApiError(403, 'Necesitas permisos de administración para realizar esta acción.');
  return access;
}
export async function getMember(access: AccessContext, id: string): Promise<MemberRecord> {
  const row = await db().prepare(`SELECT ${memberRecordColumns} FROM members WHERE id = $1 AND "organizationId" = $2 AND "ownerId" = $3`).bind(id, access.organizationId, access.ownerId).first<MemberRecord>();
  if (!row) throw new ApiError(404, 'La cuenta no existe o no tienes acceso.');
  return row;
}
export async function assigneeFor(access: AccessContext, id: string | null | undefined, legacyName?: string): Promise<{ assignee: string; assigneeMemberId: string | null }> {
  if (id) {
    const member = await getMember(access, id);
    if (member.status !== 'active' || member.role === 'client') throw new ApiError(400, 'Selecciona una cuenta activa del equipo.');
    return { assignee: member.name, assigneeMemberId: member.id };
  }
  if (id === undefined && legacyName) {
    const matches = await db().prepare("SELECT id, name FROM members WHERE \"ownerId\" = $1 AND status = 'active' AND role IN ('owner', 'admin', 'agent') AND name = $2").bind(access.ownerId, legacyName).all<{ id: string; name: string }>();
    if (matches.results.length !== 1) throw new ApiError(400, 'Selecciona una cuenta activa del equipo.');
    return { assignee: matches.results[0].name, assigneeMemberId: matches.results[0].id };
  }
  return { assignee: '', assigneeMemberId: null };
}
export async function requesterFor(access: AccessContext, id: string) {
  const member = await getMember(access, id);
  if (member.role !== 'client' || member.status === 'revoked') throw new ApiError(400, 'Selecciona una cuenta de cliente habilitada.');
  return { requesterMemberId: member.id, requesterName: member.name, requesterEmail: member.email, customerCompanyId: member.customerCompanyId };
}
export async function notificationRecipients(access: AccessContext, assigneeMemberId: string | null): Promise<string[]> {
  const { notificationMemberIds } = await getSettings(access.ownerId);
  if (notificationMemberIds.length) {
    const ids = [...new Set([...notificationMemberIds, ...(assigneeMemberId ? [assigneeMemberId] : [])])];
    const placeholders = ids.map((_, index) => `$${index + 3}`).join(', ');
    const recipients = await db().prepare(`SELECT id FROM members WHERE "ownerId" = $1 AND "organizationId" = $2 AND id IN (${placeholders}) AND status = 'active' AND role IN ('owner', 'admin', 'agent')`)
      .bind(access.ownerId, access.organizationId, ...ids).all<{ id: string }>();
    return recipients.results.map(row => row.id);
  }
  // An empty list preserves automatic routing to the assignee, or to the active team.
  if (assigneeMemberId) {
    const assigned = await db().prepare("SELECT id FROM members WHERE id = $1 AND \"ownerId\" = $2 AND \"organizationId\" = $3 AND status = 'active' AND role IN ('owner', 'admin', 'agent')").bind(assigneeMemberId, access.ownerId, access.organizationId).first<{ id: string }>();
    if (assigned) return [assigned.id];
  }
  const recipients = await db().prepare("SELECT id FROM members WHERE \"ownerId\" = $1 AND \"organizationId\" = $2 AND status = 'active' AND role IN ('owner', 'admin', 'agent')").bind(access.ownerId, access.organizationId).all<{ id: string }>();
  return recipients.results.map(row => row.id);
}
export function checkMemberChange(access: AccessContext, target: MemberRecord, next: { role?: Exclude<MemberRole, 'owner'>; status?: MemberStatus }) {
  requireAdmin(access);
  if (target.role === 'owner') throw new ApiError(403, 'La cuenta propietaria no se puede modificar.');
  if (target.id === access.member.id) throw new ApiError(403, 'No puedes cambiar tus propios permisos.');
  if (access.role !== 'owner' && (target.role === 'admin' || next.role === 'admin')) throw new ApiError(403, 'Solo la persona propietaria puede gestionar administradores.');
  if (next.status === 'active' && !target.userId) throw new ApiError(400, 'La persona debe aceptar su invitación antes de activar su cuenta.');
  if (next.status === 'invited' && target.userId) throw new ApiError(400, 'Esta cuenta ya aceptó su invitación. Puedes activarla o revocarla.');
}
