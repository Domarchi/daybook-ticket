import { requireAccess, requireAdmin } from '@/lib/access';
import { renewInvitationLinks } from '@/lib/invitation-links';
import { renewInvitationsSchema } from '@/lib/invitation-links-model';
import { consumeRateLimit, RATE_RULES } from '@/lib/rate-limit';
import { handle, json, parseBody } from '@/lib/server';

/** Up to 500 links in one transaction. */
export const maxDuration = 60;

/**
 * «Renovar enlaces»: new links for many pending invitations at once, answered once for the admin to hand out (Fase 7).
 * Admins only, with a recent password check like every write under /api/members. No mail is queued.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    await consumeRateLimit(access, RATE_RULES.memberImport);
    const { memberIds } = await parseBody(request, renewInvitationsSchema, 60_000);
    return json(await renewInvitationLinks(access, memberIds));
  });
}
