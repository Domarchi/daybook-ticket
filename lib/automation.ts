import {workspaceOperationalInTransaction} from './workspaces';
import { parseEvolutionFeatures } from './evolution-feature-model';
import type { PoolClient } from 'pg';
import type { z } from 'zod';
import { ApiError,db } from './server';
import { canAccessTicket,publicMember,requireAdmin,requireStaff,type AccessContext,type MemberRecord } from './access';
import { lockAccess,lockTicket,operationHash } from './ticket-mutations';
import { acquireTicketWorkLock } from './work-lock';
import { getSettingsInTransaction } from './settings-transaction';
import type { AssignmentCandidate } from './automatic-assignment';
import { automationEventKinds,automationActivationMatches,automationRuleSchema,taskTemplateSchema,firstAutomationRule,planAutomation,type AutomationEventKind,type AutomationRule,type AutomationRuleDefinition,type AutomationTicket,type AutomationPlan,type TaskTemplate,type rulePatchSchema,type templatePatchSchema,type simulationSchema,type templateApplySchema } from './automation-model';
import { internalOperation } from './automation-transactions';
import { signSimulationProof,verifySimulationProof } from './automation-proof';

const RULE_COLUMNS='id,name,"conditionsJson","actionsJson","referencesHash",enabled,position,version,archived,"enabledAt","updatedByMemberId","createdAt","updatedAt"';
const TEMPLATE_COLUMNS='id,name,"itemsJson",version,archived,"createdAt","updatedAt"';
function publicRule(row:Record<string,unknown>):AutomationRule{return {...automationRuleSchema.parse({name:row.name,enabled:row.enabled,position:row.position,conditions:JSON.parse(String(row.conditionsJson)),actions:JSON.parse(String(row.actionsJson))}),id:String(row.id),version:Number(row.version),archived:Boolean(row.archived),enabledAt:row.enabledAt?String(row.enabledAt):null,updatedByMemberId:String(row.updatedByMemberId),referencesHash:String(row.referencesHash),createdAt:String(row.createdAt),updatedAt:String(row.updatedAt)};}
function publicTemplate(row:Record<string,unknown>):TaskTemplate{return {...taskTemplateSchema.parse({name:row.name,items:JSON.parse(String(row.itemsJson))}),id:String(row.id),version:Number(row.version),archived:Boolean(row.archived),createdAt:String(row.createdAt),updatedAt:String(row.updatedAt)};}
const ruleHash=(rule:AutomationRuleDefinition)=>operationHash({name:rule.name,position:rule.position,conditions:rule.conditions,actions:rule.actions});
function pageInput(cursor:string|null,limit:number){if(cursor&&!/^[a-fA-F0-9-]{36}$/.test(cursor)||!Number.isInteger(limit)||limit<1||limit>100)throw new ApiError(400,'La página solicitada no es válida.');}
export async function automationEnabledInTransaction(tx:PoolClient,ownerId:string){if(!await workspaceOperationalInTransaction(ownerId,tx))return false;const row=(await tx.query('SELECT \"featuresJson\" FROM \"evolutionFeatures\" WHERE \"ownerId\"=$1',[ownerId])).rows[0];return parseEvolutionFeatures(row?.featuresJson).automation;}
export async function requireAutomationInTransaction(tx:PoolClient,ownerId:string){if(!await automationEnabledInTransaction(tx,ownerId))throw new ApiError(503,'Las automatizaciones están en pausa. Sus datos e historial se conservan.');}
async function admin(tx:PoolClient,access:AccessContext){await acquireTicketWorkLock(tx,access.ownerId);const fresh=requireAdmin(await lockAccess(tx,access));await requireAutomationInTransaction(tx,fresh.ownerId);return fresh;}
async function validStaff(tx:PoolClient,access:Pick<AccessContext,'ownerId'|'organizationId'>,ids:string[]){
  if(!ids.length)return;
  const {rows}=await tx.query('SELECT id FROM members WHERE "ownerId"=$1 AND "organizationId"=$2 AND id=ANY($3::text[]) AND status=\'active\' AND "userId" IS NOT NULL AND role IN (\'owner\',\'admin\',\'agent\') FOR SHARE',[access.ownerId,access.organizationId,[...new Set(ids)]]);
  if(rows.length!==new Set(ids).size)throw new ApiError(400,'Selecciona integrantes activos del equipo.');
}
async function validateReferences(tx:PoolClient,access:Pick<AccessContext,'ownerId'|'organizationId'>,rule:AutomationRuleDefinition){
  const c=rule.conditions,a=rule.actions;
  if(c.customerCompanyId){const found=await tx.query('SELECT id FROM "customerCompanies" WHERE id=$1 AND "ownerId"=$2 AND "organizationId"=$3 FOR SHARE',[c.customerCompanyId,access.ownerId,access.organizationId]);if(!found.rows.length)throw new ApiError(400,'Selecciona una empresa de este espacio.');}
  const settings=await getSettingsInTransaction(tx,access.ownerId);
  if([...c.departments,...(a.department?[a.department]:[])].some(v=>!settings.departments.includes(v)))throw new ApiError(400,'Un departamento ya no está disponible.');
  const tagIds=[...new Set([...c.allTagIds,...a.addTagIds])];
  const tags=tagIds.length?(await tx.query('SELECT id,version FROM "workOrganizationCatalog" WHERE "ownerId"=$1 AND kind=\'tag\' AND NOT archived AND id=ANY($2::text[]) ORDER BY id FOR SHARE',[access.ownerId,tagIds])).rows:[];
  if(tags.length!==tagIds.length)throw new ApiError(400,'Una etiqueta ya no está disponible.');
  const types=c.requestTypeIds.length?(await tx.query('SELECT id,version FROM "workOrganizationCatalog" WHERE "ownerId"=$1 AND kind=\'requestType\' AND NOT archived AND id=ANY($2::text[]) ORDER BY id FOR SHARE',[access.ownerId,c.requestTypeIds])).rows:[];
  if(types.length!==c.requestTypeIds.length)throw new ApiError(400,'Un tipo de solicitud ya no está disponible.');
  const templates=a.taskTemplateIds.length?(await tx.query(`SELECT ${TEMPLATE_COLUMNS} FROM "taskTemplates" WHERE "ownerId"=$1 AND NOT archived AND id=ANY($2::text[]) ORDER BY id FOR SHARE`,[access.ownerId,a.taskTemplateIds])).rows.map(publicTemplate):[];
  if(templates.length!==a.taskTemplateIds.length)throw new ApiError(400,'Una plantilla ya no está disponible.');
  await validStaff(tx,access,[...a.assignMemberIds,...templates.flatMap(v=>v.items.flatMap(item=>item.assigneeMemberId?[item.assigneeMemberId]:[]))]);
  return {templates,referencesHash:operationHash({tags,types,templates:templates.map(v=>({id:v.id,version:v.version,items:v.items})),department:a.department,conditionDepartments:c.departments,companyId:c.customerCompanyId})};
}
async function loadContext(tx:PoolClient,ownerId:string,ticketId:number):Promise<AutomationTicket&{subject:string}>{
  const {rows}=await tx.query('SELECT * FROM tickets WHERE id=$1 AND "ownerId"=$2 FOR UPDATE',[ticketId,ownerId]);const ticket=rows[0];if(!ticket)throw new ApiError(404,'El ticket no existe.');
  const metadata=(await tx.query('SELECT "metadataJson","tagIdsJson" FROM "ticketOrganization" WHERE "ownerId"=$1 AND "ticketId"=$2',[ownerId,ticketId])).rows[0];
  const parsed=metadata?JSON.parse(metadata.metadataJson):null;
  const count=(await tx.query('SELECT count(*)::integer AS count FROM "ticketTasks" WHERE "ownerId"=$1 AND "ticketId"=$2',[ownerId,ticketId])).rows[0].count;
  return {...ticket,requestTypeId:parsed?.requestType?.id??null,tagIds:metadata?JSON.parse(metadata.tagIdsJson):[],taskCount:count};
}
async function candidates(tx:PoolClient,ownerId:string,ids:string[]):Promise<AssignmentCandidate[]>{
  if(!ids.length)return [];
  return (await tx.query<AssignmentCandidate>(`SELECT m.id,m.name,m.role,m.status,(m."userId" IS NOT NULL) AS "hasAccount",COALESCE(a.available,true) AS available,COALESCE(a.capacity,20) AS capacity,a."lastAssignedAt",
    (SELECT count(*)::integer FROM tickets t WHERE t."ownerId"=$1 AND t."assigneeMemberId"=m.id AND t.status IN ('open','pending')) AS "openTickets"
    FROM members m LEFT JOIN "agentAvailability" a ON a."ownerId"=m."ownerId" AND a."memberId"=m.id WHERE m."ownerId"=$1 AND m.id=ANY($2::text[]) ORDER BY m.id FOR SHARE OF m`,[ownerId,ids])).rows;
}
async function allRules(tx:PoolClient,ownerId:string){return (await tx.query(`SELECT ${RULE_COLUMNS} FROM "automationRules" WHERE "ownerId"=$1 AND enabled AND NOT archived ORDER BY position,id LIMIT 20 FOR SHARE`,[ownerId])).rows.map(publicRule);}
/** Readers elsewhere lock membership before a ticket. Reserve every member this
 * bounded rule set might touch first, so the worker never inverts that order. */
async function lockAutomationMembers(tx:PoolClient,ownerId:string,rules:AutomationRuleDefinition[],extraIds:string[]=[]){
  const templateIds=[...new Set(rules.flatMap(rule=>rule.actions.taskTemplateIds))];
  const templates=templateIds.length?(await tx.query('SELECT "itemsJson" FROM "taskTemplates" WHERE "ownerId"=$1 AND id=ANY($2::text[])',[ownerId,templateIds])).rows:[];
  const ids=[...new Set([...extraIds,...rules.flatMap(rule=>[...rule.actions.assignMemberIds,...('updatedByMemberId' in rule?[String(rule.updatedByMemberId)]:[])]),...templates.flatMap(row=>(JSON.parse(row.itemsJson) as TaskTemplate['items']).flatMap(item=>item.assigneeMemberId?[item.assigneeMemberId]:[]))])];
  if(ids.length)await tx.query('SELECT id FROM members WHERE "ownerId"=$1 AND id=ANY($2::text[]) ORDER BY id FOR SHARE',[ownerId,ids]);
}
export async function getAutomationSettings(access:AccessContext){return db().transaction(async tx=>{
  const fresh=requireAdmin(await lockAccess(tx,access)),row=(await tx.query('SELECT enabled,"activatedAt",version,"updatedAt" FROM "automationSettings" WHERE "ownerId"=$1',[fresh.ownerId])).rows[0];
  const health=(await tx.query('SELECT "lastStartedAt","lastSucceededAt","lastFailedAt","lastErrorCode","processedEvents","updatedAt" FROM "automationJobHealth" WHERE "ownerId"=$1',[fresh.ownerId])).rows[0]??null;
  const counts=(await tx.query('SELECT count(*) FILTER (WHERE status=\'queued\')::integer AS queued,count(*) FILTER (WHERE status=\'failed\')::integer AS failed FROM "automationEvents" WHERE "ownerId"=$1',[fresh.ownerId])).rows[0];
  return {settings:row??{enabled:false,activatedAt:null,version:0,updatedAt:null},health,counts,jobConfigured:process.env.DAYBOOK_AUTOMATION_JOB_ENABLED==='true'&&(process.env.DAYBOOK_AUTOMATION_JOB_SECRET?.length??0)>=32};
});}
export async function saveAutomationSettings(access:AccessContext,input:{enabled:boolean;expectedVersion:number}){return db().transaction(async tx=>{
  const fresh=await admin(tx,access),row=(await tx.query('SELECT * FROM "automationSettings" WHERE "ownerId"=$1 FOR UPDATE',[fresh.ownerId])).rows[0];
  if((row?.version??0)!==input.expectedVersion)throw new ApiError(409,'La configuración cambió. Actualiza antes de guardar.');
  if(row&&row.enabled===input.enabled)return {enabled:row.enabled,activatedAt:row.activatedAt,version:row.version,updatedAt:row.updatedAt};
  const now=new Date().toISOString(),activated=input.enabled?(row?.enabled?row.activatedAt:now):null;
  return (await tx.query(`INSERT INTO "automationSettings" ("ownerId",enabled,"activatedAt",version,"updatedAt") VALUES ($1,$2,$3,1,$4) ON CONFLICT ("ownerId") DO UPDATE SET enabled=EXCLUDED.enabled,"activatedAt"=EXCLUDED."activatedAt",version="automationSettings".version+1,"updatedAt"=EXCLUDED."updatedAt" RETURNING enabled,"activatedAt",version,"updatedAt"`,[fresh.ownerId,input.enabled,activated,now])).rows[0];
});}
export async function listAutomationRules(access:AccessContext,archived=false,cursor:string|null=null,limit=50){pageInput(cursor,limit);return db().transaction(async tx=>{
  const fresh=requireAdmin(await lockAccess(tx,access));const {rows}=await tx.query(`SELECT ${RULE_COLUMNS} FROM "automationRules" WHERE "ownerId"=$1 AND ($2::boolean OR NOT archived) AND ($3::text IS NULL OR id>$3) ORDER BY id LIMIT $4`,[fresh.ownerId,archived,cursor,limit+1]);return {items:rows.slice(0,limit).map(publicRule),nextCursor:rows.length>limit?rows[limit-1].id:null};
});}
async function ruleCapacity(tx:PoolClient,ownerId:string,enabled:boolean,id:string|null){
  const {rows}=await tx.query('SELECT count(*) FILTER (WHERE NOT archived)::integer AS active,count(*)::integer AS total,count(*) FILTER (WHERE enabled AND NOT archived)::integer AS enabled FROM "automationRules" WHERE "ownerId"=$1 AND ($2::text IS NULL OR id<>$2)',[ownerId,id]);
  if(rows[0].active>=100||!id&&rows[0].total>=1000||enabled&&rows[0].enabled>=20)throw new ApiError(409,'Se alcanzó el límite de reglas: 100 activas y 20 habilitadas.');
}
function requireProof(access:AccessContext,rule:AutomationRuleDefinition,referencesHash:string,proof?:string){if(rule.enabled&&!verifySimulationProof(proof,{ownerId:access.ownerId,memberId:access.member.id,ruleHash:ruleHash(rule),referencesHash},process.env.BETTER_AUTH_SECRET??''))throw new ApiError(409,'Simula esta versión de la regla antes de habilitarla.');}
async function saveRuleVersion(tx:PoolClient,access:AccessContext,rule:AutomationRule){await tx.query('INSERT INTO "automationRuleVersions" (id,"ownerId","ruleId",version,"snapshotJson","changedByMemberId","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7)',[crypto.randomUUID(),access.ownerId,rule.id,rule.version,JSON.stringify(rule),access.member.id,rule.updatedAt]);}
export async function listAutomationRuleVersions(access:AccessContext,ruleId:string,beforeVersion:number|null=null,limit=25){if(!Number.isInteger(limit)||limit<1||limit>100||beforeVersion!==null&&(!Number.isInteger(beforeVersion)||beforeVersion<0))throw new ApiError(400,'La página de versiones no es válida.');return db().transaction(async tx=>{const fresh=requireAdmin(await lockAccess(tx,access));const rows=(await tx.query('SELECT version,"snapshotJson","changedByMemberId","createdAt" FROM "automationRuleVersions" WHERE "ownerId"=$1 AND "ruleId"=$2 AND ($3::integer IS NULL OR version<$3) ORDER BY version DESC LIMIT $4',[fresh.ownerId,ruleId,beforeVersion,limit+1])).rows;return {items:rows.slice(0,limit).map(row=>({version:row.version,rule:JSON.parse(row.snapshotJson) as AutomationRule,changedByMemberId:row.changedByMemberId,createdAt:row.createdAt})),nextVersion:rows.length>limit?rows[limit-1].version:null};});}
async function uniqueName(tx:PoolClient,table:'automationRules'|'taskTemplates',ownerId:string,name:string,id:string|null){const found=await tx.query(`SELECT id FROM "${table}" WHERE "ownerId"=$1 AND lower(name)=lower($2) AND NOT archived AND ($3::text IS NULL OR id<>$3)`,[ownerId,name,id]);if(found.rows.length)throw new ApiError(409,'Ya existe una entrada activa con ese nombre.');}
export async function createAutomationRule(access:AccessContext,rule:AutomationRuleDefinition,proof?:string){return db().transaction(async tx=>{
  const fresh=await admin(tx,access);await ruleCapacity(tx,fresh.ownerId,rule.enabled,null);await uniqueName(tx,'automationRules',fresh.ownerId,rule.name,null);
  const refs=await validateReferences(tx,fresh,rule);requireProof(fresh,rule,refs.referencesHash,proof);const now=new Date().toISOString();
  const result=publicRule((await tx.query(`INSERT INTO "automationRules" (id,"ownerId",name,"conditionsJson","actionsJson","referencesHash",enabled,position,"enabledAt","updatedByMemberId","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING ${RULE_COLUMNS}`,[crypto.randomUUID(),fresh.ownerId,rule.name,JSON.stringify(rule.conditions),JSON.stringify(rule.actions),refs.referencesHash,rule.enabled,rule.position,rule.enabled?now:null,fresh.member.id,now])).rows[0]);await saveRuleVersion(tx,fresh,result);return result;
});}
export async function patchAutomationRule(access:AccessContext,input:z.output<typeof rulePatchSchema>){return db().transaction(async tx=>{
  const fresh=await admin(tx,access),oldRow=(await tx.query(`SELECT ${RULE_COLUMNS} FROM "automationRules" WHERE id=$1 AND "ownerId"=$2 FOR UPDATE`,[input.id,fresh.ownerId])).rows[0];if(!oldRow)throw new ApiError(404,'La regla no existe.');const old=publicRule(oldRow);
  if(old.version!==input.expectedVersion)throw new ApiError(409,'La regla cambió. Actualiza antes de guardar.');
  const archived=input.archived??old.archived,rule=input.rule??old;const enabled=archived?false:rule.enabled;
  if(!archived){await ruleCapacity(tx,fresh.ownerId,enabled,old.id);await uniqueName(tx,'automationRules',fresh.ownerId,rule.name,old.id);}
  const refs=archived?{referencesHash:old.referencesHash}:await validateReferences(tx,fresh,rule);requireProof(fresh,{...rule,enabled},refs.referencesHash,input.simulationProof);const now=new Date().toISOString();
  const result=publicRule((await tx.query(`UPDATE "automationRules" SET name=$1,"conditionsJson"=$2,"actionsJson"=$3,"referencesHash"=$4,enabled=$5,position=$6,archived=$7,version=version+1,"enabledAt"=$8,"updatedByMemberId"=$9,"updatedAt"=$10 WHERE id=$11 RETURNING ${RULE_COLUMNS}`,[rule.name,JSON.stringify(rule.conditions),JSON.stringify(rule.actions),refs.referencesHash,enabled,rule.position,archived,enabled?now:null,fresh.member.id,now,old.id])).rows[0]);await saveRuleVersion(tx,fresh,result);return result;
});}
export async function listTaskTemplates(access:AccessContext,archived=false,cursor:string|null=null,limit=50){pageInput(cursor,limit);return db().transaction(async tx=>{
  const fresh=requireStaff(await lockAccess(tx,access));if(archived)requireAdmin(fresh);
  const {rows}=await tx.query(`SELECT ${TEMPLATE_COLUMNS} FROM "taskTemplates" WHERE "ownerId"=$1 AND ($2::boolean OR NOT archived) AND ($3::text IS NULL OR id>$3) ORDER BY id LIMIT $4`,[fresh.ownerId,archived,cursor,limit+1]);
  const active=(await tx.query(`SELECT ${TEMPLATE_COLUMNS} FROM "taskTemplates" WHERE "ownerId"=$1 AND NOT archived ORDER BY name,id LIMIT 100`,[fresh.ownerId])).rows.map(publicTemplate);
  return {items:rows.slice(0,limit).map(publicTemplate),nextCursor:rows.length>limit?rows[limit-1].id:null,activeTemplates:active};
});}
export async function saveTaskTemplate(access:AccessContext,input:z.output<typeof taskTemplateSchema>,id?:string,expectedVersion?:number,archive?:boolean){return db().transaction(async tx=>{
  const fresh=await admin(tx,access),old=id?(await tx.query(`SELECT ${TEMPLATE_COLUMNS} FROM "taskTemplates" WHERE id=$1 AND "ownerId"=$2 FOR UPDATE`,[id,fresh.ownerId])).rows[0]:null;
  if(id&&!old)throw new ApiError(404,'La plantilla no existe.');if(old&&old.version!==expectedVersion)throw new ApiError(409,'La plantilla cambió. Actualiza antes de guardar.');
  const archived=archive??old?.archived??false;
  if(!archived){await uniqueName(tx,'taskTemplates',fresh.ownerId,input.name,id??null);await validStaff(tx,fresh,input.items.flatMap(v=>v.assigneeMemberId?[v.assigneeMemberId]:[]));}
  const count=(await tx.query('SELECT count(*) FILTER (WHERE NOT archived)::integer AS active,count(*)::integer AS total FROM "taskTemplates" WHERE "ownerId"=$1 AND ($2::text IS NULL OR id<>$2)',[fresh.ownerId,id??null])).rows[0];
  if(!archived&&count.active>=100||!id&&count.total>=1000)throw new ApiError(409,'Se alcanzó el límite de plantillas.');const now=new Date().toISOString();
  const result=id?await tx.query(`UPDATE "taskTemplates" SET name=$1,"itemsJson"=$2,archived=$3,version=version+1,"updatedByMemberId"=$4,"updatedAt"=$5 WHERE id=$6 RETURNING ${TEMPLATE_COLUMNS}`,[input.name,JSON.stringify(input.items),archived,fresh.member.id,now,id]):await tx.query(`INSERT INTO "taskTemplates" (id,"ownerId",name,"itemsJson","updatedByMemberId","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING ${TEMPLATE_COLUMNS}`,[crypto.randomUUID(),fresh.ownerId,input.name,JSON.stringify(input.items),fresh.member.id,now]);return publicTemplate(result.rows[0]);
});}
export async function patchTaskTemplate(access:AccessContext,input:z.output<typeof templatePatchSchema>){
  const templates=await listTaskTemplates(access,true,null,100);let old=templates.items.find(v=>v.id===input.id);
  if(!old){const row=await db().prepare(`SELECT ${TEMPLATE_COLUMNS} FROM "taskTemplates" WHERE id=$1 AND "ownerId"=$2`).bind(input.id,access.ownerId).first<Record<string,unknown>>();if(row)old=publicTemplate(row);}
  if(!old)throw new ApiError(404,'La plantilla no existe.');return saveTaskTemplate(access,input.template??old,input.id,input.expectedVersion,input.archived);
}
export async function simulateAutomation(access:AccessContext,input:z.output<typeof simulationSchema>){return db().transaction(async tx=>{
  const fresh=await admin(tx,access);
  let rule:AutomationRuleDefinition|undefined=input.rule,ruleId:string|null=null;
  if(input.ruleId){const row=(await tx.query(`SELECT ${RULE_COLUMNS} FROM "automationRules" WHERE id=$1 AND "ownerId"=$2 AND NOT archived`,[input.ruleId,fresh.ownerId])).rows[0];if(!row)throw new ApiError(404,'La regla no existe.');rule=publicRule(row);ruleId=input.ruleId;}
  const possible=rule?[rule]:await allRules(tx,fresh.ownerId);await lockAutomationMembers(tx,fresh.ownerId,possible,[fresh.member.id]);await lockTicket(tx,fresh,input.ticketId);const context=await loadContext(tx,fresh.ownerId,input.ticketId);
  if(!rule){const selected=firstAutomationRule(possible as AutomationRule[],context,input.eventKind,new Date().toISOString());if(!selected)return {matches:false,rule:null,plan:null,simulationProof:null,ticket:{id:context.id,subject:context.subject}};rule=selected;ruleId=selected.id;}
  const refs=await validateReferences(tx,fresh,rule),plan=planAutomation(rule,context,input.eventKind,await candidates(tx,fresh.ownerId,rule.actions.assignMemberIds),refs.templates);
  const proof=signSimulationProof({ownerId:fresh.ownerId,memberId:fresh.member.id,ruleHash:ruleHash(rule),referencesHash:refs.referencesHash},process.env.BETTER_AUTH_SECRET??'');
  return {matches:plan.matches,rule:{id:ruleId,name:rule.name},plan,simulationProof:proof,ticket:{id:context.id,subject:context.subject}};
});}

/** Call inside the SAME transaction as the genuine external ticket change. */
export async function enqueueAutomationEvent(tx:PoolClient,access:AccessContext,ticketId:number,operationKey:string,eventKind:AutomationEventKind){
  if(!await automationEnabledInTransaction(tx,access.ownerId))return null;
  if(!/^[A-Za-z0-9:_-]{1,200}$/.test(operationKey)||!automationEventKinds.includes(eventKind))throw new ApiError(400,'La identidad del evento no es válida.');
  const settings=(await tx.query('SELECT enabled,"activatedAt",version FROM "automationSettings" WHERE "ownerId"=$1 FOR SHARE',[access.ownerId])).rows[0];if(!settings?.enabled)return null;
  const now=new Date().toISOString(),hash=operationHash({ticketId,operationKey,eventKind,memberId:access.member.id});
  const existing=(await tx.query('SELECT id,"requestHash" FROM "automationEvents" WHERE "ownerId"=$1 AND "operationKey"=$2 AND "eventKind"=$3 FOR UPDATE',[access.ownerId,operationKey,eventKind])).rows[0];
  if(existing){if(existing.requestHash!==hash)throw new ApiError(409,'El evento ya se utilizó con otros datos.');return existing.id as string;}
  const count=(await tx.query('SELECT count(*)::integer AS count FROM "automationEvents" WHERE "ownerId"=$1 AND status=\'queued\'',[access.ownerId])).rows[0].count;
  const id=crypto.randomUUID(),overflow=count>=500;
  await tx.query('INSERT INTO "automationEvents" (id,"ownerId","ticketId","operationKey","eventKind","actorMemberId","requestHash","activationVersion",status,"nextAttemptAt","lastErrorCode","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$10,$10)',[id,access.ownerId,ticketId,operationKey,eventKind,access.member.id,hash,settings.version,overflow?'cancelled':'queued',now,overflow?'queue_capacity':null]);if(overflow)await execution(tx,{id,ownerId:access.ownerId,ticketId},null,'skipped',{reason:'Se alcanzó el límite de eventos pendientes.'});return id;
}
async function systemEvent(tx:PoolClient,ownerId:string,ticketId:number,action:string,message:string){await tx.query('INSERT INTO "ticketEvents" (id,"ownerId","ticketId","actorMemberId","actorName",action,"beforeValue","afterValue","createdAt") VALUES ($1,$2,$3,NULL,\'Daybook Ticket\',$4,NULL,$5,$6)',[crypto.randomUUID(),ownerId,ticketId,action,message,new Date().toISOString()]);}
async function insertPlannedTasks(tx:PoolClient,access:Pick<AccessContext,'ownerId'|'member'>,ticketId:number,tasks:AutomationPlan['tasks'],key:string){
  const now=new Date().toISOString();let created=0;
  for(const [index,task]of tasks.entries()){
    const operationId=`${key}:task:${index}`,requestHash=operationHash({ticketId,task}),old=(await tx.query('SELECT id,"requestHash" FROM "ticketTasks" WHERE "ownerId"=$1 AND "operationId"=$2',[access.ownerId,operationId])).rows[0];
    if(old){if(old.requestHash!==requestHash)throw new ApiError(409,'Cambió el contenido de una tarea ya preparada.');continue;}
    const dueAt=task.dueAfterHours===null?null:new Date(Date.parse(now)+task.dueAfterHours*3600000).toISOString();
    await tx.query('INSERT INTO "ticketTasks" (id,"ownerId","ticketId","createdByMemberId","operationId","requestHash",title,"assigneeMemberId","dueAt","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)',[crypto.randomUUID(),access.ownerId,ticketId,access.member.id,operationId,requestHash,task.title,task.assigneeMemberId,dueAt,now]);created++;
  }
  return created;
}
async function applyPlan(tx:PoolClient,ownerId:string,ticket:AutomationTicket,rule:AutomationRule,plan:AutomationPlan,eventId:string){
  const author=(await tx.query('SELECT m.* FROM members m JOIN organizations o ON o.id=m."organizationId" AND o."ownerId"=m."ownerId" WHERE m.id=$1 AND m."ownerId"=$2 AND m.status=\'active\' AND m."userId" IS NOT NULL AND m.role IN (\'owner\',\'admin\') FOR SHARE OF m',[rule.updatedByMemberId,ownerId])).rows[0] as MemberRecord|undefined;
  if(!author)throw new ApiError(409,'El administrador de esta regla ya no tiene acceso activo.');
  const now=new Date().toISOString(),summary:string[]=[];let changed=false;
  if(plan.addTagIds.length){
    const empty=JSON.stringify({requestType:null,form:null,values:{}}),tagIds=[...new Set([...ticket.tagIds,...plan.addTagIds])];
    await tx.query(`INSERT INTO "ticketOrganization" ("ticketId","ownerId","metadataJson","tagIdsJson",version,"updatedAt") VALUES ($1,$2,$3,$4,1,$5) ON CONFLICT ("ticketId") DO UPDATE SET "tagIdsJson"=EXCLUDED."tagIdsJson",version="ticketOrganization".version+1,"updatedAt"=EXCLUDED."updatedAt"`,[ticket.id,ownerId,empty,JSON.stringify(tagIds),now]);summary.push(`${plan.addTagIds.length} etiquetas añadidas`);changed=true;
  }
  if(plan.department){await tx.query('UPDATE tickets SET department=$1 WHERE id=$2 AND "ownerId"=$3',[plan.department,ticket.id,ownerId]);summary.push(`Departamento: ${plan.department}`);changed=true;}
  if(plan.assignee){
    const assigned=await tx.query('UPDATE tickets SET "assigneeMemberId"=$1,assignee=$2 WHERE id=$3 AND "ownerId"=$4 AND "assigneeMemberId" IS NULL AND COALESCE(btrim(assignee),\'\')=\'\'',[plan.assignee.id,plan.assignee.name,ticket.id,ownerId]);
    if(assigned.rowCount){changed=true;await tx.query(`INSERT INTO "agentAvailability" ("memberId","ownerId",available,capacity,version,"lastAssignedAt","updatedAt") VALUES ($1,$2,true,20,0,$3,$3) ON CONFLICT ("memberId") DO UPDATE SET "lastAssignedAt"=EXCLUDED."lastAssignedAt" WHERE "agentAvailability"."ownerId"=EXCLUDED."ownerId"`,[plan.assignee.id,ownerId,now]);summary.push(`Responsable: ${plan.assignee.name}`);}
  }
  const created=await insertPlannedTasks(tx,{ownerId,member:publicMember({...author,hasAccount:true})},ticket.id,plan.tasks,`automation:${eventId}:${rule.id}:${rule.version}`);
  if(created){summary.push(`${created} tareas creadas`);changed=true;}if(plan.assignmentReason)summary.push(plan.assignmentReason);
  if(changed){await tx.query('UPDATE tickets SET version=version+1,"updatedAt"=$1 WHERE id=$2 AND "ownerId"=$3',[now,ticket.id,ownerId]);await systemEvent(tx,ownerId,ticket.id,'automation_applied',`${rule.name}: ${summary.join(' · ')}`);}
  return {summary,changed};
}
async function execution(tx:PoolClient,event:{id:string;ownerId:string;ticketId:number},rule:AutomationRule|null,status:'applied'|'skipped'|'failed',summary:unknown){const now=new Date().toISOString();await tx.query(`INSERT INTO "automationExecutions" (id,"ownerId","eventId","ticketId","ruleId","ruleKey","ruleVersion","ruleName",status,"summaryJson","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) ON CONFLICT ("eventId","ruleKey","ruleVersion") DO UPDATE SET status=EXCLUDED.status,"summaryJson"=EXCLUDED."summaryJson",attempts="automationExecutions".attempts+1,"updatedAt"=EXCLUDED."updatedAt"`,[crypto.randomUUID(),event.ownerId,event.id,event.ticketId,rule?.id??null,rule?.id??'none',rule?.version??0,rule?.name??'Sin regla coincidente',status,JSON.stringify(summary),now]);}
export async function drainAutomationEvents(ownerId:string,options:{maxEvents?:number;maxDurationMs?:number}={}){
  const maxEvents=Math.min(5,Math.max(1,options.maxEvents??2)),maxDuration=Math.min(45_000,Math.max(1000,options.maxDurationMs??15_000)),start=Date.now();let processed=0,failed=0;
  const running=await db().transaction(async tx=>{await acquireTicketWorkLock(tx,ownerId);if(!await automationEnabledInTransaction(tx,ownerId))return false;const now=new Date().toISOString();await tx.query(`INSERT INTO "automationJobHealth" ("ownerId","lastStartedAt","updatedAt") VALUES ($1,$2,$2) ON CONFLICT ("ownerId") DO UPDATE SET "lastStartedAt"=EXCLUDED."lastStartedAt","updatedAt"=EXCLUDED."updatedAt"`,[ownerId,now]);return true;});if(!running)return {processed:0,failed:0,paused:true};
  try{for(let index=0;index<maxEvents&&Date.now()-start<maxDuration;index++){
    const result=await db().transaction(async tx=>{
      await acquireTicketWorkLock(tx,ownerId);if(!await automationEnabledInTransaction(tx,ownerId))return 'empty';const settings=(await tx.query('SELECT enabled,"activatedAt",version FROM "automationSettings" WHERE "ownerId"=$1 FOR SHARE',[ownerId])).rows[0];if(!settings?.enabled)return 'empty';
      const event=(await tx.query('SELECT * FROM "automationEvents" WHERE "ownerId"=$1 AND status=\'queued\' AND "nextAttemptAt"<=$2 ORDER BY "createdAt",id LIMIT 1 FOR UPDATE SKIP LOCKED',[ownerId,new Date().toISOString()])).rows[0];if(!event)return 'empty';
      if(!automationActivationMatches(settings,event)){await tx.query('UPDATE "automationEvents" SET status=\'cancelled\',"lastErrorCode"=\'activation_changed\',"updatedAt"=$1 WHERE id=$2',[new Date().toISOString(),event.id]);await execution(tx,event,null,'skipped',{reason:'La activación cambió; no se ejecutan eventos anteriores.'});return 'done';}
      const rules=await allRules(tx,ownerId);await lockAutomationMembers(tx,ownerId,rules,event.actorMemberId?[event.actorMemberId]:[]);
      const ticket=await loadContext(tx,ownerId,event.ticketId),actor=event.actorMemberId?(await tx.query('SELECT * FROM members WHERE id=$1 AND "ownerId"=$2 FOR SHARE',[event.actorMemberId,ownerId])).rows[0]:null;
      if(!actor||!actor.userId||!canAccessTicket({ownerId,role:actor.role,member:publicMember({...actor,hasAccount:Boolean(actor.userId)})},ticket)){await tx.query('UPDATE "automationEvents" SET status=\'cancelled\',"lastErrorCode"=\'actor_access_changed\',"updatedAt"=$1 WHERE id=$2',[new Date().toISOString(),event.id]);await execution(tx,event,null,'skipped',{reason:'El autor ya no tiene acceso al ticket.'});return 'done';}
      const rule=firstAutomationRule(rules,ticket,event.eventKind,event.createdAt);if(!rule){await execution(tx,event,null,'skipped',{reason:'Ninguna regla vigente coincide.'});await tx.query('UPDATE "automationEvents" SET status=\'done\',"updatedAt"=$1 WHERE id=$2',[new Date().toISOString(),event.id]);return 'done';}
      await tx.query('SAVEPOINT automation_actions');
      try{
        const organization=(await tx.query('SELECT id FROM organizations WHERE "ownerId"=$1',[ownerId])).rows[0];
        const refs=await validateReferences(tx,{ownerId,organizationId:organization.id},rule);if(refs.referencesHash!==rule.referencesHash)throw new ApiError(409,'Cambió una referencia; simula y guarda la regla nuevamente.');
        const plan=planAutomation(rule,ticket,event.eventKind,await candidates(tx,ownerId,rule.actions.assignMemberIds),refs.templates);
        const result=await applyPlan(tx,ownerId,ticket,rule,plan,event.id);await execution(tx,event,rule,result.changed?'applied':'skipped',{summary:result.summary.length?result.summary:['Sin cambios necesarios.']});
        await tx.query('UPDATE "automationEvents" SET status=\'done\',attempts=attempts+1,"lastErrorCode"=NULL,"updatedAt"=$1 WHERE id=$2',[new Date().toISOString(),event.id]);await tx.query('RELEASE SAVEPOINT automation_actions');return 'done';
      }catch(reason){
        await tx.query('ROLLBACK TO SAVEPOINT automation_actions');await tx.query('RELEASE SAVEPOINT automation_actions');const attempts=event.attempts+1,final=attempts>=3,time=new Date();
        await execution(tx,event,rule,'failed',{reason:reason instanceof ApiError?reason.message:'No se pudo ejecutar la regla. No se guardaron acciones parciales.'});
        await tx.query('UPDATE "automationEvents" SET status=$1,attempts=$2,"nextAttemptAt"=$3,"lastErrorCode"=\'rule_unavailable\',"updatedAt"=$4 WHERE id=$5',[final?'failed':'queued',attempts,new Date(time.getTime()+(attempts===1?60:300)*1000).toISOString(),time.toISOString(),event.id]);return 'failed';
      }
    });
    if(result==='empty')break;processed++;if(result==='failed')failed++;
  }}catch(error){await db().prepare('UPDATE "automationJobHealth" SET "lastFailedAt"=$2,"lastErrorCode"=\'worker_unavailable\',"updatedAt"=$2 WHERE "ownerId"=$1').bind(ownerId,new Date().toISOString()).run().catch(()=>{});throw error;}
  const finished=new Date().toISOString();await db().prepare(`UPDATE "automationJobHealth" SET "lastSucceededAt"=CASE WHEN $2::boolean THEN "lastSucceededAt" ELSE $3 END,"lastFailedAt"=CASE WHEN $2::boolean THEN $3 ELSE "lastFailedAt" END,"lastErrorCode"=CASE WHEN $2::boolean THEN 'rule_unavailable' ELSE NULL END,"processedEvents"="processedEvents"+$4,"updatedAt"=$3 WHERE "ownerId"=$1`).bind(ownerId,failed>0,finished,processed).run();return {processed,failed};
}
export async function drainAutomationBestEffort(ownerId:string){try{return await drainAutomationEvents(ownerId,{maxEvents:1,maxDurationMs:8000});}catch{console.error('Daybook Ticket automation drain unavailable');return {processed:0,failed:1};}}
export async function listAutomationExecutions(access:AccessContext,cursor:string|null=null,limit=50){pageInput(cursor,limit);return db().transaction(async tx=>{
  const fresh=requireAdmin(await lockAccess(tx,access));const {rows}=await tx.query(`SELECT id,"ticketId","ruleName",status,"summaryJson",attempts,"createdAt","updatedAt" FROM "automationExecutions" WHERE "ownerId"=$1 AND ($2::text IS NULL OR ("createdAt",id)<(SELECT "createdAt",id FROM "automationExecutions" WHERE id=$2 AND "ownerId"=$1)) ORDER BY "createdAt" DESC,id DESC LIMIT $3`,[fresh.ownerId,cursor,limit+1]);return {items:rows.slice(0,limit).map(row=>({...row,summary:JSON.parse(row.summaryJson),summaryJson:undefined})),nextCursor:rows.length>limit?rows[limit-1].id:null};
});}
export async function applyTaskTemplate(access:AccessContext,ticketId:number,input:z.output<typeof templateApplySchema>){return db().transaction(async tx=>{
  await acquireTicketWorkLock(tx,access.ownerId);const fresh=requireStaff(await lockAccess(tx,access));await requireAutomationInTransaction(tx,fresh.ownerId);
  const row=(await tx.query(`SELECT ${TEMPLATE_COLUMNS} FROM "taskTemplates" WHERE id=$1 AND "ownerId"=$2 AND NOT archived FOR SHARE`,[input.templateId,fresh.ownerId])).rows[0];
  const memberIds=row?publicTemplate(row).items.flatMap(item=>item.assigneeMemberId?[item.assigneeMemberId]:[]):[];
  if(memberIds.length)await tx.query('SELECT id FROM members WHERE "ownerId"=$1 AND id=ANY($2::text[]) ORDER BY id FOR SHARE',[fresh.ownerId,[...new Set(memberIds)]]);
  await lockTicket(tx,fresh,ticketId);
  return internalOperation(tx,fresh,input.operationId,'apply_task_template',{ticketId,...input},async()=>{
    const ticket=await loadContext(tx,fresh.ownerId,ticketId);
    if(!row)throw new ApiError(404,'La plantilla ya no está disponible.');const template=publicTemplate(row);
    if(template.version!==input.expectedTemplateVersion)throw new ApiError(409,'La plantilla cambió. Actualiza antes de aplicarla.');
    await validStaff(tx,fresh,template.items.flatMap(v=>v.assigneeMemberId?[v.assigneeMemberId]:[]));
    const tasks=template.items.map(v=>({...v,templateId:template.id,templateVersion:template.version})),key=`template:${fresh.member.id}:${input.operationId}`;
    if(ticket.taskCount+tasks.length>1000)throw new ApiError(409,'El ticket alcanzó su límite de tareas.');
    const created=await insertPlannedTasks(tx,fresh,ticketId,tasks,key);if(created){await tx.query('UPDATE tickets SET version=version+1,"updatedAt"=$1 WHERE id=$2 AND "ownerId"=$3',[new Date().toISOString(),ticketId,fresh.ownerId]);await systemEvent(tx,fresh.ownerId,ticketId,'task_template_applied',`${fresh.member.name} añadió ${created} tareas de «${template.name}».`);}return {created,templateId:template.id,templateVersion:template.version};
  });
});}
