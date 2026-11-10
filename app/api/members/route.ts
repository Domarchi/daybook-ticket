import { acquireTicketWorkLock } from '@/lib/work-lock';
import { lockAccess } from '@/lib/ticket-mutations';
import { ApiError, db, handle, json, parseBody, inviteMemberSchema } from '@/lib/server';
import { requireAccess, requireAdmin, publicMember, validateMemberCompany, type MemberRecord } from '@/lib/access';
import { prepareInvitation } from '@/lib/invitations';
import { notificationStatements, drainOutboxBestEffort } from '@/lib/mail';
import { after } from 'next/server';
export async function POST(request: Request) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    const data = await parseBody(request, inviteMemberSchema);
    if (data.isTest && data.role !== 'client')
      throw new ApiError(400, 'Solo las cuentas cliente pueden marcarse como prueba.');
    if (data.role === 'admin' && access.role !== 'owner')
      throw new ApiError(403, 'Solo la persona propietaria puede invitar administradores.');
    const company = {
      role: data.role,
      customerCompanyId: data.customerCompanyId ?? null,
      companyAccess: data.companyAccess ?? ('own' as const),
    };
    await validateMemberCompany(access, company);
    const database = db();
    const result = await database.transaction(async tx => {
      await acquireTicketWorkLock(tx, access.ownerId);
      const fresh = requireAdmin(await lockAccess(tx, access));
      if (data.role === 'admin' && fresh.role !== 'owner')
        throw new ApiError(403, 'Solo la persona propietaria puede invitar administradores.');
      await validateMemberCompany(fresh, company);
      if (
        (
          await tx.query('SELECT id FROM members WHERE "organizationId"=$1 AND email=$2', [
            fresh.organizationId,
            data.email,
          ])
        ).rows.length
      )
        throw new ApiError(409, 'Este correo ya tiene una cuenta o invitación. Gestiona su acceso desde la lista.');
      const id = crypto.randomUUID(),
        now = new Date().toISOString(),
        invitation = await prepareInvitation(database, fresh.ownerId, id);
      const row = (
        await tx.query<MemberRecord>(
          'INSERT INTO members (id,"organizationId","ownerId","userId",email,name,role,status,"invitedBy","createdAt","updatedAt","customerCompanyId","companyAccess","isTest") VALUES($1,$2,$3,NULL,$4,$5,$6,\'invited\',$7,$8,$8,$9,$10,$11) RETURNING *',
          [
            id,
            fresh.organizationId,
            fresh.ownerId,
            data.email,
            data.name,
            data.role,
            fresh.member.id,
            now,
            company.customerCompanyId,
            company.companyAccess,
            data.isTest ?? false,
          ],
        )
      ).rows[0];
      await database.execute(invitation.statement, tx);
      for (const statement of notificationStatements(database, {
        ownerId: fresh.ownerId,
        event: 'invitation',
        eventKey: `invitation:${crypto.randomUUID()}:${id}`,
        recipientMemberId: id,
        actionUrl: invitation.url,
        expiresAt: invitation.expiresAt,
      }))
        await database.execute(statement, tx);
      return { member: publicMember({ ...row, hasAccount: false }), invitationUrl: invitation.url };
    });
    after(async () => {
      await drainOutboxBestEffort(access.ownerId);
    });
    return json(result, 201);
  });
}
