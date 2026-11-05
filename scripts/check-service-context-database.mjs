import {seedQaWorkspaceProfiles} from './qa-workspace-profile.mjs';
/** SERIAL coordinator-only QA integration after additive migration 0009.
 * Everything is fictitious and rolled back. Blob and delivery providers are never contacted.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Database } from '../db/database.ts';
import { publicMember } from '../lib/access.ts';
import { listServiceContext,createServiceContext,updateServiceContext,saveTicketServiceContext,readTicketServiceContext,assetTicketHistory,listContractDocuments,attachContractDocuments,getServiceReminderConfig,saveServiceReminderConfig,listServiceReminders,markServiceReminderRead } from '../lib/service-context.ts';
import { enqueueServiceContextReminder,isServiceReminderEligibleForDelivery } from '../lib/service-context-reminders.ts';
import { reserveAttachment,completeAttachment,downloadAttachment,linkReadyAttachments } from '../lib/attachments.ts';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE,'1');
assert.equal(new URL(process.env.DATABASE_URL).hostname,'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
for(const name of ['RESEND_API_KEY','RESEND_INBOUND_API_KEY','VAPID_PRIVATE_KEY'])assert.ok(!process.env[name]);
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1}),client=await pool.connect();
const database=new Database(pool);let sequence=0;
database.execute=async(statement,tx)=>{const result=await (tx||client).query(statement.sql,[...statement.values]);return {results:result.rows,meta:{changes:result.rowCount||0}};};
database.transaction=async work=>{const point=`service_test_${++sequence}`;await client.query(`SAVEPOINT ${point}`);try{const result=await work(client);await client.query(`RELEASE SAVEPOINT ${point}`);return result;}catch(error){await client.query(`ROLLBACK TO SAVEPOINT ${point}`);await client.query(`RELEASE SAVEPOINT ${point}`);throw error;}};
const run=randomUUID(),owner=`qa-service-${run}`,foreignOwner=`qa-service-foreign-${run}`,org=`qa-service-${run}`,foreignOrg=`qa-service-foreign-${run}`;
const company=randomUUID(),otherCompany=randomUUID(),foreignCompany=randomUUID(),adminId=randomUUID(),agentId=randomUUID(),contactId=randomUUID(),managerId=randomUUID(),date='2026-11-05T12:00:00.000Z';
const files=new Map();const storage={read:async pathname=>{const bytes=files.get(pathname);return bytes?{size:bytes.length,stream:new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}})}:null;},remove:async pathname=>{files.delete(pathname);}};
async function access(id){const row=(await client.query('SELECT * FROM members WHERE id=$1',[id])).rows[0];return {organizationId:row.organizationId,ownerId:row.ownerId,userId:row.userId,role:row.role,member:publicMember({...row,hasAccount:true})};}
async function create(actor,resource,data,operationId=randomUUID()){return (await createServiceContext(actor,{resource,operationId,companyId:company,...data},database)).item;}
try{
 await client.query('BEGIN');
 await client.query('INSERT INTO organizations (id,"ownerId",name,"createdAt") VALUES ($1,$2,\'QA servicios\',$5),($3,$4,\'QA otra organización\',$5)',[org,owner,foreignOrg,foreignOwner,date]);
 await seedQaWorkspaceProfiles(client,[owner,foreignOwner],date);
 await client.query('INSERT INTO \"evolutionFeatures\" (\"ownerId\",\"featuresJson\",version,\"updatedAt\") VALUES ($1,$2,1,$3)',[owner,JSON.stringify({serviceContext:true}),date]);
 for(const [id,tenant,organization] of [[company,owner,org],[otherCompany,owner,org],[foreignCompany,foreignOwner,foreignOrg]])await client.query('INSERT INTO "customerCompanies" (id,"ownerId","organizationId",name,"createdAt","updatedAt") VALUES ($1,$2,$3,\'QA empresa\',$4,$4)',[id,tenant,organization,date]);
 for(const [id,role,companyId,companyAccess] of [[adminId,'admin',null,'own'],[agentId,'agent',null,'own'],[contactId,'client',company,'own'],[managerId,'client',company,'manager']])await client.query('INSERT INTO members (id,"organizationId","ownerId","userId",name,email,role,status,"customerCompanyId","companyAccess","createdAt","updatedAt","isTest") VALUES ($1,$2,$3,$4,\'QA persona\',$5,$6,\'active\',$7,$8,$9,$9,true)',[id,org,owner,randomUUID(),`${id}@example.test`,role,companyId,companyAccess,date]);
 const admin=await access(adminId),agent=await access(agentId),contact=await access(contactId),manager=await access(managerId);
 const defaultProfile=await listServiceContext(admin,new URLSearchParams({resource:'profiles',companyId:company}),database);assert.equal(defaultProfile.items[0].version,0);
 const profile=(await updateServiceContext(admin,'profiles',company,{expectedVersion:0,legalName:'Empresa de QA',primaryContactMemberId:contactId},database)).item;assert.equal(profile.version,1);
 await assert.rejects(updateServiceContext(admin,'profiles',company,{expectedVersion:0,legalName:'Obsoleto'},database),e=>e.status===409);
 const site=await create(admin,'sites',{name:'QA sede',address:'Dirección ficticia',primaryContactMemberId:contactId});
 const secondSite=await create(admin,'sites',{companyId:otherCompany,name:'QA sede ajena'});
 const service=await create(admin,'services',{name:'QA soporte',description:'Servicio ficticio',responsibleMemberId:agentId});
 const operationId=randomUUID(),assetData={name:'QA equipo',siteId:site.id,responsibleMemberId:agentId,assignedContactMemberId:contactId,warrantyUntil:'2027-07-01'};
 const asset=await create(admin,'assets',assetData,operationId),again=await create(admin,'assets',assetData,operationId);assert.equal(asset.id,again.id);
 await assert.rejects(create(admin,'assets',{...assetData,name:'Contenido distinto'},operationId),e=>e.status===409);
 await assert.rejects(create(admin,'assets',{...assetData,siteId:secondSite.id}),e=>e.status===400);
 const contract=await create(admin,'contracts',{name:'QA contrato',startsOn:'2026-01-01',endsOn:'2027-07-01',serviceIds:[service.id],responsibleMemberId:agentId});
 const foreignContract=await create(admin,'contracts',{companyId:otherCompany,name:'QA contrato otra empresa',startsOn:'2026-01-01',endsOn:'2027-07-01'});
 for(const actor of [contact,manager]){
  for(const resource of ['profiles','sites','assets','services','contracts'])await assert.rejects(listServiceContext(actor,new URLSearchParams({resource,companyId:company}),database),e=>e.status===403);
  await assert.rejects(listContractDocuments(actor,contract.id,database),e=>e.status===403);
 }
 await assert.rejects(create(agent,'assets',{name:'Agente no administra'}),e=>e.status===403);
 await assert.rejects(listServiceContext(admin,new URLSearchParams({resource:'assets',companyId:foreignCompany}),database),e=>e.status===404);
 const page=await listServiceContext(agent,new URLSearchParams({resource:'assets',companyId:company,limit:'1'}),database);assert.equal(page.items.length,1);
 const ticket=(await client.query('INSERT INTO tickets ("ownerId","creationKey",subject,"requesterName","requesterEmail","requesterMemberId","customerCompanyId",department,status,priority,"createdAt","updatedAt","dueAt","isTest") VALUES ($1,$2,\'QA contexto\',\'QA cliente\',\'client@example.test\',$3,$4,\'Soporte\',\'open\',\'normal\',$5,$5,\'2027-01-01T12:00:00Z\',true) RETURNING *',[owner,randomUUID(),contactId,company,date])).rows[0];
 const linked=await saveTicketServiceContext(agent,ticket.id,{expectedVersion:0,assetIds:[asset.id],contractIds:[contract.id]},database);assert.equal(linked.version,1);
 assert.equal((await assetTicketHistory(agent,asset.id,null,database)).items[0].id,ticket.id);
 assert.equal((await readTicketServiceContext(admin,ticket.id,database)).contracts[0].id,contract.id);
 await assert.rejects(saveTicketServiceContext(admin,ticket.id,{expectedVersion:0,assetIds:[],contractIds:[]},database),e=>e.status===409);
 await assert.rejects(saveTicketServiceContext(admin,ticket.id,{expectedVersion:1,assetIds:[asset.id],contractIds:[foreignContract.id]},database),e=>e.status===400);
 await assert.rejects(readTicketServiceContext(manager,ticket.id,database),e=>e.status===403);
 const ticketAfter=(await client.query('SELECT status,priority,"dueAt",version FROM tickets WHERE id=$1',[ticket.id])).rows[0];assert.deepEqual(ticketAfter,{status:ticket.status,priority:ticket.priority,dueAt:ticket.dueAt,version:ticket.version});
 const draftId=randomUUID(),bytes=Buffer.from('Contrato ficticio de QA, sin datos reales.');
 const reserved=await reserveAttachment(admin,{draftId,kind:'contract',contractId:contract.id,name:'contrato-qa.txt',size:bytes.length,contentType:'text/plain'},database,storage);files.set(reserved.pathname,bytes);
 await completeAttachment(admin,reserved.attachment.id,database,storage);
 const documentOperation=randomUUID(),documents={operationId:documentOperation,draftId,attachmentIds:[reserved.attachment.id]};
 await attachContractDocuments(admin,contract.id,documents,database);await attachContractDocuments(admin,contract.id,documents,database);
 assert.equal((await listContractDocuments(agent,contract.id,database)).attachments.length,1);
 const download=await downloadAttachment(agent,reserved.attachment.id,database,storage);assert.match(download.headers.get('Cache-Control'),/no-store/);assert.equal(await download.text(),bytes.toString());
 await assert.rejects(downloadAttachment(manager,reserved.attachment.id,database,storage),e=>e.status===404);
 const publicMessage=(await client.query('INSERT INTO messages ("ownerId","ticketId",author,"authorMemberId","authorRole",body,kind,"createdAt") VALUES ($1,$2,\'QA\',$3,\'agent\',\'QA público\',\'reply\',$4) RETURNING id',[owner,ticket.id,agentId,date])).rows[0];
 await assert.rejects(database.transaction(tx=>linkReadyAttachments(tx,agent,{ids:[reserved.attachment.id],draftId,kind:'reply',ticketId:ticket.id,messageId:publicMessage.id})),e=>e.status===409);
 await updateServiceContext(admin,'contracts',contract.id,{expectedVersion:0,archived:true},database);
 assert.equal((await listContractDocuments(agent,contract.id,database)).attachments.length,1);
 await assert.rejects(reserveAttachment(admin,{draftId:randomUUID(),kind:'contract',contractId:contract.id,name:'nuevo.txt',size:1,contentType:'text/plain'},database,storage),e=>e.status===404);
 await client.query('INSERT INTO "serviceContextNotificationSettings" ("ownerId",enabled,"activatedAt",version,"updatedAt") VALUES ($1,true,\'2026-01-01T12:00:00Z\',0,$2)',[owner,date]);
 const now=new Date('2027-06-01T15:00:00Z');assert.equal(await enqueueServiceContextReminder(database,owner,'asset',asset.id,now),1);assert.equal(await enqueueServiceContextReminder(database,owner,'asset',asset.id,now),0);
 const outbox=(await client.query('SELECT "ownerId","recipientMemberId","serviceReminderId" FROM "mailOutbox" WHERE "ownerId"=$1 AND event=\'service_due\'',[owner])).rows;assert.equal(outbox.length,1);assert.equal(outbox[0].recipientMemberId,agentId);
 assert.ok(await isServiceReminderEligibleForDelivery(database,outbox[0],now));
 const reminders=await listServiceReminders(agent,new URLSearchParams({companyId:company}),database);assert.equal(reminders.items.length,1);await markServiceReminderRead(agent,reminders.items[0].id,database);assert.ok((await listServiceReminders(agent,new URLSearchParams({companyId:company}),database)).items[0].readAt);
 await assert.rejects(listServiceReminders(manager,new URLSearchParams({companyId:company}),database),e=>e.status===403);
 await client.query('UPDATE members SET status=\'revoked\' WHERE id=$1',[agentId]);assert.equal(await isServiceReminderEligibleForDelivery(database,outbox[0],now),false);
 await client.query('UPDATE members SET status=\'active\' WHERE id=$1',[agentId]);await updateServiceContext(admin,'assets',asset.id,{expectedVersion:0,warrantyUntil:'2027-08-01'},database);assert.equal(await isServiceReminderEligibleForDelivery(database,outbox[0],now),false);
 const imported=await create(admin,'assets',{name:'QA garantía vencida importada',warrantyUntil:'2025-01-01'});assert.equal(await enqueueServiceContextReminder(database,owner,'asset',imported.id,now),0);
 assert.equal((await getServiceReminderConfig(admin,database)).enabled,true);await saveServiceReminderConfig(admin,{expectedVersion:0,enabled:false},database);assert.equal(await isServiceReminderEligibleForDelivery(database,outbox[0],now),false);
 const count=(await client.query('SELECT count(*)::int AS n FROM "mailOutbox" WHERE "ownerId"=$1 AND "recipientMemberId"=ANY($2::text[])',[owner,[contactId,managerId]])).rows[0].n;assert.equal(count,0);
 await client.query('ROLLBACK');assert.equal((await client.query('SELECT count(*)::int AS n FROM organizations WHERE "ownerId"=ANY($1::text[])',[[owner,foreignOwner]])).rows[0].n,0);
 console.log(JSON.stringify({result:'PASS',checks:['staff-only-two-company-scope','admin-versioned-crud-archive','idempotent-create','ticket-context-company-scope','ticket-sla-unchanged','asset-ticket-history','contract-private-documents','internal-files-never-public','reminder-stage-dedupe','delivery-revocation-and-date-revalidation','no-imported-stages','read-persistence','rollback-cleanup'],externalDeliveryRequests:0,externalBlobRequests:0,fixturesRemaining:0}));
}catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();await pool.end();}
