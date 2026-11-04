import { ApiError,db,handle,json,parseBody,createTicketSchema,getSettings,checkAssignment } from '@/lib/server';
import { requireAccess,notificationRecipients } from '@/lib/access';
import { notificationStatements,drainOutboxBestEffort } from '@/lib/mail';
import { runOperation,eligibleRecipients,recordEvent } from '@/lib/ticket-mutations';
import { linkReadyAttachments } from '@/lib/attachments';
import {after} from 'next/server';
import {processPushOutboxBestEffort} from '@/lib/push';
export async function POST(request:Request) {
  return handle(async()=>{
    const access=await requireAccess(request);
    const data=await parseBody(request,createTicketSchema);
    const settings=await getSettings(access.ownerId);
    checkAssignment(data,settings);
    const result=await runOperation(access,data.operationId,'ticket',data,async(tx,fresh)=>{
      const client=fresh.role==='client';
      if(client && (data.assigneeMemberId || data.assignee || (data.requesterMemberId && data.requesterMemberId!==fresh.member.id))) throw new ApiError(403,'Solo puedes crear tickets para tu propia cuenta.');
      let requester={requesterMemberId:client?fresh.member.id:null as string|null,requesterName:client?fresh.member.name:data.requesterName||'',requesterEmail:client?fresh.member.email:data.requesterEmail||'',customerCompanyId:client?fresh.member.customerCompanyId:null as string|null};
      if(!client && data.requesterMemberId) {
        const {rows}=await tx.query('SELECT * FROM members WHERE id=$1 AND "ownerId"=$2 AND role=\'client\' AND status<>\'revoked\' FOR SHARE',[data.requesterMemberId,access.ownerId]);
        if(!rows[0]) throw new ApiError(400,'Selecciona una cuenta de cliente habilitada.');
        requester={requesterMemberId:rows[0].id,requesterName:rows[0].name,requesterEmail:rows[0].email,customerCompanyId:rows[0].customerCompanyId};
      }
      if(!requester.requesterName || !requester.requesterEmail) throw new ApiError(400,'Selecciona un cliente o completa su nombre y correo.');
      let assigneeMemberId:string|null=null,assignee='';
      if(!client && data.assigneeMemberId) {
        const {rows}=await tx.query('SELECT id,name FROM members WHERE id=$1 AND "ownerId"=$2 AND status=\'active\' AND role IN (\'owner\',\'admin\',\'agent\')',[data.assigneeMemberId,access.ownerId]);
        if(!rows[0]) throw new ApiError(400,'Selecciona una cuenta activa del equipo.');
        assigneeMemberId=rows[0].id;assignee=rows[0].name;
      } else if(!client && data.assignee) throw new ApiError(400,'Selecciona una cuenta por su identificador.');
      const now=new Date().toISOString();
      const dueAt=new Date(Date.parse(now)+settings.slaHours[data.priority]*3600000).toISOString();
      const {rows}=await tx.query('INSERT INTO tickets ("ownerId","creationKey",subject,"requesterName","requesterEmail","requesterMemberId","customerCompanyId",department,assignee,"assigneeMemberId",status,priority,"createdAt","updatedAt","dueAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,\'open\',$11,$12,$12,$13) RETURNING *',[access.ownerId,data.operationId,data.subject,requester.requesterName,requester.requesterEmail,requester.requesterMemberId,requester.customerCompanyId,data.department,assignee,assigneeMemberId,data.priority,now,dueAt]);
      const ticket=rows[0];
      const message=await tx.query('INSERT INTO messages ("ownerId","ticketId",author,"authorMemberId","authorRole",body,kind,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,\'request\',$7) RETURNING id',[access.ownerId,ticket.id,fresh.member.name,fresh.member.id,fresh.role,data.body,now]);
      await linkReadyAttachments(tx,fresh,{ids:data.attachmentIds,draftId:data.draftId||data.operationId,kind:'request',ticketId:ticket.id,messageId:message.rows[0].id});
      await recordEvent(tx,fresh,ticket.id,'created',null,'open');
      const recipients=await eligibleRecipients(tx,fresh,ticket,await notificationRecipients(fresh,assigneeMemberId));
      for(const recipientMemberId of recipients) for(const stmt of notificationStatements(db(),{ownerId:access.ownerId,event:'ticket_created',eventKey:`ticket:${data.operationId}:${recipientMemberId}`,recipientMemberId,ticketId:ticket.id})) await db().execute(stmt,tx);
      return {ticket};
    });
    after(async()=>{await Promise.allSettled([processPushOutboxBestEffort(access.ownerId),drainOutboxBestEffort(access.ownerId)]);});
    return json(result,201);
  });
}
