import { ApiError, db, handle, json, parseBody, patchMemberSchema, type RouteContext } from '@/lib/server';
import { requireAccess, requireAdmin, checkMemberChange, publicMember, validateMemberCompany, type MemberRecord } from '@/lib/access';
import { acquireTicketWorkLock } from '@/lib/work-lock';
import { lockAccess } from '@/lib/ticket-mutations';

export async function PATCH(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    const id = (await context.params).id;
    const data = await parseBody(request, patchMemberSchema);
    return db().transaction(async tx => {
      await acquireTicketWorkLock(tx, access.ownerId);
      const fresh = requireAdmin(await lockAccess(tx, access));
      const member = (await tx.query<MemberRecord>('SELECT *,("userId" IS NOT NULL) AS "hasAccount" FROM members WHERE id=$1 AND "organizationId"=$2 AND "ownerId"=$3 FOR UPDATE', [id, fresh.organizationId, fresh.ownerId])).rows[0];
      if (!member) throw new ApiError(404, 'Esta cuenta no está disponible.');
      checkMemberChange(fresh, member, data);
      const role = data.role ?? member.role;
      if ((data.isTest ?? member.isTest) && role !== 'client') throw new ApiError(400, 'Quita la marca de prueba antes de convertir esta cuenta en equipo.');
      const customerCompanyId = data.customerCompanyId !== undefined ? data.customerCompanyId : role === 'client' ? member.customerCompanyId : null;
      const companyChanged = customerCompanyId !== member.customerCompanyId;
      const companyAccess = data.companyAccess ?? (role !== 'client' || !customerCompanyId || companyChanged ? 'own' : member.companyAccess);
      await validateMemberCompany(fresh, { role, customerCompanyId, companyAccess });
      const changes = { ...data,
        ...(customerCompanyId !== member.customerCompanyId ? { customerCompanyId } : {}),
        ...(companyAccess !== member.companyAccess ? { companyAccess } : {}),
        updatedAt: new Date().toISOString(),
      };
      const keys = Object.keys(changes);
      const updated = await tx.query<MemberRecord>(`UPDATE members SET ${keys.map((key, index) => `"${key}"=$${index + 1}`).join(',')} WHERE id=$${keys.length + 1} AND "organizationId"=$${keys.length + 2} AND "ownerId"=$${keys.length + 3} RETURNING *,("userId" IS NOT NULL) AS "hasAccount"`, [...Object.values(changes), id, fresh.organizationId, fresh.ownerId]);
      if (data.status === 'revoked') {
        await tx.query('DELETE FROM invitations WHERE "memberId"=$1 AND "ownerId"=$2', [id, fresh.ownerId]);
        await tx.query(`UPDATE "mailOutbox" SET status='cancelled',"updatedAt"=$1,"nextAttemptAt"=NULL WHERE "ownerId"=$2 AND "recipientMemberId"=$3 AND status IN ('queued','awaiting_configuration')`, [changes.updatedAt, fresh.ownerId, id]);
      }
      return json({ member: publicMember(updated.rows[0]) });
    });
  });
}
