import { z } from 'zod';
import { requireAccess, requireAdmin, getCustomerCompanies } from '@/lib/access';
import { db, handle, json, parseBody, shortText } from '@/lib/server';

export async function GET(request: Request) {
  return handle(async () => json({ companies: await getCustomerCompanies(await requireAccess(request)) }));
}

export async function POST(request: Request) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    const { name } = await parseBody(request, z.object({ name: shortText }).strict());
    const company = {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await db()
      .prepare(
        'INSERT INTO "customerCompanies" (id, "organizationId", "ownerId", name, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6)',
      )
      .bind(company.id, access.organizationId, access.ownerId, company.name, company.createdAt, company.updatedAt)
      .run();
    return json({ company }, 201);
  });
}
