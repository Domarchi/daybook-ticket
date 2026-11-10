import { requireAccess, requireStaff } from '@/lib/access';
import { handle, json, ApiError } from '@/lib/server';
import { getContactPage } from '@/lib/ticket-search';
import { parseSearchLimit, SearchQueryError } from '@/lib/ticket-search-query';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(async () => {
    const access = requireStaff(await requireAccess(request));
    try {
      const params = new URL(request.url).searchParams;
      return json(await getContactPage(access, parseSearchLimit(params.get('limit')), params.get('cursor')));
    } catch (error) {
      if (error instanceof SearchQueryError) throw new ApiError(400, error.message);
      throw error;
    }
  });
}
