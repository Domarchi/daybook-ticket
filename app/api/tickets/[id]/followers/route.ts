import { requireAccess } from '@/lib/access';
import { handle, json, parseBody, parseId, type RouteContext } from '@/lib/server';
import { requireEvolutionFeature } from '@/lib/evolution-features';
import { followerSchema } from '@/lib/collaboration-model';
import { getTicketFollowers, setTicketFollowing } from '@/lib/ticket-collaboration';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = await requireAccess(request);
    await requireEvolutionFeature(access, 'collaboration');
    return json(await getTicketFollowers(access, parseId((await context.params).id)));
  });
}
export async function PUT(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = await requireAccess(request);
    await requireEvolutionFeature(access, 'collaboration');
    return json(
      await setTicketFollowing(
        access,
        parseId((await context.params).id),
        (await parseBody(request, followerSchema)).following,
      ),
    );
  });
}
