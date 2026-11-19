import { requireAccess } from '@/lib/access';
import { handle } from '@/lib/server';
import { getTicketFeed } from '@/lib/ticket-feed';
import { feedTag, feedUnchanged, getTicketFeedVersion } from '@/lib/ticket-feed-version';

export const dynamic = 'force-dynamic';

/**
 * The automatic refresh. When the browser sends the tag of its last answer and nothing changed, it gets 304 with no
 * body (A1). The tag is computed before the feed is read: a change in between only makes the next poll read again.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request);
    const tag = feedTag(await getTicketFeedVersion(access));
    const headers = { 'Cache-Control': 'no-store', ETag: tag };
    if (feedUnchanged(request.headers.get('if-none-match'), tag)) return new Response(null, { status: 304, headers });
    const feed = await getTicketFeed(access);
    return Response.json({ viewer: access.member, ...feed }, { headers });
  });
}
