import { z } from 'zod';
import { requireAccess } from '@/lib/access';
import { handle, json, parseBody, ApiError } from '@/lib/server';
import { daybookAuth } from '@/lib/daybook-auth';
import {
  acknowledgeRecovery,
  consumeSecurityAttempt,
  getSecurityStatus,
  recordCurrentPasswordProof,
} from '@/lib/security';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(async () => json(await getSecurityStatus(await requireAccess(request, { allowSecuritySetup: true }))));
}
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reauthenticate'), password: z.string().min(1).max(128) }).strict(),
  z.object({ action: z.literal('acknowledge_recovery'), confirmed: z.literal(true) }).strict(),
]);
export async function POST(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request, { allowSecuritySetup: true }),
      input = await parseBody(request, schema);
    if (input.action === 'acknowledge_recovery') await acknowledgeRecovery(access);
    else {
      await consumeSecurityAttempt(access);
      try {
        await daybookAuth().api.verifyPassword({ headers: request.headers, body: { password: input.password } });
      } catch {
        throw new ApiError(403, 'No se pudo verificar tu contraseña.');
      }
      await recordCurrentPasswordProof(access);
    }
    return json(await getSecurityStatus(access));
  });
}
