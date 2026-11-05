/** Coordinator-only, serial QA fixtures: every database write is rolled back. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {getDatabase} from '../db/index.ts';
import {publicMember} from '../lib/access.ts';
import {validateMessageCollaboration,attachMessageCollaboration,hydrateMessageReferences,getMessageContext,searchTicketMessages,getTicketFiles,getTicketFollowers,setTicketFollowing,followerRecipients,collaborationDeliveryValid} from '../lib/ticket-collaboration.ts';
import {runOperation} from '../lib/ticket-mutations.ts';
import {notificationStatements} from '../lib/mail.ts';
import {getAlertsPage} from '../lib/alerts.ts';
import {getUserPreferences,saveUserPreferences} from '../lib/user-preferences.ts';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE,'1');assert.equal(new URL(process.env.DATABASE_URL).hostname,'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
for(const key of ['RESEND_API_KEY','RESEND_INBOUND_API_KEY','VAPID_PRIVATE_KEY'])assert.ok(!process.env[key]);
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1}),client=await pool.connect(),database=getDatabase();
const originals={execute:database.execute,transaction:database.transaction};let savepoint=0;
database.execute=async(statement)=>{const result=await client.query(statement.sql,[...statement.values]);return{results:result.rows,meta:{changes:result.rowCount??0}};};
database.transaction=async work=>{const name=`collab_${++savepoint}`;await client.query(`SAVEPOINT ${name}`);try{const value=await work(client);await client.query(`RELEASE SAVEPOINT ${name}`);return value;}catch(error){await client.query(`ROLLBACK TO SAVEPOINT ${name}`);throw error;}};
const ownerId=`qa-collaboration-${randomUUID()}`,organizationId=ownerId,now=new Date().toISOString(),a=randomUUID(),b=randomUUID();
const ids={staff:randomUUID(),peer:randomUUID(),alice:randomUUID(),manager:randomUUID(),bob:randomUUID()},users={};
async function access(id){const row=(await client.query('SELECT * FROM members WHERE id=$1',[id])).rows[0];return{ownerId,organizationId,userId:row.userId,role:row.role,member:publicMember({...row,hasAccount:true})};}
async function reject(promise,status){await assert.rejects(promise,error=>error.status===status);}
let assertions=0;
try{
 await client.query('BEGIN');await client.query('INSERT INTO organizations (id,"ownerId",name,"createdAt") VALUES ($1,$2,\'QA collaboration\',$3)',[organizationId,ownerId,now]);
 for(const [id,name]of[[a,'QA company A'],[b,'QA company B']])await client.query('INSERT INTO "customerCompanies" (id,"organizationId","ownerId",name,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$5)',[id,organizationId,ownerId,name,now]);
 for(const [name,id]of Object.entries(ids)){
  const role=['staff','peer'].includes(name)?(name==='staff'?'owner':'agent'):'client',company=role==='client'?(name==='bob'?b:a):null;
  users[name]=randomUUID();await client.query('INSERT INTO "authUser" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,$2,$3,true,$4,$4)',[users[name],`QA ${name}`,`${users[name]}@example.test`,now]);
  await client.query('INSERT INTO members (id,"organizationId","ownerId","userId",email,name,role,status,"customerCompanyId","companyAccess","createdAt","updatedAt","isTest") VALUES ($1,$2,$3,$4,$5,$6,$7,\'active\',$8,$9,$10,$10,true)',[id,organizationId,ownerId,users[name],`${users[name]}@example.test`,`QA ${name}`,role,company,name==='manager'?'manager':'own',now]);
 }
 const contexts={};for(const [name,id]of Object.entries(ids))contexts[name]=await access(id);
 const ticket=async(member,company)=>Number((await client.query('INSERT INTO tickets ("ownerId","creationKey",subject,"requesterName","requesterEmail","requesterMemberId","customerCompanyId",department,assignee,status,"createdAt","updatedAt","dueAt","isTest") VALUES ($1,$2,\'QA collaboration case\',\'QA contact\',\'qa@example.test\',$3,$4,\'Soporte\',\'\',\'open\',$5,$5,$6,true) RETURNING id',[ownerId,randomUUID(),member,company,now,new Date(Date.now()+86400000).toISOString()])).rows[0].id);
 const ticketA=await ticket(ids.alice,a),ticketB=await ticket(ids.bob,b);
 const message=async(ticketId,kind,body,author=ids.staff,at=now)=>Number((await client.query('INSERT INTO messages ("ownerId","ticketId",author,"authorMemberId","authorRole",body,kind,"createdAt") VALUES ($1,$2,\'QA author\',$3,$4,$5,$6,$7) RETURNING id',[ownerId,ticketId,author,author===ids.alice?'client':'agent',body,kind,at])).rows[0].id);
 const publicId=await message(ticketA,'request','PUBLIC_NEEDLE',ids.alice),privateId=await message(ticketA,'note','PRIVATE_NEEDLE'),otherId=await message(ticketB,'request','OTHER_COMPANY_NEEDLE',ids.bob);
 await client.query('INSERT INTO "evolutionFeatures" ("ownerId","featuresJson","updatedAt") VALUES ($1,\'{"collaboration":true}\',$2)',[ownerId,now]);
 const makeFile=async(id,kind,name)=>{const fileId=randomUUID();await client.query('INSERT INTO attachments (id,"ownerId","memberId","draftId","ticketId","messageId",kind,pathname,name,"contentType",size,status,"expiresAt","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,\'application/pdf\',8,\'attached\',$10,$10,$10)',[fileId,ownerId,ids.staff,randomUUID(),ticketA,id,kind,`qa/${fileId}`,name,now]);return fileId;};
 await makeFile(publicId,'request','public-document.pdf');await makeFile(privateId,'note','PRIVATE_FILE.pdf');
 const valid=await validateMessageCollaboration(client,contexts.alice,ticketA,{kind:'reply',replyToMessageId:publicId});assert.equal(valid.quote.id,publicId);
 await reject(validateMessageCollaboration(client,contexts.staff,ticketA,{kind:'reply',replyToMessageId:privateId}),400);
 await reject(validateMessageCollaboration(client,contexts.alice,ticketA,{kind:'reply',replyToMessageId:privateId}),400);
 await reject(validateMessageCollaboration(client,contexts.staff,ticketA,{kind:'reply',replyToMessageId:otherId}),400);assertions++;
 const mention=await validateMessageCollaboration(client,contexts.staff,ticketA,{kind:'note',replyToMessageId:privateId,mentionMemberIds:[ids.peer,ids.peer,ids.staff]});assert.equal(mention.mentions.length,1);
 await reject(validateMessageCollaboration(client,contexts.staff,ticketA,{kind:'note',mentionMemberIds:[ids.alice]}),400);
 await reject(validateMessageCollaboration(client,contexts.staff,ticketA,{kind:'reply',mentionMemberIds:[ids.peer]}),400);assertions++;
 const operationId=randomUUID(),payload={body:'QA mention once',kind:'note',replyToMessageId:privateId,mentionMemberIds:[ids.peer]};let executions=0;
 const send=()=>runOperation(contexts.staff,operationId,'message',{ticketId:ticketA,...payload},async tx=>{
  executions++;const data=await validateMessageCollaboration(tx,contexts.staff,ticketA,payload),id=await message(ticketA,'note',payload.body);await attachMessageCollaboration(tx,contexts.staff,id,data);
  for(const statement of notificationStatements(database,{ownerId,event:'member_mentioned',eventKey:operationId,recipientMemberId:ids.peer,ticketId:ticketA,sourceMessageId:id}))await database.execute(statement,tx);
  return{message:{id,ticketId:ticketA,kind:'note',...data}};
 });
 const result=await send();assert.deepEqual(await send(),result);assert.equal(executions,1);assert.equal((await client.query('SELECT count(*)::int AS n FROM "mailOutbox" WHERE "ownerId"=$1',[ownerId])).rows[0].n,1);
 await reject(runOperation(contexts.staff,operationId,'message',{ticketId:ticketA,...payload,body:'changed'},async()=>({})),409);assertions++;
 const event=(await client.query('SELECT * FROM "mailOutbox" WHERE "ownerId"=$1',[ownerId])).rows[0];assert.equal(await collaborationDeliveryValid(database,event),true);
 assert.equal((await getAlertsPage(contexts.peer)).items.filter(row=>row.event==='member_mentioned').length,1);
 assert.equal((await getAlertsPage(contexts.alice)).items.some(row=>row.event==='member_mentioned'),false);
 await client.query('UPDATE members SET status=\'revoked\' WHERE id=$1',[ids.peer]);assert.equal(await collaborationDeliveryValid(database,event),false);await client.query('UPDATE members SET status=\'active\' WHERE id=$1',[ids.peer]);assertions++;
 const search=await searchTicketMessages(contexts.alice,ticketA,{q:'PRIVATE',limit:20,cursor:null});assert.equal(search.total,0);
 assert.equal((await searchTicketMessages(contexts.manager,ticketA,{q:'PUBLIC',limit:20,cursor:null})).total,1);
 await reject(searchTicketMessages(contexts.bob,ticketA,{q:'PUBLIC',limit:20,cursor:null}),404);
 assert.equal((await getMessageContext(contexts.alice,ticketA,publicId)).messages.some(row=>row.kind==='note'),false);await reject(getMessageContext(contexts.alice,ticketA,privateId),404);
 assert.equal((await getTicketFiles(contexts.alice,ticketA,new URLSearchParams())).total,1);assert.equal((await getTicketFiles(contexts.staff,ticketA,new URLSearchParams())).total,2);assertions++;
 await setTicketFollowing(contexts.peer,ticketA,true);assert.equal((await getTicketFollowers(contexts.peer,ticketA)).following,true);assert.deepEqual(await followerRecipients(client,contexts.staff,ticketA,[ids.peer]),[]);assert.deepEqual(await followerRecipients(client,contexts.staff,ticketA,[]),[ids.peer]);
 const publicUpdate=await message(ticketA,'reply','A public update');const followEvent={ownerId,event:'ticket_followed_update',ticketId:ticketA,sourceMessageId:publicUpdate,recipientMemberId:ids.peer};assert.equal(await collaborationDeliveryValid(database,followEvent),true);
 await setTicketFollowing(contexts.peer,ticketA,false);assert.equal(await collaborationDeliveryValid(database,followEvent),false);await reject(getTicketFollowers(contexts.alice,ticketA),403);assertions++;
 const enriched=await hydrateMessageReferences(contexts.staff,[{id:result.message.id,ticketId:ticketA,replyToMessageId:privateId,kind:'note',attachments:[]}]);assert.equal(enriched[0].quote.id,privateId);assert.equal(enriched[0].mentions[0].id,ids.peer);
 await client.query('UPDATE "evolutionFeatures" SET "featuresJson"=\'{}\' WHERE "ownerId"=$1',[ownerId]);await reject(validateMessageCollaboration(client,contexts.staff,ticketA,{kind:'reply',replyToMessageId:publicId}),503);
 assert.deepEqual(await followerRecipients(client,contexts.staff,ticketA,[]),[]);assertions++;
 assert.equal((await getUserPreferences(users.alice)).theme,'system');await saveUserPreferences(users.alice,{theme:'dark'});assert.equal((await getUserPreferences(users.alice)).theme,'dark');assert.equal((await getUserPreferences(users.bob)).theme,'system');assertions++;
 await client.query('ROLLBACK');assert.equal((await client.query('SELECT count(*)::int AS n FROM organizations WHERE id=$1',[organizationId])).rows[0].n,0);
 console.log(JSON.stringify({result:'PASS',groups:assertions,rolledBack:true,externalDeliveries:0}));
}finally{await client.query('ROLLBACK').catch(()=>undefined);database.execute=originals.execute;database.transaction=originals.transaction;client.release();await pool.end();}
