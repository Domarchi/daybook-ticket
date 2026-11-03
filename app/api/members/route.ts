import { ApiError, db, handle, json, parseBody, inviteMemberSchema } from '@/lib/server';
import { requireAccess, requireAdmin, getMember, publicMember } from '@/lib/access';
import { prepareInvitation } from '@/lib/invitations';
import { notificationStatements, processOutboxBestEffort } from '@/lib/mail';
export async function POST(request: Request) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    const data = await parseBody(request, inviteMemberSchema);
    if (data.role === 'admin' && access.role !== 'owner') throw new ApiError(403, 'Solo la persona propietaria puede invitar administradores.');
    const database = db();
    const existing = await database.prepare("SELECT id FROM members WHERE \"organizationId\" = $1 AND email = $2").bind(access.organizationId, data.email).first();
    if (existing) throw new ApiError(409, 'Este correo ya tiene una cuenta o invitación. Gestiona su acceso desde la lista.');
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const invitation = await prepareInvitation(database, access.ownerId, id);
    await database.batch([
      database.prepare("INSERT INTO members (id, \"organizationId\", \"ownerId\", \"userId\", email, name, role, status, \"invitedBy\", \"createdAt\", \"updatedAt\") VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10)").bind(id, access.organizationId, access.ownerId, data.email, data.name, data.role, 'invited', access.member.id, now, now),
      invitation.statement,
      ...notificationStatements(database, { ownerId: access.ownerId, event: 'invitation', eventKey: `invitation:${crypto.randomUUID()}:${id}`, recipientMemberId: id, actionUrl: invitation.url, expiresAt: invitation.expiresAt }),
    ]);
    await processOutboxBestEffort(access.ownerId);
    return json({ member: publicMember(await getMember(access, id)), invitationUrl: invitation.url }, 201);
  });
}
