import { requireAccess } from '@/lib/access';
import { getAlertsPage, markAlertsRead } from '@/lib/alerts';
import { markAlertsSchema, parseAlertsQuery } from '@/lib/alerts-query';
import { ALERT_VIEWER_HEADER, matchesAlertsViewer } from '@/lib/alerts-state';
import { ApiError, handle, json, parseBody } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request);
    const expected = request.headers.get(ALERT_VIEWER_HEADER);
    if (expected !== null && !matchesAlertsViewer(expected, access.member.id)) throw new ApiError(409, 'Tu cuenta cambió. Actualiza Daybook Ticket antes de continuar.');
    return json(await getAlertsPage(access, parseAlertsQuery(new URL(request.url).searchParams)));
  });
}

export async function PATCH(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request);
    if (!matchesAlertsViewer(request.headers.get(ALERT_VIEWER_HEADER), access.member.id)) throw new ApiError(409, 'Tu cuenta cambió. Actualiza Daybook Ticket antes de guardar la lectura.');
    return json(await markAlertsRead(access, await parseBody(request, markAlertsSchema)));
  });
}
