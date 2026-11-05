import { requireAccess } from '@/lib/access';
import { handle, json, ApiError, parseId, type RouteContext } from '@/lib/server';
import { getConversationPage } from '@/lib/ticket-search';
import { parseSearchLimit, SearchQueryError } from '@/lib/ticket-search-query';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = await requireAccess(request), id = parseId((await context.params).id);
    try {
      const params = new URL(request.url).searchParams;
      return json(await getConversationPage(access, id, parseSearchLimit(params.get('limit')), params.get('cursor')));
    } catch (error) { if (error instanceof SearchQueryError) throw new ApiError(400, error.message); throw error; }
  });
}
