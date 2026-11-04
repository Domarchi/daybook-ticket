import {ApiError,db,handle,json,parseBody,messageSchema,getSettings,parseId,type RouteContext} from '@/lib/server';
import {requireAccess} from '@/lib/access';
import {notificationStatements,drainOutboxBestEffort} from '@/lib/mail';
import {runOperation,lockTicket,publicReplyRecipients,recordEvent,staffNotificationRecipients} from '@/lib/ticket-mutations';
import {linkReadyAttachments} from '@/lib/attachments';
import {after} from 'next/server';
import {processPushOutboxBestEffort} from '@/lib/push';
export async function POST(request:Request,context:RouteContext) {
  return handle(async()=>{
    const access=await requireAccess(request);
    const id=parseId((await context.params).id);
    const data=await parseBody(request,messageSchema);
    const settings=await getSettings(access.ownerId);
    const result=await runOperation(access,data.operationId,'message',{ticketId:id,...data},async(tx,fresh)=>{
      const ticket=await lockTicket(tx,fresh,id);
      const client=fresh.role==='client';
      if(client && data.kind!=='reply') throw new ApiError(403,'Las notas internas están reservadas para el equipo.');
      const now=new Date().toISOString();
      const {rows}=await tx.query('INSERT INTO messages ("ownerId","ticketId",author,"authorMemberId","authorRole",body,kind,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,"ticketId",author,"authorMemberId","authorRole",body,kind,"createdAt"',[access.ownerId,id,fresh.member.name,fresh.member.id,fresh.role,data.body,data.kind,now]);
      const message=rows[0];
      await linkReadyAttachments(tx,fresh,{ids:data.attachmentIds,draftId:data.draftId||data.operationId,kind:data.kind,ticketId:id,messageId:message.id});
      const attachments=await tx.query('SELECT id,name,size,"contentType" FROM attachments WHERE "messageId"=$1 AND "ownerId"=$2 AND status=\'attached\' ORDER BY "createdAt",id',[message.id,access.ownerId]);
      message.attachments=attachments.rows;
      const reopen=client && ticket.status==='resolved';
      await tx.query('UPDATE tickets SET "updatedAt"=$1,version=version+1,status=$2,"dueAt"=$3 WHERE id=$4 AND "ownerId"=$5',[now,reopen?'open':ticket.status,reopen?new Date(Date.parse(now)+settings.slaHours[ticket.priority]*3600000).toISOString():ticket.dueAt,id,access.ownerId]);
      if(reopen) await recordEvent(tx,fresh,id,'status','resolved','open');
      if(data.kind!=='note') {
        const recipients=await publicReplyRecipients(tx,fresh,ticket,client?await staffNotificationRecipients(tx,fresh,ticket.assigneeMemberId,settings):[]);
        for(const recipientMemberId of recipients) for(const stmt of notificationStatements(db(),{ownerId:access.ownerId,event:client?'client_replied':'agent_replied',eventKey:`message:${data.operationId}:${recipientMemberId}`,recipientMemberId,ticketId:id})) await db().execute(stmt,tx);
      }
      return {message};
    });
    after(async()=>{await Promise.allSettled([processPushOutboxBestEffort(access.ownerId),drainOutboxBestEffort(access.ownerId)]);});
    return json(result,201);
  });
}
