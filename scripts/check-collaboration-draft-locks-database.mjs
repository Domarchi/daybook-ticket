/** Coordinator-only serial QA. All fictitious data rolls back. No migrations/providers.
 * node --env-file=.env.test.local --import tsx scripts/check-collaboration-draft-locks-database.mjs
 */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {getDatabase,getPool} from '../db/index.ts';
import {publicMember} from '../lib/access.ts';
import {acquireTicketWorkLock} from '../lib/work-lock.ts';
import {lockAccess,lockTicket} from '../lib/ticket-mutations.ts';
import {setTicketFollowing,validateMessageCollaboration} from '../lib/ticket-collaboration.ts';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE,'1');assert.equal(new URL(process.env.DATABASE_URL).hostname,'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');assert.equal(new URL(process.env.DATABASE_URL).pathname,'/daybook_ticket');
for(const key of ['RESEND_API_KEY','RESEND_INBOUND_API_KEY','VAPID_PRIVATE_KEY'])assert.ok(!process.env[key]);
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2}),tx=await pool.connect(),database=getDatabase(),originalTransaction=database.transaction.bind(database);
const ownerId=`qa-draft-locks-${randomUUID()}`,organizationId=ownerId,now=new Date().toISOString(),admin=randomUUID(),peer=randomUUID(),requester=randomUUID();let point=0;
const fixtureTransaction=async work=>{const name=`draft_lock_${++point}`;await tx.query(`SAVEPOINT ${name}`);try{const value=await work(tx);await tx.query(`RELEASE SAVEPOINT ${name}`);return value;}catch(error){await tx.query(`ROLLBACK TO SAVEPOINT ${name}`);await tx.query(`RELEASE SAVEPOINT ${name}`);throw error;}};
database.transaction=fixtureTransaction;
try{
 await tx.query('BEGIN');await tx.query('INSERT INTO organizations (id,"ownerId",name,"createdAt") VALUES ($1,$2,\'QA draft locks\',$3)',[organizationId,ownerId,now]);
 const contexts={};for(const [id,role]of[[admin,'owner'],[peer,'agent'],[requester,'client']]){const userId=randomUUID();await tx.query(`INSERT INTO members (id,"organizationId","ownerId","userId",email,name,role,status,"companyAccess","createdAt","updatedAt","isTest") VALUES ($1,$2,$3,$4,$5,'QA ficticio',$6,'active','own',$7,$7,true)`,[id,organizationId,ownerId,userId,`${id}@example.test`,role,now]);const row=(await tx.query('SELECT * FROM members WHERE id=$1',[id])).rows[0];contexts[id]={organizationId,ownerId,userId,role,member:publicMember({...row,hasAccount:true})};}
 const ticket=(await tx.query(`INSERT INTO tickets ("ownerId","creationKey",subject,"requesterName","requesterEmail","requesterMemberId",department,priority,status,"createdAt","updatedAt","dueAt","isTest") VALUES ($1,$2,'QA draft lock','QA customer','qa@example.test',$3,'Soporte','normal','open',$4,$4,$4,true) RETURNING id`,[ownerId,randomUUID(),requester,now])).rows[0];
 await tx.query('INSERT INTO "evolutionFeatures" ("ownerId","featuresJson","updatedAt") VALUES ($1,\'{"collaboration":true}\',$2)',[ownerId,now]);
 await acquireTicketWorkLock(tx,ownerId);
 // A competing follower mutation must wait on the owner lock, before touching
 // membership or tickets. The uncommitted fixtures are deliberately invisible
 // on this second connection; without that ordering it would immediately 403.
 const other=await pool.connect();try{await other.query('BEGIN');await other.query("SET LOCAL lock_timeout='150ms'");database.transaction=work=>work(other);await assert.rejects(setTicketFollowing(contexts[peer],ticket.id,true),error=>error.code==='55P03');}finally{await other.query('ROLLBACK');other.release();database.transaction=fixtureTransaction;}
 const fresh=await lockAccess(tx,contexts[admin]);const prepared=await validateMessageCollaboration(tx,fresh,ticket.id,{kind:'note',mentionMemberIds:[peer]});assert.equal(prepared.mentions[0].id,peer);await lockTicket(tx,fresh,ticket.id);
 const outsider={...fresh,ownerId:'unrelated-owner'};await assert.rejects(validateMessageCollaboration(tx,outsider,ticket.id,{kind:'reply',replyToMessageId:1}),error=>error.status===404);
 console.log(JSON.stringify({result:'PASS',checks:['followers-owner-lock-before-member','mentions-reserved-before-ticket','quote-authorization-before-source-existence'],fixtures:'rollback'}));
}finally{database.transaction=originalTransaction;await tx.query('ROLLBACK');assert.equal(Number((await tx.query('SELECT count(*) FROM organizations WHERE id=$1',[organizationId])).rows[0].count),0);tx.release();await pool.end();await getPool().end();}
