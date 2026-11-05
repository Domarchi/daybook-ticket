import { requireAccess } from '@/lib/access';
import { handle, json, db } from '@/lib/server';
import { inboundConfiguration, makeInboundAddress } from '@/lib/inbound-email-validation';

export async function GET(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request), config = inboundConfiguration();
    const address = access.role === 'client' ? makeInboundAddress({
      kind: 'new', id: access.member.id, ownerId: access.ownerId, memberId: access.member.id, email: access.member.email,
    }, config) : null;
    const administrator = ['owner', 'admin'].includes(access.role);
    const recent = administrator ? (await db().prepare(`SELECT "providerId",status,"reasonCode","ticketId","messageId","createdAt"
      FROM "inboundMailReceipts" WHERE "ownerId"=$1 ORDER BY "createdAt" DESC,"providerId" DESC LIMIT 25`).bind(access.ownerId).all()).results : undefined;
    return json({ configured: config.enabled, domain: administrator ? config.domain : undefined, address, recent });
  });
}
