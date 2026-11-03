import { ApiError, auth, db, getSettings } from './server';
import type { Member, MemberRole, MemberStatus } from './types';

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
}
export const memberColumns = 'id, name, email, role, status, ("userId" IS NOT NULL) AS "hasAccount", "createdAt", "updatedAt"';
const memberRecordColumns = `${memberColumns}, "organizationId", "ownerId", "userId"`;
export function publicMember(row: MemberRecord | Member): Member {
  return { id: row.id, name: row.name, email: row.email, role: row.role, status: row.status, hasAccount: Boolean(row.hasAccount), createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export async function requireAccess(request?: Request): Promise<AccessContext> {
  const user = await auth(request);
  const database = db();
  const organization = await database.prepare("SELECT id, \"ownerId\" FROM organizations WHERE id = $1").bind('daybook').first<{ id: string; ownerId: string }>();
  if (!organization) throw new ApiError(503, 'El propietario debe activar Daybook Ticket.');
  const member = await database.prepare(`SELECT ${memberRecordColumns} FROM members WHERE "organizationId" = $1 AND "userId" = $2`).bind(organization.id, user.userId).first<MemberRecord>();
  if (!member || member.status !== 'active' || member.ownerId !== organization.ownerId) throw new ApiError(403, 'Tu cuenta no tiene acceso a Daybook Ticket. Solicita una invitación al equipo.');
  return { organizationId: organization.id, ownerId: organization.ownerId, userId: user.userId, member: publicMember(member), role: member.role };
}

export function requireStaff(access: AccessContext) {
  if (access.role === 'client') throw new ApiError(403, 'Esta acción está disponible solo para el equipo.');
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
  return { requesterMemberId: member.id, requesterName: member.name, requesterEmail: member.email };
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
