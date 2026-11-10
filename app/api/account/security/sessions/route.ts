import { sessionRevocationSchema } from '@/lib/security-model';
import { requireIdentityAccess } from '@/lib/identity-access';
import { handle, json, parseBody } from '@/lib/server';
import { listOwnSessions, revokeOwnSessions } from '@/lib/security';
export async function GET(request: Request) {
  return handle(async () => json(await listOwnSessions(await requireIdentityAccess(request))));
}
export async function DELETE(request: Request) {
  return handle(async () =>
    json(
      await revokeOwnSessions(await requireIdentityAccess(request), await parseBody(request, sessionRevocationSchema)),
    ),
  );
}
