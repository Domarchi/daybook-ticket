/** Coordinator-only SERIAL QA integration after 0008+0010. No migrations.
 * node --env-file=.env.test.local --import tsx scripts/check-automation-database.mjs
 * Fictitious fixture transaction, including worker health/receipts, always rolls back.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {DEFAULT_PILOT_LIMITS} from '../lib/workspace-model.ts';
import pg from 'pg';
import { getDatabase,getPool } from '../db/index.ts';
import { publicMember } from '../lib/access.ts';
import { acquireTicketWorkLock } from '../lib/work-lock.ts';
import { lockAccess } from '../lib/ticket-mutations.ts';
import { catalogMutationSchema } from '../lib/work-organization-model.ts';
import { createOrganizationCatalog } from '../lib/work-organization.ts';
import { automationRuleSchema,taskTemplateSchema,templateApplySchema,ticketRelationSchema,relationPatchSchema } from '../lib/automation-model.ts';
import { createAutomationRule,patchAutomationRule,listAutomationRuleVersions,saveAutomationSettings,getAutomationSettings,saveTaskTemplate,simulateAutomation,enqueueAutomationEvent,drainAutomationEvents,applyTaskTemplate,listAutomationExecutions } from '../lib/automation.ts';
import { createTicketRelation,listTicketRelations,patchTicketRelation } from '../lib/ticket-relations.ts';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE,'1');
assert.equal(new URL(process.env.DATABASE_URL).hostname,'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
assert.equal(new URL(process.env.DATABASE_URL).pathname,'/daybook_ticket');
assert.ok((process.env.BETTER_AUTH_SECRET?.length??0)>=32);
for(const name of ['RESEND_API_KEY','RESEND_INBOUND_API_KEY','VAPID_PRIVATE_KEY'])assert.ok(!process.env[name]);
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2}),tx=await pool.connect(),database=getDatabase();
const originalTransaction=database.transaction.bind(database),originalExecute=database.execute.bind(database),originalFetch=globalThis.fetch;
const token=randomUUID(),ownerId=`qa-automation-${token}`,organizationId=`qa-automation-${token}`,otherOwnerId=`qa-automation-other-${token}`,otherOrganizationId=`qa-automation-other-${token}`,companyId=randomUUID(),otherCompanyId=randomUUID(),now=new Date().toISOString(),dueAt=new Date(Date.now()+86400000).toISOString();
let savepoint=0,passed=0,externalRequests=0;
globalThis.fetch=async()=>{externalRequests++;throw new Error('External requests forbidden in automation QA.');};
database.execute=async statement=>{assert.equal(statement.database,database);const result=await tx.query(statement.sql,[...statement.values]);return {results:result.rows,meta:{changes:result.rowCount??0}};};
database.transaction=async work=>{const point=`automation_check_${++savepoint}`;await tx.query(`SAVEPOINT ${point}`);try{const value=await work(tx);await tx.query(`RELEASE SAVEPOINT ${point}`);return value;}catch(error){await tx.query(`ROLLBACK TO SAVEPOINT ${point}`);await tx.query(`RELEASE SAVEPOINT ${point}`);throw error;}};
async function expectStatus(work,status){await assert.rejects(work,error=>error?.status===status);}
async function member(name,role,owner=ownerId,organization=organizationId,company=null){const id=randomUUID();await tx.query(`INSERT INTO members (id,"organizationId","ownerId","userId",email,name,role,status,"customerCompanyId","companyAccess","createdAt","updatedAt","isTest") VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,'own',$9,$9,true)`,[id,organization,owner,`user-${id}`,`${id}@example.test`,name,role,company,now]);const row=(await tx.query('SELECT * FROM members WHERE id=$1',[id])).rows[0];return {organizationId:organization,ownerId:owner,userId:row.userId,role,member:publicMember({...row,hasAccount:true})};}
async function ticket(client,company=companyId){return (await tx.query(`INSERT INTO tickets ("ownerId","creationKey",subject,"requesterName","requesterEmail","requesterMemberId","customerCompanyId",department,priority,status,"createdAt","updatedAt","dueAt","isTest") VALUES ($1,$2,'QA automatización','Cliente ficticio',$3,$4,$5,'Soporte técnico','normal','open',$6,$6,$7,true) RETURNING *`,[ownerId,randomUUID(),client.member.email,client.member.id,company,now,dueAt])).rows[0];}
async function enqueue(access,ticketId,key=randomUUID(),kind='ticket_created'){return database.transaction(async connection=>{await acquireTicketWorkLock(connection,access.ownerId);const fresh=await lockAccess(connection,access);return enqueueAutomationEvent(connection,fresh,ticketId,key,kind);});}
const counts=async()=>{const tables=['automationSettings','automationRules','automationRuleVersions','taskTemplates','automationEvents','automationExecutions','automationJobHealth','ticketTasks','ticketEvents','operations'];return Object.fromEntries(await Promise.all(tables.map(async table=>[table,Number((await tx.query(`SELECT count(*) FROM "${table}" WHERE "ownerId"=$1`,[ownerId])).rows[0].count)])));};
try{
  await tx.query('BEGIN');
  for(const [id,owner]of [[organizationId,ownerId],[otherOrganizationId,otherOwnerId]])await tx.query('INSERT INTO organizations (id,"ownerId",name,"createdAt") VALUES ($1,$2,$3,$4)',[id,owner,'QA automatización',now]);
  for(const [id,owner]of [[organizationId,ownerId],[otherOrganizationId,otherOwnerId]])await tx.query('INSERT INTO \"workspaceProfiles\"(\"workspaceId\",\"ownerId\",state,\"brandName\",\"limitsJson\",\"createdAt\",\"updatedAt\") VALUES($1,$2,\'active\',\'Fictitious QA\',$3,$4,$4)',[id,owner,JSON.stringify(DEFAULT_PILOT_LIMITS),now]);
  for(const id of [companyId,otherCompanyId])await tx.query('INSERT INTO "customerCompanies" (id,"organizationId","ownerId",name,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$5)',[id,organizationId,ownerId,`QA ${id}`,now]);
  const admin=await member('QA administrador','owner'),agent=await member('QA agente A','agent'),second=await member('QA agente B','agent'),client=await member('QA cliente','client',ownerId,organizationId,companyId),otherClient=await member('QA otro cliente','client',ownerId,organizationId,companyId),outsider=await member('QA otro espacio','agent',otherOwnerId,otherOrganizationId);
  await tx.query('INSERT INTO \"evolutionFeatures\" (\"ownerId\",\"featuresJson\",\"updatedAt\") VALUES ($1,\'{"automation":true}\',$2)',[ownerId,now]);await tx.query('INSERT INTO \"evolutionFeatures\" (\"ownerId\",\"featuresJson\",\"updatedAt\") VALUES ($1,\'{"automation":true}\',$2)',[otherOwnerId,now]);
  const first=await ticket(client),another=await ticket(client),third=await ticket(client),foreignCompany=await ticket(client,otherCompanyId),differentRequester=await ticket(otherClient);
  const originalMessage=(await tx.query('INSERT INTO messages ("ownerId","ticketId",author,"authorMemberId","authorRole",body,kind,"createdAt") VALUES ($1,$2,$3,$4,\'client\',$5,\'request\',$6) RETURNING *',[ownerId,first.id,client.member.name,client.member.id,'Contenido original de QA',now])).rows[0];
  // A second database transaction cannot enter the same workspace write section.
  await acquireTicketWorkLock(tx,ownerId);const competing=await pool.connect();try{await competing.query('BEGIN');assert.equal((await competing.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked',[`daybook-ticket-work:${ownerId}`])).rows[0].locked,false);}finally{await competing.query('ROLLBACK');competing.release();}
  assert.equal((await getAutomationSettings(admin)).settings.enabled,false);assert.equal(await enqueue(client,first.id),null);
  await expectStatus(()=>getAutomationSettings(agent),403);await expectStatus(()=>getAutomationSettings(client),403);passed++;
  const tag=await createOrganizationCatalog(admin,catalogMutationSchema.parse({kind:'tag',definition:{name:'QA automática',color:'gold'}}));
  const template=await saveTaskTemplate(admin,taskTemplateSchema.parse({name:'QA diagnóstico',items:[{title:'Revisar acceso',assigneeMemberId:agent.member.id,dueAfterHours:4}]}));
  const draft=automationRuleSchema.parse({name:'QA regla',conditions:{customerCompanyId:companyId,events:['ticket_created','client_replied']},actions:{addTagIds:[tag.id],department:'Ventas',assignMemberIds:[agent.member.id,second.member.id],taskTemplateIds:[template.id]}});
  await expectStatus(()=>createAutomationRule(agent,draft),403);await expectStatus(()=>createAutomationRule(admin,{...draft,enabled:true}),409);
  const before=await counts(),simulation=await simulateAutomation(admin,{ticketId:first.id,eventKind:'ticket_created',rule:draft});assert.equal(simulation.plan.matches,true);assert.equal(simulation.plan.tasks.length,1);assert.deepEqual(await counts(),before);passed++;
  let rule=await createAutomationRule(admin,{...draft,enabled:true},simulation.simulationProof);
  const versions=await listAutomationRuleVersions(admin,rule.id);assert.equal(versions.items.length,1);assert.equal(versions.items[0].rule.version,0);
  await saveAutomationSettings(admin,{enabled:true,expectedVersion:0});
  const key=randomUUID(),event=await enqueue(client,first.id,key);assert.ok(event);assert.equal(await enqueue(client,first.id,key),event);
  await expectStatus(()=>enqueue(client,another.id,key),409);assert.equal((await drainAutomationEvents(ownerId,{maxEvents:1})).processed,1);
  const applied=(await tx.query('SELECT department,"assigneeMemberId",status,"dueAt","slaStartedAt","slaPolicySnapshot" FROM tickets WHERE id=$1',[first.id])).rows[0];
  assert.equal(applied.department,'Ventas');assert.ok([agent.member.id,second.member.id].includes(applied.assigneeMemberId));assert.equal(applied.status,first.status);assert.equal(applied.dueAt,first.dueAt);assert.equal(applied.slaStartedAt,first.slaStartedAt);assert.equal(applied.slaPolicySnapshot,first.slaPolicySnapshot);
  assert.equal(Number((await tx.query('SELECT count(*) FROM "ticketTasks" WHERE "ticketId"=$1',[first.id])).rows[0].count),1);
  assert.deepEqual(JSON.parse((await tx.query('SELECT "tagIdsJson" FROM "ticketOrganization" WHERE "ticketId"=$1',[first.id])).rows[0].tagIdsJson),[tag.id]);
  assert.equal((await drainAutomationEvents(ownerId)).processed,0);assert.equal((await listAutomationExecutions(admin)).items.length,1);passed++;
  // The independent feature switch pauses existing work without discarding history.
  const featurePausedEvent=await enqueue(client,first.id),healthBefore=(await tx.query('SELECT * FROM \"automationJobHealth\" WHERE \"ownerId\"=$1',[ownerId])).rows[0];await tx.query('UPDATE \"evolutionFeatures\" SET \"featuresJson\"=\'{"automation":false}\' WHERE \"ownerId\"=$1',[ownerId]);assert.equal(await enqueue(client,first.id),null);assert.equal((await drainAutomationEvents(ownerId)).processed,0);assert.equal((await tx.query('SELECT status FROM \"automationEvents\" WHERE id=$1',[featurePausedEvent])).rows[0].status,'queued');assert.deepEqual((await tx.query('SELECT * FROM \"automationJobHealth\" WHERE \"ownerId\"=$1',[ownerId])).rows[0],healthBefore);await tx.query('UPDATE \"evolutionFeatures\" SET \"featuresJson\"=\'{"automation":true}\' WHERE \"ownerId\"=$1',[ownerId]);await drainAutomationEvents(ownerId,{maxEvents:1});passed++;
  // Failure after actions but before the execution receipt rolls back every action.
  const atomic=await ticket(client),atomicEvent=await enqueue(client,atomic.id),originalQuery=tx.query.bind(tx);let failReceiptOnce=true;
  tx.query=(sql,...parameters)=>{if(failReceiptOnce&&typeof sql==='string'&&sql.startsWith('INSERT INTO \"automationExecutions\"')){failReceiptOnce=false;return Promise.reject(new Error('QA interrupted receipt write'));}return originalQuery(sql,...parameters);};
  try{assert.equal((await drainAutomationEvents(ownerId,{maxEvents:1})).failed,1);}finally{tx.query=originalQuery;}
  const afterInterrupted=(await tx.query('SELECT department,\"assigneeMemberId\",version FROM tickets WHERE id=$1',[atomic.id])).rows[0];assert.equal(afterInterrupted.department,atomic.department);assert.equal(afterInterrupted.assigneeMemberId,null);assert.equal(afterInterrupted.version,0);assert.equal(Number((await tx.query('SELECT count(*) FROM \"ticketTasks\" WHERE \"ticketId\"=$1',[atomic.id])).rows[0].count),0);
  await tx.query('UPDATE \"automationEvents\" SET \"nextAttemptAt\"=$1 WHERE id=$2',[now,atomicEvent]);await drainAutomationEvents(ownerId,{maxEvents:1});assert.equal(Number((await tx.query('SELECT count(*) FROM \"ticketTasks\" WHERE \"ticketId\"=$1',[atomic.id])).rows[0].count),1);passed++;
  // A genuinely new event is processed once; an existing manual owner is retained.
  await tx.query('UPDATE tickets SET "assigneeMemberId"=$1,assignee=$2 WHERE id=$3',[second.member.id,second.member.name,another.id]);
  await enqueue(client,another.id);await drainAutomationEvents(ownerId);
  assert.equal((await tx.query('SELECT "assigneeMemberId" FROM tickets WHERE id=$1',[another.id])).rows[0].assigneeMemberId,second.member.id);passed++;
  const legacy=await ticket(client);await tx.query('UPDATE tickets SET assignee=\'QA responsable histórico\' WHERE id=$1',[legacy.id]);await enqueue(client,legacy.id);await drainAutomationEvents(ownerId);const legacyAfter=(await tx.query('SELECT assignee,"assigneeMemberId" FROM tickets WHERE id=$1',[legacy.id])).rows[0];assert.equal(legacyAfter.assignee,'QA responsable histórico');assert.equal(legacyAfter.assigneeMemberId,null);passed++;
  // Capacity and availability are reread under the same workspace work lock.
  for(const access of [agent,second])await tx.query(`INSERT INTO "agentAvailability" ("memberId","ownerId",available,capacity,version,"updatedAt") VALUES ($1,$2,false,20,0,$3) ON CONFLICT ("memberId") DO UPDATE SET available=false`,[access.member.id,ownerId,now]);
  await enqueue(client,third.id);await drainAutomationEvents(ownerId);assert.equal((await tx.query('SELECT "assigneeMemberId" FROM tickets WHERE id=$1',[third.id])).rows[0].assigneeMemberId,null);passed++;
  // Manual template application has a versioned operation receipt, preserving the original retry result.
  const manual=templateApplySchema.parse({operationId:randomUUID(),templateId:template.id,expectedTemplateVersion:template.version}),manualResult=await applyTaskTemplate(agent,first.id,manual);assert.equal(manualResult.created,1);assert.deepEqual(await applyTaskTemplate(agent,first.id,manual),manualResult);
  await expectStatus(()=>applyTaskTemplate(client,first.id,manual),403);await expectStatus(()=>applyTaskTemplate(outsider,first.id,{...manual,operationId:randomUUID()}),404);await expectStatus(()=>applyTaskTemplate(agent,first.id,{...manual,expectedTemplateVersion:template.version+1}),409);passed++;
  // Frozen references require resimulation after edits, preventing silently new task content.
  const staleProof=await simulateAutomation(admin,{ticketId:first.id,eventKind:'ticket_created',rule:draft});
  const changedTemplate=await saveTaskTemplate(admin,{name:template.name,items:[{...template.items[0],title:'Contenido revisado'}]},template.id,template.version);
  await expectStatus(()=>patchAutomationRule(admin,{id:rule.id,expectedVersion:rule.version,rule:{...draft,enabled:true},simulationProof:staleProof.simulationProof}),409);assert.deepEqual(await applyTaskTemplate(agent,first.id,manual),manualResult);
  const failing=await enqueue(client,first.id,randomUUID(),'client_replied'),taskCount=Number((await tx.query('SELECT count(*) FROM "ticketTasks" WHERE "ticketId"=$1',[first.id])).rows[0].count);
  assert.equal((await drainAutomationEvents(ownerId,{maxEvents:1})).failed,1);assert.equal(Number((await tx.query('SELECT count(*) FROM "ticketTasks" WHERE "ticketId"=$1',[first.id])).rows[0].count),taskCount);
  for(let index=0;index<2;index++){await tx.query('UPDATE "automationEvents" SET "nextAttemptAt"=$1 WHERE id=$2',[now,failing]);await drainAutomationEvents(ownerId,{maxEvents:1});}
  assert.equal((await tx.query('SELECT status FROM "automationEvents" WHERE id=$1',[failing])).rows[0].status,'failed');passed++;
  const refreshed=await simulateAutomation(admin,{ticketId:first.id,eventKind:'ticket_created',rule:draft});rule=await patchAutomationRule(admin,{id:rule.id,expectedVersion:rule.version,rule:{...draft,enabled:true},simulationProof:refreshed.simulationProof});assert.equal(rule.version,1);assert.equal((await listAutomationRuleVersions(admin,rule.id)).items[1].rule.referencesHash,versions.items[0].rule.referencesHash);
  const oldEvent=await enqueue(client,first.id);await tx.query('UPDATE "automationEvents" SET "createdAt"=$1 WHERE id=$2',['2020-01-01T00:00:00.000Z',oldEvent]);await drainAutomationEvents(ownerId);assert.equal((await tx.query('SELECT status FROM "automationEvents" WHERE id=$1',[oldEvent])).rows[0].status,'cancelled');passed++;
  const revoked=await enqueue(client,first.id);await tx.query('UPDATE members SET "customerCompanyId"=$1 WHERE id=$2',[otherCompanyId,client.member.id]);await drainAutomationEvents(ownerId);assert.equal((await tx.query('SELECT status FROM "automationEvents" WHERE id=$1',[revoked])).rows[0].status,'cancelled');await tx.query('UPDATE members SET "customerCompanyId"=$1 WHERE id=$2',[companyId,client.member.id]);passed++;
  const revokedAuthorEvent=await enqueue(client,first.id),beforeRevokedAuthor=await counts();await tx.query('UPDATE members SET status=\'revoked\' WHERE id=$1',[admin.member.id]);assert.equal((await drainAutomationEvents(ownerId,{maxEvents:1})).failed,1);assert.equal((await counts()).ticketTasks,beforeRevokedAuthor.ticketTasks);assert.equal((await tx.query('SELECT attempts FROM "automationEvents" WHERE id=$1',[revokedAuthorEvent])).rows[0].attempts,1);await tx.query('UPDATE members SET status=\'active\' WHERE id=$1',[admin.member.id]);await tx.query('UPDATE "automationEvents" SET status=\'cancelled\' WHERE id=$1',[revokedAuthorEvent]);passed++;
  // Duplicate links keep every ticket intact and cannot create chains, cycles or cross-client links.
  const relationInput=ticketRelationSchema.parse({operationId:randomUUID(),targetTicketId:another.id,kind:'duplicate'}),relation=await createTicketRelation(agent,first.id,relationInput);assert.deepEqual(await createTicketRelation(agent,first.id,relationInput),relation);
  assert.equal((await listTicketRelations(agent,first.id)).items[0].otherTicket.id,another.id);assert.equal((await listTicketRelations(agent,another.id)).items[0].isPrincipal,true);
  for(const id of [foreignCompany.id,differentRequester.id])await expectStatus(()=>createTicketRelation(agent,third.id,ticketRelationSchema.parse({operationId:randomUUID(),targetTicketId:id,kind:'duplicate'})),400);
  await expectStatus(()=>createTicketRelation(agent,another.id,ticketRelationSchema.parse({operationId:randomUUID(),targetTicketId:third.id,kind:'duplicate'})),409);
  await expectStatus(()=>listTicketRelations(client,first.id),403);await expectStatus(()=>listTicketRelations(outsider,first.id),404);
  const linked=(await listTicketRelations(agent,first.id)).items[0];await patchTicketRelation(agent,first.id,relationPatchSchema.parse({id:linked.id,expectedVersion:linked.version,archived:true}));await expectStatus(()=>patchTicketRelation(agent,first.id,{id:linked.id,expectedVersion:linked.version,archived:false}),409);
  await patchTicketRelation(agent,first.id,{id:linked.id,expectedVersion:linked.version+1,archived:false});assert.equal((await listTicketRelations(agent,first.id)).items.length,1);passed++;
  const preservedMessage=(await tx.query('SELECT * FROM messages WHERE id=$1',[originalMessage.id])).rows[0];assert.deepEqual(preservedMessage,originalMessage);
  const preserved=(await tx.query('SELECT status,"dueAt","slaStartedAt","slaPolicySnapshot" FROM tickets WHERE id=$1',[first.id])).rows[0];for(const name of Object.keys(preserved))assert.equal(preserved[name],first[name]);
  const pendingBeforePause=await enqueue(client,first.id);await saveAutomationSettings(admin,{enabled:false,expectedVersion:1});assert.equal(await enqueue(client,first.id),null);assert.equal((await drainAutomationEvents(ownerId)).processed,0);await saveAutomationSettings(admin,{enabled:true,expectedVersion:2});await drainAutomationEvents(ownerId);assert.equal((await tx.query('SELECT status FROM "automationEvents" WHERE id=$1',[pendingBeforePause])).rows[0].status,'cancelled');await saveAutomationSettings(admin,{enabled:false,expectedVersion:3});assert.equal(changedTemplate.version,1);assert.equal(externalRequests,0);passed++;
  console.log(JSON.stringify({passedGroups:passed,externalDeliveries:externalRequests,fixtures:'rolled back in finally',concurrency:'second database transaction excluded by workspace lock; event receipt and action replay verified'}));
}finally{
  database.transaction=originalTransaction;database.execute=originalExecute;globalThis.fetch=originalFetch;
  await tx.query('ROLLBACK');assert.equal(Number((await tx.query('SELECT count(*) FROM organizations WHERE id=$1 OR id=$2',[organizationId,otherOrganizationId])).rows[0].count),0);
  tx.release();await pool.end();await getPool().end();
}
