import { ApiError, db, handle, json, parseBody, inviteMemberSchema } from '@/lib/server';
import { requireAccess, requireAdmin, getMember, publicMember, validateMemberCompany } from '@/lib/access';
import { prepareInvitation } from '@/lib/invitations';
import { notificationStatements, drainOutboxBestEffort } from '@/lib/mail';
import { after } from 'next/server';
export async function POST(request: Request) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    const data = await parseBody(request, inviteMemberSchema);
    if (data.isTest && data.role !== 'client') throw new ApiError(400, 'Solo las cuentas cliente pueden marcarse como prueba.');
    if (data.role === 'admin' && access.role !== 'owner') throw new ApiError(403, 'Solo la persona propietaria puede invitar administradores.');
    const company = { role: data.role, customerCompanyId: data.customerCompanyId ?? null, companyAccess: data.companyAccess ?? 'own' as const };
    await validateMemberCompany(access, company);
    const database = db();
    const existing = await database.prepare("SELECT id FROM members WHERE \"organizationId\" = $1 AND email = $2").bind(access.organizationId, data.email).first();
    if (existing) throw new ApiError(409, 'Este correo ya tiene una cuenta o invitación. Gestiona su acceso desde la lista.');
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const invitation = await prepareInvitation(database, access.ownerId, id);
    await database.batch([
      database.prepare("INSERT INTO members (id, \"organizationId\", \"ownerId\", \"userId\", email, name, role, status, \"invitedBy\", \"createdAt\", \"updatedAt\") VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10)").bind(id, access.organizationId, access.ownerId, data.email, data.name, data.role, 'invited', access.member.id, now, now),
      database.prepare('UPDATE members SET "customerCompanyId" = $1, "companyAccess" = $2, "isTest" = $5 WHERE id = $3 AND "ownerId" = $4').bind(company.customerCompanyId, company.companyAccess, id, access.ownerId, data.isTest ?? false),
      invitation.statement,
      ...notificationStatements(database, { ownerId: access.ownerId, event: 'invitation', eventKey: `invitation:${crypto.randomUUID()}:${id}`, recipientMemberId: id, actionUrl: invitation.url, expiresAt: invitation.expiresAt }),
    ]);
    after(async () => { await drainOutboxBestEffort(access.ownerId); });
    return json({ member: publicMember(await getMember(access, id)), invitationUrl: invitation.url }, 201);
  });
}
