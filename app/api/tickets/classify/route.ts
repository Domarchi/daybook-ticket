import { requireAccess, requireAdmin } from '@/lib/access';
import { ApiError, handle, json, parseBody } from '@/lib/server';
import { applyUnclassified, previewUnclassified } from '@/lib/ticket-backfill';
import { backfillIds } from '@/lib/ticket-backfill-model';
import { z } from 'zod';
export const dynamic = 'force-dynamic';

/** Administrators: the old tickets without a category, with what the classifier suggests. Writes nothing. */
export async function GET(request: Request) {
  return handle(async () => json(await previewUnclassified(requireAdmin(await requireAccess(request)))));
}

/** Administrators: store the suggestion for the reviewed tickets (only those still without a category). */
export async function POST(request: Request) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    const body = await parseBody(request, z.object({ ticketIds: z.array(z.number()) }).strict());
    const ids = backfillIds(body.ticketIds);
    if (!ids) throw new ApiError(400, 'Selecciona entre 1 y 200 tickets para clasificar.');
    return json(await applyUnclassified(access, ids));
  });
}
