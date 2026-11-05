import { requireAccess } from '@/lib/access';
import { handle, json, parseBody } from '@/lib/server';
import { listAgentAvailability, patchAgentAvailabilitySchema, updateAgentAvailability } from '@/lib/assignment-rules';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handle(async () => json({ agents: await listAgentAvailability(await requireAccess(request)) }));
}

export async function PATCH(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request);
    const data = await parseBody(request, patchAgentAvailabilitySchema);
    return json({ agent: await updateAgentAvailability(access, data) });
  });
}
