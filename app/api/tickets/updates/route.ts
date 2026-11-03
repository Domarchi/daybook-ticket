import { requireAccess } from '@/lib/access';
import { handle, json } from '@/lib/server';
import { getTicketFeed } from '@/lib/ticket-feed';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request);
    const feed = await getTicketFeed(access);
    return json({ viewer: access.member, ...feed });
  });
}
