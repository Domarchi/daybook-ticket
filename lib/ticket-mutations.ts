import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ApiError, db } from './server';
import { acquireTicketWorkLock } from './work-lock';
import { getSettingsInTransaction } from './settings-transaction';
import { getEffectiveServicePolicy } from './service-policies';
import { resolutionDeadline, storedTicketPolicy } from './ticket-sla';
import { recordSlaOutcome } from './agent-metrics';
import { createSatisfactionForResolution } from './satisfaction';
import { canAccessTicket, publicMember, type AccessContext, type MemberRecord } from './access';
import type { Settings, Ticket, TicketEvent } from './types';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>`${JSON.stringify(key)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function operationHash(value: unknown) { return createHash('sha256').update(canonical(value)).digest('hex'); }

// Hold current membership until commit; authorization cannot use a stale session.
// NO KEY UPDATE also permits foreign-key checks from other members' submissions.
export async function lockAccess(tx: PoolClient, access: AccessContext): Promise<AccessContext> {
  const { rows } = await tx.query('SELECT * FROM members WHERE id=$1 AND "ownerId"=$2 AND "organizationId"=$3 AND status=\'active\' AND "userId"=$4 FOR NO KEY UPDATE',[access.member.id,access.ownerId,access.organizationId,access.userId]);
  const row=rows[0] as MemberRecord|undefined;
  if(!row) throw new ApiError(403,'Tu acceso cambió. Inicia sesión nuevamente.');
  return {...access,role:row.role,member:publicMember({...row,hasAccount:true})};
}
export async function lockTicket(tx: PoolClient, access: AccessContext,id:number): Promise<Ticket & {ownerId:string}> {
  const {rows}=await tx.query('SELECT * FROM tickets WHERE id=$1 AND "ownerId"=$2 FOR UPDATE',[id,access.ownerId]);
  const ticket=rows[0];
  if(!ticket || !canAccessTicket(access,ticket)) throw new ApiError(404,'El ticket no existe o no tienes acceso.');
  return ticket;
}
export async function runOperation<T>(access: AccessContext,id:string,kind:string,payload:unknown,work:(tx:PoolClient,fresh:AccessContext)=>Promise<T>):Promise<T> {
  const hash=operationHash(payload);
  return db().transaction(async tx=>{
    await acquireTicketWorkLock(tx, access.ownerId);
    const fresh=await lockAccess(tx,access);
    await tx.query('INSERT INTO operations ("operationId","ownerId","memberId",kind,"requestHash","resultJson","createdAt") VALUES ($1,$2,$3,$4,$5,\'null\',$6) ON CONFLICT ("operationId") DO NOTHING',[id,access.ownerId,access.member.id,kind,hash,new Date().toISOString()]);
    const {rows}=await tx.query('SELECT * FROM operations WHERE "operationId"=$1 FOR UPDATE',[id]);
    const previous=rows[0];
    if(previous.ownerId!==access.ownerId || previous.memberId!==access.member.id || previous.kind!==kind || previous.requestHash!==hash) throw new ApiError(409,'Esta operación ya se utilizó con otros datos. Actualiza el envío.');
    if(previous.resultJson!=='null') {
      const result=JSON.parse(previous.resultJson) as T;
      if(fresh.role==='client' && (result as {message?:{kind:string}}).message?.kind==='note') throw new ApiError(403,'Las notas internas están reservadas para el equipo.');
      const ticketId=(result as {ticket?:Ticket;message?:{ticketId:number}}).ticket?.id ?? (result as {message?:{ticketId:number}}).message?.ticketId;
      if(ticketId) await lockTicket(tx,fresh,ticketId);
      return result;
    }
    const result=await work(tx,fresh);
    await tx.query('UPDATE operations SET "resultJson"=$1 WHERE "operationId"=$2',[JSON.stringify(result),id]);
    return result;
  });
}
export async function recordEvent(tx:PoolClient,access:AccessContext,ticketId:number,action:string,before:unknown,after:unknown) {
  const encode=(v:unknown)=>v===null||v===undefined?null:typeof v==='string'?v:JSON.stringify(v);
  await tx.query('INSERT INTO "ticketEvents" (id,"ownerId","ticketId","actorMemberId","actorName",action,"beforeValue","afterValue","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',[crypto.randomUUID(),access.ownerId,ticketId,access.member.id,access.member.name,action,encode(before),encode(after),new Date().toISOString()]);
}
export async function recordAutomaticAssignmentEvent(tx: PoolClient, ownerId: string, ticketId: number, target: { id: string; name: string; ruleId: string }) {
  await tx.query(`INSERT INTO "ticketEvents" (id,"ownerId","ticketId","actorMemberId","actorName",action,"beforeValue","afterValue","createdAt")
    VALUES ($1,$2,$3,NULL,'Daybook Ticket','automatic_assignment',NULL,$4,$5)`,
  [crypto.randomUUID(), ownerId, ticketId, JSON.stringify({ memberId: target.id, name: target.name, ruleId: target.ruleId }), new Date().toISOString()]);
}
export async function eligibleRecipients(tx:PoolClient,access:AccessContext,ticket:Ticket & {ownerId:string},ids:string[]) {
  if(!ids.length) return [];
  const {rows}=await tx.query('SELECT * FROM members WHERE "ownerId"=$1 AND status=\'active\' AND id=ANY($2::text[])',[access.ownerId,[...new Set(ids)].filter(id=>id!==access.member.id)]);
  return rows.filter(row=>canAccessTicket({...access,role:row.role,member:publicMember({...row,hasAccount:Boolean(row.userId)})},ticket)).map(row=>row.id as string);
}
// Reuse the transaction's connection: an external settings/recipient query here
// can exhaust the pool when multiple clients submit at the same time.
export async function staffNotificationRecipients(tx: PoolClient, access: AccessContext, assigneeId: string | null, settings: Settings): Promise<string[]> {
  const { rows } = await tx.query('SELECT id FROM members WHERE "ownerId"=$1 AND "organizationId"=$2 AND status=\'active\' AND role IN (\'owner\',\'admin\',\'agent\')', [access.ownerId, access.organizationId]);
  const active = rows.map(row => row.id as string);
  if (settings.notificationMemberIds.length) {
    const selected = new Set([...settings.notificationMemberIds, ...(assigneeId ? [assigneeId] : [])]);
    return active.filter(id => selected.has(id));
  }
  return assigneeId && active.includes(assigneeId) ? [assigneeId] : active;
}
export async function publicReplyRecipients(tx:PoolClient,access:AccessContext,ticket:Ticket & {ownerId:string},staffIds:string[]) {
  if(access.role==='client') return eligibleRecipients(tx,access,ticket,[...staffIds,...(ticket.requesterMemberId?[ticket.requesterMemberId]:[])]);
  const {rows}=await tx.query('SELECT DISTINCT m.id FROM messages p JOIN members m ON m.id=p."authorMemberId" AND m."ownerId"=p."ownerId" WHERE p."ticketId"=$1 AND p."ownerId"=$2 AND p.kind<>\'note\' AND m.role=\'client\' AND m."companyAccess"=\'manager\'',[ticket.id,access.ownerId]);
  return eligibleRecipients(tx,access,ticket,[...(ticket.requesterMemberId?[ticket.requesterMemberId]:[]),...rows.map(row=>row.id)]);
}
export async function patchTicket(access:AccessContext,id:number,data:Record<string,unknown>,claim=false) {
  return db().transaction(async tx=>{
    await acquireTicketWorkLock(tx, access.ownerId);
    const fresh=await lockAccess(tx,access);
    const settings=await getSettingsInTransaction(tx, access.ownerId);
    if(fresh.role==='client') throw new ApiError(403,'Esta acción está disponible solo para el equipo.');
    const old=await lockTicket(tx,fresh,id);
    const assigning=claim || 'assigneeMemberId' in data || 'assignee' in data;
    if(assigning && data.expectedVersion!==old.version) throw new ApiError(409,'El ticket cambió. Revisa su responsable antes de continuar.');
    if(claim && old.assigneeMemberId) throw new ApiError(409,`El ticket ya está asignado a ${old.assignee}.`);
    const changes:Record<string,unknown>={};
    if(data.isTest!==undefined) {
      if(!['owner','admin'].includes(fresh.role)) throw new ApiError(403,'Solo los administradores pueden marcar pruebas.');
      if(data.expectedVersion!==old.version) throw new ApiError(409,'El ticket cambió. Actualiza antes de marcarlo.');
      if(typeof data.isTest!=='boolean') throw new ApiError(400,'La marca de prueba no es válida.');
      if(data.isTest!==Boolean(old.isTest)) changes.isTest=data.isTest;
    }
    for(const key of ['subject','department','priority','status']) if(data[key]!==undefined && data[key]!==old[key as keyof Ticket]) changes[key]=data[key];
    if(data.department!==undefined && !settings.departments.includes(String(data.department))) throw new ApiError(400,'Selecciona un departamento válido.');
    if(assigning) {
      const targetId=claim?fresh.member.id:data.assigneeMemberId;
      if(!claim && data.assignee!==undefined && data.assigneeMemberId===undefined) throw new ApiError(400,'Selecciona una cuenta por su identificador.');
      const {rows}=targetId?await tx.query('SELECT id,name FROM members WHERE id=$1 AND "ownerId"=$2 AND status=\'active\' AND role IN (\'owner\',\'admin\',\'agent\')',[targetId,access.ownerId]):{rows:[]};
      if(targetId && !rows[0]) throw new ApiError(400,'Selecciona un agente activo.');
      if((targetId||null)!==old.assigneeMemberId) {changes.assigneeMemberId=targetId||null;changes.assignee=rows[0]?.name||'';}
    }
    if(data.requesterMemberId!==undefined && data.requesterMemberId!==old.requesterMemberId) {
      if(data.requesterMemberId) {
        const {rows}=await tx.query('SELECT id,name,email FROM members WHERE id=$1 AND "ownerId"=$2 AND role=\'client\' AND status<>\'revoked\'',[data.requesterMemberId,access.ownerId]);
        if(!rows[0]) throw new ApiError(400,'Selecciona una cuenta de cliente habilitada.');
        Object.assign(changes,{requesterMemberId:rows[0].id,requesterName:rows[0].name,requesterEmail:rows[0].email});
      } else changes.requesterMemberId=null;
    }
    if(data.customerCompanyId!==undefined && data.customerCompanyId!==old.customerCompanyId) {
      if(!['owner','admin'].includes(fresh.role)) throw new ApiError(403,'Solo los administradores pueden cambiar la empresa.');
      if(data.customerCompanyId) {
        const {rows}=await tx.query('SELECT id FROM "customerCompanies" WHERE id=$1 AND "ownerId"=$2 FOR SHARE',[data.customerCompanyId,access.ownerId]);
        if(!rows[0]) throw new ApiError(400,'Selecciona una empresa válida.');
      }
      changes.customerCompanyId=data.customerCompanyId||null;
    }
    if(!Object.keys(changes).length) return {ticket:old};
    const now=new Date().toISOString();
    if(changes.priority) {
      const snapshot=storedTicketPolicy(old);
      changes.dueAt=snapshot
        ? resolutionDeadline(old.slaStartedAt || old.createdAt,changes.priority as Ticket['priority'],snapshot)
        : new Date(Date.parse(old.createdAt)+settings.slaHours[changes.priority as keyof typeof settings.slaHours]*3600000).toISOString();
    }
    if(changes.status && changes.status!=='resolved' && old.status==='resolved') {
      const snapshot=await getEffectiveServicePolicy(tx,access.ownerId,(changes.customerCompanyId===undefined?old.customerCompanyId:changes.customerCompanyId) as string|null,settings.slaHours);
      changes.slaPolicySnapshot=JSON.stringify(snapshot); changes.slaStartedAt=now;
      changes.dueAt=resolutionDeadline(now,(changes.priority||old.priority) as Ticket['priority'],snapshot);
    }
    const resolutionKey=changes.status==='resolved'?await recordSlaOutcome(tx,{
      ownerId:access.ownerId,ticketId:id,actorMemberId:fresh.member.id,
      startedAt:old.slaStartedAt || null,dueAt:String(changes.dueAt || old.dueAt),resolvedAt:now,
      customerCompanyId:(changes.customerCompanyId===undefined?old.customerCompanyId:changes.customerCompanyId) as string|null,
      policySnapshot:old.slaPolicySnapshot || null,
    }):null;
    changes.updatedAt=now;changes.version=old.version+1;
    const keys=Object.keys(changes);
    const {rows}=await tx.query(`UPDATE tickets SET ${keys.map((key,i)=>`"${key}"=$${i+1}`).join(',')} WHERE id=$${keys.length+1} AND "ownerId"=$${keys.length+2} RETURNING *`,[...Object.values(changes),id,access.ownerId]);
    if(resolutionKey) await createSatisfactionForResolution(tx,db(),{
      ownerId:access.ownerId,ticketId:id,resolutionKey,resolvedAt:now,
      requesterMemberId:rows[0].requesterMemberId,resolverMemberId:fresh.member.id,customerCompanyId:rows[0].customerCompanyId,
    });
    for(const key of ['isTest','subject','status','priority','assigneeMemberId','customerCompanyId','requesterMemberId','department']) if(key in changes) await recordEvent(tx,fresh,id,key,old[key as keyof Ticket],changes[key]);
    return {ticket:rows[0] as Ticket};
  });
}
export async function ticketEvents(tx:PoolClient,ownerId:string,id:number):Promise<TicketEvent[]> {
  return (await tx.query('SELECT id,"ticketId","actorMemberId","actorName",action,"beforeValue","afterValue","createdAt" FROM "ticketEvents" WHERE "ownerId"=$1 AND "ticketId"=$2 ORDER BY "createdAt",id',[ownerId,id])).rows;
}
