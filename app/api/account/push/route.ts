import { z } from 'zod';
import { requireIdentityAccess } from '@/lib/identity-access';
import { db, handle, json, parseBody } from '@/lib/server';
import { pushEndpointSchema } from '@/lib/push-validation';
/** Global sign-out disables this identity's device bindings across spaces, without exposing their content. */
export async function DELETE(request: Request) {
  return handle(async () => {
    const identity = await requireIdentityAccess(request),
      { endpoint } = await parseBody(request, z.object({ endpoint: pushEndpointSchema }).strict());
    await db().transaction(async tx => {
      const now = new Date().toISOString();
      await tx.query(
        `UPDATE "pushSubscriptions" s SET active=false,"updatedAt"=$1 FROM members m WHERE m.id=s."memberId" AND m."ownerId"=s."ownerId" AND m."userId"=$2 AND s.endpoint=$3`,
        [now, identity.userId, endpoint],
      );
      await tx.query(
        `UPDATE "pushDeliveries" d SET status='cancelled',"leaseUntil"=NULL,"updatedAt"=$1 FROM "pushSubscriptions" s,members m WHERE d."subscriptionId"=s.id AND d."ownerId"=s."ownerId" AND m.id=s."memberId" AND m."ownerId"=s."ownerId" AND m."userId"=$2 AND s.endpoint=$3 AND d.status IN ('queued','processing')`,
        [now, identity.userId, endpoint],
      );
    });
    return json({ ok: true });
  });
}
