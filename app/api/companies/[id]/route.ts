import { z } from 'zod';
import { requireAccess, requireAdmin, getCustomerCompany } from '@/lib/access';
import { ApiError, db, handle, json, parseBody, shortText, type RouteContext } from '@/lib/server';
import type { CustomerCompany } from '@/lib/types';

export async function PATCH(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    const id = (await context.params).id;
    await getCustomerCompany(access, id);
    const { name } = await parseBody(request, z.object({ name: shortText }).strict());
    const company = await db().prepare('UPDATE "customerCompanies" SET name = $1, "updatedAt" = $2 WHERE id = $3 AND "ownerId" = $4 AND "organizationId" = $5 RETURNING id, name, "createdAt", "updatedAt"')
      .bind(name, new Date().toISOString(), id, access.ownerId, access.organizationId).first<CustomerCompany>();
    if (!company) throw new ApiError(404, 'La empresa ya no está disponible.');
    return json({ company });
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    const id = (await context.params).id;
    await getCustomerCompany(access, id);
    const removed = await db().prepare(`DELETE FROM "customerCompanies" c WHERE c.id = $1 AND c."ownerId" = $2 AND c."organizationId" = $3
      AND NOT EXISTS (SELECT 1 FROM members m WHERE m."customerCompanyId" = c.id)
      AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t."customerCompanyId" = c.id)
      AND NOT EXISTS (SELECT 1 FROM "ticketSlaOutcomes" o WHERE o."customerCompanyId" = c.id) RETURNING c.id`)
      .bind(id, access.ownerId, access.organizationId).first<{ id: string }>();
    if (!removed) throw new ApiError(409, 'La empresa tiene contactos, tickets o mediciones; conserva su historial.');
    return json({ ok: true });
  });
}
