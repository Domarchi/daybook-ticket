import { ApiError, db, handle, json, type RouteContext } from '@/lib/server';
import { requireAccess, requireAdmin, getMember, checkMemberChange } from '@/lib/access';
import { prepareInvitation } from '@/lib/invitations';
import { notificationStatements, drainOutboxBestEffort } from '@/lib/mail';
import { after } from 'next/server';
export async function POST(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    const member = await getMember(access, (await context.params).id);
    checkMemberChange(access, member, {});
    if (member.status !== 'invited' || member.userId) throw new ApiError(400, 'Solo puedes renovar invitaciones pendientes de aceptación.');
    const database = db();
    const invitation = await prepareInvitation(database, access.ownerId, member.id);
    await database.batch([
      invitation.statement,
      database.prepare("UPDATE \"mailOutbox\" SET status = 'cancelled', \"updatedAt\" = $1, \"nextAttemptAt\" = NULL WHERE \"ownerId\" = $2 AND \"recipientMemberId\" = $3 AND event = 'invitation' AND status IN ('queued', 'awaiting_configuration')").bind(new Date().toISOString(), access.ownerId, member.id),
      ...notificationStatements(database, { ownerId: access.ownerId, event: 'invitation', eventKey: `invitation:${crypto.randomUUID()}:${member.id}`, recipientMemberId: member.id, actionUrl: invitation.url, expiresAt: invitation.expiresAt }),
    ]);
    after(async () => { await drainOutboxBestEffort(access.ownerId); });
    return json({ invitationUrl: invitation.url });
  });
}
