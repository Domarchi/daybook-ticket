import { z } from 'zod';
import { requireAccess } from '@/lib/access';
import { ApiError, handle, json, parseBody } from '@/lib/server';
import {
  getPushSubscriptionStatus,
  pushConfiguration,
  registerPushSubscription,
  unregisterPushSubscription,
} from '@/lib/push';
import { pushEndpointSchema, pushSubscriptionSchema } from '@/lib/push-validation';

const endpointSchema = z.object({ endpoint: pushEndpointSchema }).strict();
export async function GET(request: Request) {
  return handle(async () => {
    await requireAccess(request);
    return json(pushConfiguration());
  });
}
export async function POST(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request);
    const { subscription, expectedMemberId } = await parseBody(
      request,
      z.object({ subscription: pushSubscriptionSchema, expectedMemberId: z.string().uuid() }).strict(),
    );
    if (expectedMemberId !== access.member.id)
      throw new ApiError(409, 'Tu sesión cambió. Actualiza la página antes de activar los avisos.');
    return json(await registerPushSubscription(access, subscription), 201);
  });
}
export async function PATCH(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request);
    const { endpoint } = await parseBody(request, endpointSchema);
    return json(await getPushSubscriptionStatus(access, endpoint));
  });
}
export async function DELETE(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request);
    const { endpoint } = await parseBody(request, endpointSchema);
    return json(await unregisterPushSubscription(access, endpoint));
  });
}
