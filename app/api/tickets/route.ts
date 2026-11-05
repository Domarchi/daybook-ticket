import {enqueueAutomationEvent,drainAutomationBestEffort} from '@/lib/automation';
import {prepareTicketOrganization,saveTicketOrganization} from '@/lib/work-organization';
import {getEvolutionFeatures,requireEvolutionFeature} from '@/lib/evolution-features';
import { ApiError,db,handle,json,parseBody,createTicketSchema,checkAssignment } from '@/lib/server';
import { getSettingsInTransaction } from '@/lib/settings-transaction';
import { getEffectiveServicePolicy } from '@/lib/service-policies';
import { resolutionDeadline } from '@/lib/ticket-sla';
import { chooseAutomaticAssignee } from '@/lib/automatic-assignment';
import { requireAccess } from '@/lib/access';
import { notificationStatements,drainOutboxBestEffort } from '@/lib/mail';
import { runOperation,eligibleRecipients,recordEvent,recordAutomaticAssignmentEvent,staffNotificationRecipients } from '@/lib/ticket-mutations';
import { linkReadyAttachments } from '@/lib/attachments';
import {after} from 'next/server';
import {processPushOutboxBestEffort} from '@/lib/push';
export async function POST(request:Request) {
  return handle(async()=>{
    const access=await requireAccess(request);
    const data=await parseBody(request,createTicketSchema);
    const organizationEnabled=(await getEvolutionFeatures(access.ownerId)).features.organization;
    if(data.requestTypeId!==undefined||data.fieldValues!==undefined)await requireEvolutionFeature(access,'organization');
    const result=await runOperation(access,data.operationId,'ticket',data,async(tx,fresh)=>{
      const settings=await getSettingsInTransaction(tx,access.ownerId);
      checkAssignment(data,settings);
      const client=fresh.role==='client';
      if(client && (data.assigneeMemberId || data.assignee || (data.requesterMemberId && data.requesterMemberId!==fresh.member.id))) throw new ApiError(403,'Solo puedes crear tickets para tu propia cuenta.');
      let requesterIsTest=client && Boolean(fresh.member.isTest);
      let requester={requesterMemberId:client?fresh.member.id:null as string|null,requesterName:client?fresh.member.name:data.requesterName||'',requesterEmail:client?fresh.member.email:data.requesterEmail||'',customerCompanyId:client?fresh.member.customerCompanyId:null as string|null};
      if(!client && data.requesterMemberId) {
        const {rows}=await tx.query('SELECT * FROM members WHERE id=$1 AND "ownerId"=$2 AND role=\'client\' AND status<>\'revoked\'',[data.requesterMemberId,access.ownerId]);
        if(!rows[0]) throw new ApiError(400,'Selecciona una cuenta de cliente habilitada.');
        requesterIsTest=Boolean(rows[0].isTest);
        requester={requesterMemberId:rows[0].id,requesterName:rows[0].name,requesterEmail:rows[0].email,customerCompanyId:rows[0].customerCompanyId};
      }
      if(!requester.requesterName || !requester.requesterEmail) throw new ApiError(400,'Selecciona un cliente o completa su nombre y correo.');
      const organization=organizationEnabled?await prepareTicketOrganization(tx,fresh,{customerCompanyId:requester.customerCompanyId,requestTypeId:data.requestTypeId,fieldValues:data.fieldValues}):null;
      let assigneeMemberId:string|null=null,assignee='';
      if(!client && data.assigneeMemberId) {
        const {rows}=await tx.query('SELECT id,name FROM members WHERE id=$1 AND "ownerId"=$2 AND status=\'active\' AND role IN (\'owner\',\'admin\',\'agent\')',[data.assigneeMemberId,access.ownerId]);
        if(!rows[0]) throw new ApiError(400,'Selecciona una cuenta activa del equipo.');
        assigneeMemberId=rows[0].id;assignee=rows[0].name;
      } else if(!client && data.assignee) throw new ApiError(400,'Selecciona una cuenta por su identificador.');
      const now=new Date().toISOString();
      const automatic=!assigneeMemberId && (client || data.assigneeMemberId===undefined)
        ? await chooseAutomaticAssignee(tx,access.ownerId,{customerCompanyId:requester.customerCompanyId,department:data.department},now) : null;
      if(automatic) {assigneeMemberId=automatic.id;assignee=automatic.name;}
      const policy=await getEffectiveServicePolicy(tx,access.ownerId,requester.customerCompanyId,settings.slaHours);
      const dueAt=resolutionDeadline(now,data.priority,policy);
      const {rows}=await tx.query('INSERT INTO tickets ("ownerId","creationKey",subject,"requesterName","requesterEmail","requesterMemberId","customerCompanyId",department,assignee,"assigneeMemberId",status,priority,"createdAt","updatedAt","dueAt","slaPolicySnapshot","slaStartedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,\'open\',$11,$12,$12,$13,$14,$12) RETURNING *',[access.ownerId,data.operationId,data.subject,requester.requesterName,requester.requesterEmail,requester.requesterMemberId,requester.customerCompanyId,data.department,assignee,assigneeMemberId,data.priority,now,dueAt,JSON.stringify(policy)]);
      const ticket=rows[0];
      if(organization)await saveTicketOrganization(tx,fresh,ticket.id,organization);
      if(requesterIsTest) {await tx.query('UPDATE tickets SET "isTest"=true WHERE id=$1 AND "ownerId"=$2',[ticket.id,access.ownerId]);ticket.isTest=true;}
      const message=await tx.query('INSERT INTO messages ("ownerId","ticketId",author,"authorMemberId","authorRole",body,kind,"createdAt","bodyFormat") VALUES ($1,$2,$3,$4,$5,$6,\'request\',$7,$8) RETURNING id',[access.ownerId,ticket.id,fresh.member.name,fresh.member.id,fresh.role,data.body,now,data.bodyFormat || 'plain']);
      await linkReadyAttachments(tx,fresh,{ids:data.attachmentIds,draftId:data.draftId||data.operationId,kind:'request',ticketId:ticket.id,messageId:message.rows[0].id});
      await recordEvent(tx,fresh,ticket.id,'created',null,'open');
      if(automatic) await recordAutomaticAssignmentEvent(tx,access.ownerId,ticket.id,automatic);
      const recipients=await eligibleRecipients(tx,fresh,ticket,await staffNotificationRecipients(tx,fresh,assigneeMemberId,settings));
      for(const recipientMemberId of recipients) for(const stmt of notificationStatements(db(),{ownerId:access.ownerId,event:'ticket_created',eventKey:`ticket:${data.operationId}:${recipientMemberId}`,recipientMemberId,ticketId:ticket.id})) await db().execute(stmt,tx);
      await enqueueAutomationEvent(tx,fresh,ticket.id,`ticket:${data.operationId}`,'ticket_created');
      return {ticket};
    });
    after(async()=>{await Promise.allSettled([processPushOutboxBestEffort(access.ownerId),drainOutboxBestEffort(access.ownerId),drainAutomationBestEffort(access.ownerId)]);});
    // A policy snapshot is internal configuration, not customer-facing metadata.
    const {slaPolicySnapshot: _policy,slaStartedAt: _started,...publicTicket}=result.ticket;
    void _policy; void _started;
    return json({ticket:publicTicket},201);
  });
}
