import {acquireTicketWorkLock} from '@/lib/work-lock';
import {lockAccess} from '@/lib/ticket-mutations';
import { ApiError, db, handle, json, type RouteContext } from '@/lib/server';
import { requireAccess, requireAdmin, checkMemberChange,type MemberRecord } from '@/lib/access';
import { prepareInvitation } from '@/lib/invitations';
import { notificationStatements, drainOutboxBestEffort } from '@/lib/mail';
import { after } from 'next/server';
export async function POST(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    const database=db();
    const invitationUrl=await database.transaction(async tx=>{
      await acquireTicketWorkLock(tx,access.ownerId);
      const fresh=requireAdmin(await lockAccess(tx,access)),id=(await context.params).id;
      const member=(await tx.query<MemberRecord>('SELECT * FROM members WHERE id=$1 AND "ownerId"=$2 AND "organizationId"=$3 FOR UPDATE',[id,fresh.ownerId,fresh.organizationId])).rows[0];
      if(!member)throw new ApiError(404,'La cuenta no está disponible.');
      checkMemberChange(fresh,member,{});
      if(member.status!=='invited'||member.userId)throw new ApiError(400,'Solo puedes renovar invitaciones pendientes de aceptación.');
      const invitation=await prepareInvitation(database,fresh.ownerId,member.id);
      await database.execute(invitation.statement,tx);
      await tx.query('UPDATE "mailOutbox" SET status=\'cancelled\',"updatedAt"=$1,"nextAttemptAt"=NULL WHERE "ownerId"=$2 AND "recipientMemberId"=$3 AND event=\'invitation\' AND status IN (\'queued\',\'awaiting_configuration\')',[new Date().toISOString(),fresh.ownerId,member.id]);
      for(const statement of notificationStatements(database,{ownerId:fresh.ownerId,event:'invitation',eventKey:`invitation:${crypto.randomUUID()}:${member.id}`,recipientMemberId:member.id,actionUrl:invitation.url,expiresAt:invitation.expiresAt}))await database.execute(statement,tx);
      return invitation.url;
    });
    after(async () => { await drainOutboxBestEffort(access.ownerId); });
    return json({invitationUrl});
  });
}
