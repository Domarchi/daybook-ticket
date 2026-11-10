import { requireAccess } from '@/lib/access';
import { handle, json, parseId, type RouteContext } from '@/lib/server';
import { requireEvolutionFeature } from '@/lib/evolution-features';
import { getTicketFiles } from '@/lib/ticket-collaboration';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = await requireAccess(request);
    await requireEvolutionFeature(access, 'collaboration');
    return json(await getTicketFiles(access, parseId((await context.params).id), new URL(request.url).searchParams));
  });
}
