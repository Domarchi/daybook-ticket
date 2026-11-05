import { requireAccess } from '@/lib/access';
import { handle, json, ApiError } from '@/lib/server';
import { getTicketPage } from '@/lib/ticket-search';
import { parseTicketSearch, SearchQueryError } from '@/lib/ticket-search-query';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request);
    try { return json(await getTicketPage(access, parseTicketSearch(new URL(request.url).searchParams))); }
    catch (error) { if (error instanceof SearchQueryError) throw new ApiError(400, error.message); throw error; }
  });
}
