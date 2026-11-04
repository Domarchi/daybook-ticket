import { db, handle, json, parseBody, patchMemberSchema, type RouteContext } from '@/lib/server';
import { requireAccess, requireAdmin, getMember, checkMemberChange, publicMember, validateMemberCompany } from '@/lib/access';
export async function PATCH(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    const id = (await context.params).id;
    const data = await parseBody(request, patchMemberSchema);
    const member = await getMember(access, id);
    checkMemberChange(access, member, data);
    const role = data.role ?? member.role;
    const customerCompanyId = data.customerCompanyId !== undefined ? data.customerCompanyId : role === 'client' ? member.customerCompanyId : null;
    const companyChanged = customerCompanyId !== member.customerCompanyId;
    const companyAccess = data.companyAccess ?? (role !== 'client' || !customerCompanyId || companyChanged ? 'own' : member.companyAccess);
    await validateMemberCompany(access, { role, customerCompanyId, companyAccess });
    // A status-only edit must not replay a stale company snapshot over another
    // administrator's transfer. Write derived values only when they change.
    const changes = { ...data,
      ...(customerCompanyId !== member.customerCompanyId ? { customerCompanyId } : {}),
      ...(companyAccess !== member.companyAccess ? { companyAccess } : {}),
      updatedAt: new Date().toISOString(),
    };
    const database = db();
    const keys = Object.keys(changes);
    const statements = [database.prepare(`UPDATE members SET ${keys.map((key, index) => `"${key}" = $${index + 1}`).join(', ')} WHERE id = $${keys.length + 1} AND "organizationId" = $${keys.length + 2} AND "ownerId" = $${keys.length + 3}`).bind(...Object.values(changes), id, access.organizationId, access.ownerId)];
    if (data.status === 'revoked') statements.push(
      database.prepare("DELETE FROM invitations WHERE \"memberId\" = $1 AND \"ownerId\" = $2").bind(id, access.ownerId),
      database.prepare("UPDATE \"mailOutbox\" SET status = 'cancelled', \"updatedAt\" = $1, \"nextAttemptAt\" = NULL WHERE \"ownerId\" = $2 AND \"recipientMemberId\" = $3 AND status IN ('queued', 'awaiting_configuration')").bind(changes.updatedAt, access.ownerId, id),
    );
    await database.batch(statements);
    return json({ member: publicMember(await getMember(access, id)) });
  });
}
