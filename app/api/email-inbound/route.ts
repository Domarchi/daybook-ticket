import { workspaceDeliveryContext } from '@/lib/workspace-delivery';
import { requireAccess, requireAdmin } from '@/lib/access';
import { handle, json, db } from '@/lib/server';
import { inboundConfiguration, makeInboundAddress } from '@/lib/inbound-email-validation';
import { inboundMailHealth } from '@/lib/inbound-email-jobs';
import { acquireTicketWorkLock } from '@/lib/work-lock';
import { lockAccess } from '@/lib/ticket-mutations';

export async function GET(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request), config = inboundConfiguration();
    const workspace=await workspaceDeliveryContext(db(),access.ownerId);
    const address = access.role === 'client' && workspace.inbound ? makeInboundAddress({
      kind: 'new', id: access.member.id, ownerId: access.ownerId, memberId: access.member.id, email: access.member.email,
    }, config) : null;
    const administrator = ['owner', 'admin'].includes(access.role);
    const audit = administrator ? await db().transaction(async tx => {
      await acquireTicketWorkLock(tx, access.ownerId);
      requireAdmin(await lockAccess(tx, access));
      const recent = (await tx.query(`SELECT "providerId",status,"reasonCode","ticketId","messageId","createdAt"
        FROM "inboundMailReceipts" WHERE "ownerId"=$1 AND environment=$2 ORDER BY "createdAt" DESC,"providerId" DESC LIMIT 25`, [access.ownerId, config.environment])).rows;
      return { recent, ...await inboundMailHealth(db(), access.ownerId, config.environment, tx) };
    }) : undefined;
    return json({ configured: config.enabled&&workspace.inbound, domain: administrator ? config.domain : undefined, address, ...audit });
  });
}
