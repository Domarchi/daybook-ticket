import type { PoolClient } from 'pg';
import type { z } from 'zod';
import { ApiError,db } from './server';
import { canAccessTicket,requireStaff,type AccessContext } from './access';
import { lockAccess,lockTicket,operationHash,recordEvent } from './ticket-mutations';
import { acquireTicketWorkLock } from './work-lock';
import { duplicateCompatible,type AutomationTicket,type TicketRelation,type ticketRelationSchema,type relationPatchSchema } from './automation-model';
import { internalOperation } from './automation-transactions';
async function authorizedPair(tx:PoolClient,access:AccessContext,left:number,right:number){
  if(left===right)throw new ApiError(400,'Selecciona otro ticket.');
  const {rows}=await tx.query('SELECT * FROM tickets WHERE "ownerId"=$1 AND id=ANY($2::integer[]) ORDER BY id FOR UPDATE',[access.ownerId,[left,right]]);
  if(rows.length!==2||rows.some(ticket=>!canAccessTicket(access,ticket)))throw new ApiError(404,'Uno de los tickets no existe o no tienes acceso.');return {left:rows.find(v=>v.id===left) as AutomationTicket,right:rows.find(v=>v.id===right) as AutomationTicket};
}
async function duplicateShape(tx:PoolClient,access:AccessContext,source:AutomationTicket,target:AutomationTicket,excludingId:string|null=null){
  if(!duplicateCompatible(source,target))throw new ApiError(400,'Los duplicados requieren la misma empresa y cuenta solicitante.');
  // One level only: a principal cannot itself be a duplicate or become a child.
  const found=await tx.query(`SELECT id FROM "ticketRelations" WHERE "ownerId"=$1 AND kind='duplicate' AND NOT archived AND ($4::text IS NULL OR id<>$4) AND ("sourceTicketId"=$2 OR "sourceTicketId"=$3 OR "targetTicketId"=$2) LIMIT 1 FOR UPDATE`,[access.ownerId,source.id,target.id,excludingId]);
  if(found.rows.length)throw new ApiError(409,'El caso ya tiene principal o crearía una cadena de duplicados.');
}
const relationColumns='r.id,r."sourceTicketId",r."targetTicketId",r.kind,r.version,r.archived,r."createdAt",t.id AS "otherId",t.subject AS "otherSubject",t.status AS "otherStatus"';
function display(row:Record<string,unknown>,ticketId:number):TicketRelation{return {id:String(row.id),sourceTicketId:Number(row.sourceTicketId),targetTicketId:Number(row.targetTicketId),kind:row.kind as TicketRelation['kind'],version:Number(row.version),archived:Boolean(row.archived),createdAt:String(row.createdAt),otherTicket:{id:Number(row.otherId),subject:String(row.otherSubject),status:String(row.otherStatus)},isPrincipal:row.kind==='duplicate'&&Number(row.targetTicketId)===ticketId};}
export async function listTicketRelations(access:AccessContext,ticketId:number,cursor:string|null=null,limit=50){
  if(cursor&&!/^[a-fA-F0-9-]{36}$/.test(cursor)||!Number.isInteger(limit)||limit<1||limit>100)throw new ApiError(400,'La página de relaciones no es válida.');
  return db().transaction(async tx=>{await acquireTicketWorkLock(tx,access.ownerId);const fresh=requireStaff(await lockAccess(tx,access));await lockTicket(tx,fresh,ticketId);
    const {rows}=await tx.query(`SELECT ${relationColumns} FROM "ticketRelations" r JOIN tickets t ON t.id=CASE WHEN r."sourceTicketId"=$2 THEN r."targetTicketId" ELSE r."sourceTicketId" END AND t."ownerId"=r."ownerId"
      WHERE r."ownerId"=$1 AND NOT r.archived AND (r."sourceTicketId"=$2 OR r."targetTicketId"=$2) AND ($3::text IS NULL OR r.id>$3) ORDER BY r.id LIMIT $4`,[fresh.ownerId,ticketId,cursor,limit+1]);
    return {items:rows.slice(0,limit).map(row=>display(row,ticketId)),nextCursor:rows.length>limit?rows[limit-1].id:null};
  });
}
export async function createTicketRelation(access:AccessContext,ticketId:number,input:z.output<typeof ticketRelationSchema>){return db().transaction(async tx=>{
  await acquireTicketWorkLock(tx,access.ownerId);const fresh=requireStaff(await lockAccess(tx,access)),pair=await authorizedPair(tx,fresh,ticketId,input.targetTicketId);
  return internalOperation(tx,fresh,input.operationId,'ticket_relation',{ticketId,...input},async()=>{
    const source=input.kind==='related'?Math.min(ticketId,input.targetTicketId):ticketId,target=input.kind==='related'?Math.max(ticketId,input.targetTicketId):input.targetTicketId;
    const existing=(await tx.query('SELECT id FROM "ticketRelations" WHERE "ownerId"=$1 AND "sourceTicketId"=$2 AND "targetTicketId"=$3 AND kind=$4 AND NOT archived',[fresh.ownerId,source,target,input.kind])).rows[0];
    if(existing)return {id:existing.id as string,created:false};
    if(input.kind==='duplicate')await duplicateShape(tx,fresh,pair.left,pair.right);
    const count=(await tx.query('SELECT count(*)::integer AS count FROM "ticketRelations" WHERE "ownerId"=$1 AND NOT archived AND ("sourceTicketId"=$2 OR "targetTicketId"=$2 OR "sourceTicketId"=$3 OR "targetTicketId"=$3)',[fresh.ownerId,source,target])).rows[0].count;
    if(count>=200)throw new ApiError(409,'Se alcanzó el límite de relaciones para estos tickets.');const now=new Date().toISOString(),id=crypto.randomUUID();
    await tx.query('INSERT INTO "ticketRelations" (id,"ownerId","sourceTicketId","targetTicketId",kind,"createdByMemberId","operationId","requestHash","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)',[id,fresh.ownerId,source,target,input.kind,fresh.member.id,input.operationId,operationHash({ticketId,...input}),now]);
    await recordEvent(tx,fresh,ticketId,'ticket_linked',null,`${input.kind==='duplicate'?'Duplicado del caso principal':'Relacionado con'} #${input.targetTicketId}`);
    await recordEvent(tx,fresh,input.targetTicketId,'ticket_linked',null,`${input.kind==='duplicate'?'Caso principal para':'Relacionado con'} #${ticketId}`);
    await tx.query('UPDATE tickets SET version=version+1,"updatedAt"=$1 WHERE "ownerId"=$2 AND id=ANY($3::integer[])',[now,fresh.ownerId,[ticketId,input.targetTicketId]]);return {id,created:true};
  });
});}
export async function patchTicketRelation(access:AccessContext,ticketId:number,input:z.output<typeof relationPatchSchema>){return db().transaction(async tx=>{
  await acquireTicketWorkLock(tx,access.ownerId);const fresh=requireStaff(await lockAccess(tx,access));
  const relation=(await tx.query('SELECT * FROM "ticketRelations" WHERE id=$1 AND "ownerId"=$2 FOR UPDATE',[input.id,fresh.ownerId])).rows[0];
  if(!relation||![relation.sourceTicketId,relation.targetTicketId].includes(ticketId))throw new ApiError(404,'La relación no existe.');
  const pair=await authorizedPair(tx,fresh,relation.sourceTicketId,relation.targetTicketId);
  if(relation.version!==input.expectedVersion)throw new ApiError(409,'La relación cambió. Actualiza antes de guardar.');
  if(input.archived===relation.archived)return {ok:true};
  if(!input.archived&&relation.kind==='duplicate')await duplicateShape(tx,fresh,pair.left,pair.right,relation.id);
  if(!input.archived){const duplicate=await tx.query('SELECT id FROM "ticketRelations" WHERE "ownerId"=$1 AND "sourceTicketId"=$2 AND "targetTicketId"=$3 AND kind=$4 AND NOT archived AND id<>$5',[fresh.ownerId,relation.sourceTicketId,relation.targetTicketId,relation.kind,relation.id]);if(duplicate.rows.length)throw new ApiError(409,'Ya existe esa relación.');const count=(await tx.query('SELECT count(*)::integer AS count FROM "ticketRelations" WHERE "ownerId"=$1 AND NOT archived AND ("sourceTicketId"=$2 OR "targetTicketId"=$2 OR "sourceTicketId"=$3 OR "targetTicketId"=$3)',[fresh.ownerId,relation.sourceTicketId,relation.targetTicketId])).rows[0].count;if(count>=200)throw new ApiError(409,'Se alcanzó el límite de relaciones para estos tickets.');}
  const now=new Date().toISOString();await tx.query('UPDATE "ticketRelations" SET archived=$1,version=version+1,"updatedAt"=$2 WHERE id=$3',[input.archived,now,relation.id]);
  for(const [id,other]of [[relation.sourceTicketId,relation.targetTicketId],[relation.targetTicketId,relation.sourceTicketId]])await recordEvent(tx,fresh,id,input.archived?'ticket_unlinked':'ticket_linked',null,`${input.archived?'Vínculo retirado con':'Vínculo restaurado con'} #${other}`);
  await tx.query('UPDATE tickets SET version=version+1,"updatedAt"=$1 WHERE "ownerId"=$2 AND id=ANY($3::integer[])',[now,fresh.ownerId,[relation.sourceTicketId,relation.targetTicketId]]);return {ok:true};
});}
