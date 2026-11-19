import { requireAccess, requireAdmin } from '@/lib/access';
import { createPasswordResetLink } from '@/lib/password-reset-links';
import { consumeRateLimit, RATE_RULES } from '@/lib/rate-limit';
import { handle, json, type RouteContext } from '@/lib/server';

/**
 * «Enlace para nueva contraseña»: an admin creates a single-use link for one active account and hands it over, because
 * recovery mail is off (Fase 7). Admins only, with a recent password check like every write under /api/members.
 */
export async function POST(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    await consumeRateLimit(access, RATE_RULES.passwordResetLink);
    return json(await createPasswordResetLink(access, (await context.params).id));
  });
}
