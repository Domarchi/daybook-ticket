import { z } from 'zod';
import { requireAccess, requireAdmin } from '@/lib/access';
import { handle, json, parseBody } from '@/lib/server';
import { configureWorkspace, transferWorkspaceOwner, workspaceOnboarding } from '@/lib/workspaces';
export async function GET(request: Request) {
  return handle(async () =>
    json(await workspaceOnboarding(requireAdmin(await requireAccess(request, { allowSecuritySetup: true })))),
  );
}
export async function PATCH(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request),
      input = await parseBody(
        request,
        z.discriminatedUnion('action', [
          z
            .object({
              action: z.literal('configure'),
              brandName: z.string().trim().min(1).max(120),
              mailFrom: z.string().trim().min(3).max(200).nullable(),
              mailEnabled: z.boolean(),
              inboundEnabled: z.boolean(),
              expectedVersion: z.number().int().nonnegative(),
            })
            .strict(),
          z.object({ action: z.literal('transfer_owner'), memberId: z.string().uuid() }).strict(),
        ]),
      );
    return json(
      input.action === 'transfer_owner'
        ? await transferWorkspaceOwner(access, input.memberId)
        : await configureWorkspace(access, input),
    );
  });
}
