import { z } from 'zod';
import { requireAccess } from '@/lib/access';
import { handle, json, parseBody } from '@/lib/server';
import { saveSecurityPolicy } from '@/lib/security';
export async function PATCH(request: Request) {
  return handle(async () =>
    json(
      await saveSecurityPolicy(
        await requireAccess(request),
        await parseBody(
          request,
          z.object({ requireStaffMfa: z.boolean(), version: z.number().int().nonnegative() }).strict(),
        ),
      ),
    ),
  );
}
