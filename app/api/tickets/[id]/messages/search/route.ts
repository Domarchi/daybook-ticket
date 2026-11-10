import { z } from 'zod';
import { requireAccess } from '@/lib/access';
import { handle, json, parseId, type RouteContext, ApiError } from '@/lib/server';
import { requireEvolutionFeature } from '@/lib/evolution-features';
import { searchTicketMessages } from '@/lib/ticket-collaboration';
import { SearchQueryError } from '@/lib/ticket-search-query';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = await requireAccess(request);
    await requireEvolutionFeature(access, 'collaboration');
    const query = new URL(request.url).searchParams;
    const q = z.string().trim().min(1).max(200).parse(query.get('q'));
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .parse(query.get('limit') || 20);
    try {
      return json(
        await searchTicketMessages(access, parseId((await context.params).id), {
          q,
          limit,
          cursor: query.get('cursor'),
        }),
      );
    } catch (error) {
      if (error instanceof SearchQueryError) throw new ApiError(400, error.message);
      throw error;
    }
  });
}
