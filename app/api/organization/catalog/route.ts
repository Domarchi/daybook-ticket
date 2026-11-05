import { requireAccess } from '@/lib/access';
import { handle, json, parseBody } from '@/lib/server';
import { catalogMutationSchema, catalogPatchSchema } from '@/lib/work-organization-model';
import { createOrganizationCatalog, patchOrganizationCatalog, parseOrganizationCatalogQuery, readOrganizationCatalog } from '@/lib/work-organization';
export async function GET(request: Request) { return handle(async () => json(await readOrganizationCatalog(await requireAccess(request), parseOrganizationCatalogQuery(new URL(request.url).searchParams)))); }
export async function POST(request: Request) { return handle(async () => json({item: await createOrganizationCatalog(await requireAccess(request), await parseBody(request,catalogMutationSchema))},201)); }
export async function PATCH(request: Request) { return handle(async () => json({item: await patchOrganizationCatalog(await requireAccess(request), await parseBody(request,catalogPatchSchema))})); }
