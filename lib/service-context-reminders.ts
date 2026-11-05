import {acquireTicketWorkLock} from './work-lock';
import {parseEvolutionFeatures} from './evolution-feature-model';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Database } from '../db/database';
import { db } from './server';
import { notificationStatements, drainOutboxBestEffort } from './mail';
import { serviceDueStage } from './service-context-model';

type EntityKind='asset'|'contract';
interface DueEntity { id:string; companyId:string; name:string; dateValue:string; responsibleMemberId:string|null; reminderBaselineAt:string; archived:boolean }
interface Occurrence { id:string; ownerId:string; recipientMemberId:string; entityKind:EntityKind; entityId:string; dateValue:string; stage:30|7|0; activationAt:string }
async function entity(tx:PoolClient,ownerId:string,kind:EntityKind,id:string,lock=false):Promise<DueEntity|null> {
  const table=kind==='asset'?'customerAssets':'serviceContracts',date=kind==='asset'?'"warrantyUntil"':'COALESCE("renewalOn","endsOn")';
  return (await tx.query<DueEntity>(`SELECT id,"companyId",name,${date} AS "dateValue","responsibleMemberId","reminderBaselineAt",archived FROM "${table}" WHERE id=$1 AND "ownerId"=$2 ${lock?'FOR UPDATE':''}`,[id,ownerId])).rows[0] || null;
}
async function recipients(tx:PoolClient,ownerId:string,assigned:string|null):Promise<string[]> {
  const staff=(await tx.query<{id:string}>(`SELECT m.id FROM members m JOIN organizations o ON o.id=m."organizationId" AND o."ownerId"=m."ownerId" WHERE m."ownerId"=$1 AND m.status='active' AND m."userId" IS NOT NULL AND m.role IN ('owner','admin','agent') ORDER BY m.id`,[ownerId])).rows.map(row=>row.id);
  if(assigned && staff.includes(assigned)) return [assigned];
  const row=(await tx.query<{data:string}>('SELECT data FROM settings WHERE "ownerId"=$1',[ownerId])).rows[0];
  let configured:string[]=[];
  try {const data=JSON.parse(row?.data || '{}');if(Array.isArray(data.notificationMemberIds)) configured=data.notificationMemberIds.filter((id:unknown):id is string=>typeof id==='string');} catch { /* A missing configuration falls back to active staff. */ }
  return configured.length?staff.filter(id=>configured.includes(id)):staff;
}
/** All state and outbox writes share this transaction and stage key. */
export async function enqueueServiceContextReminder(database:Database,ownerId:string,kind:EntityKind,id:string,now=new Date()):Promise<number> {
  return database.transaction(async tx=>{
    await acquireTicketWorkLock(tx,ownerId);
    const feature=(await tx.query('SELECT "featuresJson" FROM "evolutionFeatures" WHERE "ownerId"=$1',[ownerId])).rows[0];
    if(!parseEvolutionFeatures(feature?.featuresJson).serviceContext)return 0;
    const current=await entity(tx,ownerId,kind,id,true);
    if(!current || current.archived || !current.dateValue) return 0;
    const config=(await tx.query<{enabled:boolean;activatedAt:string|null}>('SELECT enabled,"activatedAt" FROM "serviceContextNotificationSettings" WHERE "ownerId"=$1 FOR SHARE',[ownerId])).rows[0];
    if(!config?.enabled || !config.activatedAt) return 0;
    const stage=serviceDueStage(current.dateValue,current.reminderBaselineAt,config.activatedAt,now);
    if(stage===null) return 0;
    let count=0;
    const ids=await recipients(tx,ownerId,current.responsibleMemberId);
    for(const memberId of ids) {
      const occurrenceId=randomUUID();
      const inserted=(await tx.query('INSERT INTO "serviceContextReminders" (id,"ownerId","companyId","recipientMemberId","entityKind","entityId","entityName","dateValue",stage,"activationAt","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT("ownerId","recipientMemberId","entityKind","entityId","dateValue",stage) DO NOTHING RETURNING id',[occurrenceId,ownerId,current.companyId,memberId,kind,id,current.name,current.dateValue,stage,config.activatedAt,now.toISOString()])).rows[0];
      if(!inserted) continue;
      const target=new URL('/',process.env.DAYBOOK_SITE_URL || 'https://daybook-ticket.invalid');target.searchParams.set('serviceContext','1');target.searchParams.set('company',current.companyId);
      for(const statement of notificationStatements(database,{ownerId,event:'service_due',eventKey:`${kind}:${id}:${current.dateValue}:${stage}`,recipientMemberId:memberId,serviceReminderId:occurrenceId,actionUrl:target.toString()})) await database.execute(statement,tx);
      count++;
    }
    return count;
  });
}
/** Recheck the current date, responsible, membership and switch before every send. */
export async function isServiceReminderEligibleForDelivery(database:Database,row:{ownerId:string;recipientMemberId:string;serviceReminderId?:string|null},now=new Date()):Promise<boolean> {
  if(!row.serviceReminderId) return false;
  return database.transaction(async tx=>{
    const feature=(await tx.query('SELECT "featuresJson" FROM "evolutionFeatures" WHERE "ownerId"=$1',[row.ownerId])).rows[0];
    if(!parseEvolutionFeatures(feature?.featuresJson).serviceContext)return false;
    const occurrence=(await tx.query<Occurrence>('SELECT * FROM "serviceContextReminders" WHERE id=$1 AND "ownerId"=$2 AND "recipientMemberId"=$3',[row.serviceReminderId,row.ownerId,row.recipientMemberId])).rows[0];
    if(!occurrence) return false;
    const config=(await tx.query<{enabled:boolean;activatedAt:string|null}>('SELECT enabled,"activatedAt" FROM "serviceContextNotificationSettings" WHERE "ownerId"=$1',[row.ownerId])).rows[0];
    if(!config?.enabled || config.activatedAt!==occurrence.activationAt) return false;
    const current=await entity(tx,row.ownerId,occurrence.entityKind,occurrence.entityId);
    if(!current || current.archived || current.dateValue!==occurrence.dateValue || serviceDueStage(current.dateValue,current.reminderBaselineAt,config.activatedAt!,now)!==occurrence.stage) return false;
    return (await recipients(tx,row.ownerId,current.responsibleMemberId)).includes(row.recipientMemberId);
  });
}

/** Bounded, resumable sweeps. No remote infrastructure is provisioned by this worker. */
export async function runServiceContextTick(invocationId:string,now=new Date(),database:Database=db()) {
  const owners=(await database.prepare(`SELECT s."ownerId" FROM "serviceContextNotificationSettings" s JOIN "evolutionFeatures" f ON f."ownerId"=s."ownerId" AND f."featuresJson"::jsonb->>'serviceContext'='true' JOIN organizations o ON o."ownerId"=s."ownerId" LEFT JOIN "serviceContextJobHealth" h ON h."ownerId"=s."ownerId" WHERE s.enabled ORDER BY h."lastStartedAt" NULLS FIRST,s."ownerId" LIMIT 5`).all<{ownerId:string}>()).results;
  const result={owners:0,examined:0,enqueued:0,failed:0};const deadline=Date.now()+35000;
  for(const owner of owners) {
    if(Date.now()>deadline) break;
    const token=randomUUID(),at=now.toISOString(),until=new Date(now.getTime()+60000).toISOString();
    await database.prepare('INSERT INTO "serviceContextJobHealth" ("ownerId") VALUES ($1) ON CONFLICT DO NOTHING').bind(owner.ownerId).run();
    const lease=await database.prepare('UPDATE "serviceContextJobHealth" SET "leaseToken"=$1,"leaseUntil"=$2,"lastStartedAt"=$3,"lastInvocationId"=$4 WHERE "ownerId"=$5 AND ("leaseUntil" IS NULL OR "leaseUntil"<$3) RETURNING "cursorKey"').bind(token,until,at,invocationId,owner.ownerId).first<{cursorKey:string}>();
    if(!lease) continue;
    result.owners++;
    try {
      const entities=(await database.prepare(`SELECT * FROM (SELECT 'asset:' || id AS key,'asset' AS kind,id FROM "customerAssets" WHERE "ownerId"=$1 AND NOT archived AND "warrantyUntil" IS NOT NULL UNION ALL SELECT 'contract:' || id AS key,'contract' AS kind,id FROM "serviceContracts" WHERE "ownerId"=$1 AND NOT archived) candidate WHERE key>$2 ORDER BY key LIMIT 30`).bind(owner.ownerId,lease.cursorKey).all<{key:string;kind:EntityKind;id:string}>()).results;
      let cursor=lease.cursorKey;
      for(const item of entities) {if(Date.now()>deadline) break;result.enqueued+=await enqueueServiceContextReminder(database,owner.ownerId,item.kind,item.id,now);result.examined++;cursor=item.key;}
      if(entities.length<30 && cursor===entities.at(-1)?.key || !entities.length) cursor='';
      await database.prepare('UPDATE "serviceContextJobHealth" SET "cursorKey"=$1,"lastSucceededAt"=$2,"lastErrorCode"=NULL,"leaseToken"=NULL,"leaseUntil"=NULL WHERE "ownerId"=$3 AND "leaseToken"=$4').bind(cursor,new Date().toISOString(),owner.ownerId,token).run();
      await drainOutboxBestEffort(owner.ownerId);
    } catch {
      result.failed++;
      await database.prepare('UPDATE "serviceContextJobHealth" SET "lastFailedAt"=$1,"lastErrorCode"=\'service_context_unavailable\',"leaseToken"=NULL,"leaseUntil"=NULL WHERE "ownerId"=$2 AND "leaseToken"=$3').bind(new Date().toISOString(),owner.ownerId,token).run();
    }
  }
  return result;
}
