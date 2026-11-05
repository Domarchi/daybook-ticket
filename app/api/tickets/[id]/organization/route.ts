import { requireOrganizationAccess } from '@/lib/organization-access';
import { handle, json, parseBody, parseId, type RouteContext } from '@/lib/server';
import { ticketOrganizationPatchSchema } from '@/lib/work-organization-model';
import { patchTicketOrganization, readTicketOrganization } from '@/lib/work-organization';
export async function GET(request: Request, context: RouteContext) { return handle(async () => json({organization:await readTicketOrganization(await requireOrganizationAccess(request),parseId((await context.params).id))})); }
export async function PATCH(request: Request, context: RouteContext) { return handle(async () => json({organization:await patchTicketOrganization(await requireOrganizationAccess(request),parseId((await context.params).id),await parseBody(request,ticketOrganizationPatchSchema))})); }
