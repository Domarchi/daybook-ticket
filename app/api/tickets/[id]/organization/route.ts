import { requireAccess } from '@/lib/access';
import { handle, json, parseBody, parseId, type RouteContext } from '@/lib/server';
import { ticketOrganizationPatchSchema } from '@/lib/work-organization-model';
import { patchTicketOrganization, readTicketOrganization } from '@/lib/work-organization';
export async function GET(request: Request, context: RouteContext) { return handle(async () => json({organization:await readTicketOrganization(await requireAccess(request),parseId((await context.params).id))})); }
export async function PATCH(request: Request, context: RouteContext) { return handle(async () => json({organization:await patchTicketOrganization(await requireAccess(request),parseId((await context.params).id),await parseBody(request,ticketOrganizationPatchSchema))})); }
