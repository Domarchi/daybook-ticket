/** Coordinator-only. Disposable QA schema, two index shapes, no external delivery. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {Database} from '../db/database.ts';
import {registerPushSubscriptionBatch} from '../lib/push-registration-compat.ts';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE,'1');
let qaTarget;try{qaTarget=new URL(process.env.DATABASE_URL||'');}catch{throw Error('Falta una conexión válida para la base aislada de QA.');}
assert.equal(qaTarget.hostname,'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
assert.equal(qaTarget.pathname,'/daybook_ticket');
assert.ok(['postgres:','postgresql:'].includes(qaTarget.protocol));
assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED,'0');
// Session-scoped search_path requires the verified direct connection, never the transaction pooler.
qaTarget.hostname='ep-falling-water-bbfa4ijl.c-15.us-east-1.aws.neon.tech';
qaTarget.searchParams.set('sslmode','verify-full');
for(const name of ['RESEND_API_KEY','RESEND_INBOUND_API_KEY','VAPID_PRIVATE_KEY'])assert.ok(!process.env[name]);
const schema=`qa_push_transition_${randomUUID().replaceAll('-','')}`,pool=new pg.Pool({connectionString:qaTarget.toString(),max:1}),client=await pool.connect();
assert.match(schema,/^qa_push_transition_[a-f0-9]{32}$/);
const trace={legacy:0,composite:0,savepointRollbacks:0};
const scoped={async query(sql,values){if(sql.includes('ON CONFLICT(endpoint)'))trace.legacy++;if(sql.includes('ON CONFLICT("ownerId","memberId",endpoint)'))trace.composite++;if(sql.startsWith('ROLLBACK TO SAVEPOINT daybook_push_registration'))trace.savepointRollbacks++;return client.query(sql,values);},release(){}};
const database=new Database({connect:async()=>scoped}),now='2026-11-05T18:00:00.000Z',endpoint='https://fcm.googleapis.com/fcm/send/qa-transition-fictitious';
const row={id:randomUUID(),ownerId:'qa-owner-a',memberId:'qa-member-a',endpoint,p256dh:'fictitious-key',auth:'fictitious-auth',now};
async function seedExtra(ownerId,memberId){for(let i=0;i<9;i++)await client.query('INSERT INTO "pushSubscriptions"(id,"ownerId","memberId",endpoint,p256dh,auth,active,"createdAt","updatedAt") VALUES($1,$2,$3,$4,\'fake\',\'fake\',true,$5,$5)',[randomUUID(),ownerId,memberId,`https://fcm.googleapis.com/fcm/send/${ownerId}-fictitious-${i}`,now]);}
try{
 await client.query(`CREATE SCHEMA "${schema}"`);await client.query(`SET search_path TO "${schema}"`);assert.equal((await client.query('SELECT current_schema() AS name')).rows[0].name,schema);
 await client.query('CREATE TABLE "pushSubscriptions"(id text PRIMARY KEY,"ownerId" text NOT NULL,"memberId" text NOT NULL,endpoint text NOT NULL,p256dh text NOT NULL,auth text NOT NULL,active boolean NOT NULL,"createdAt" text NOT NULL,"updatedAt" text NOT NULL)');
 await client.query('CREATE UNIQUE INDEX push_subscription_endpoint ON "pushSubscriptions"(endpoint)');
 await client.query('CREATE TABLE "mailOutbox"(id text PRIMARY KEY,"recipientMemberId" text NOT NULL,"createdAt" text NOT NULL)');
 await client.query('CREATE TABLE "pushDeliveries"(id text PRIMARY KEY,"subscriptionId" text NOT NULL,"eventId" text NOT NULL,status text NOT NULL,"leaseUntil" text,"updatedAt" text NOT NULL)');
 await client.query('INSERT INTO "pushSubscriptions" VALUES($1,$2,$3,$4,\'old-key\',\'old-auth\',true,\'2026-11-01T00:00:00.000Z\',\'2026-11-01T00:00:00.000Z\')',[row.id,row.ownerId,row.memberId,endpoint]);
 for(const [id,recipient,date]of [['old','qa-member-a','2026-11-01T00:00:00.000Z'],['wrong','qa-wrong-member','2026-11-05T18:01:00.000Z'],['keep','qa-member-a','2026-11-05T18:01:00.000Z']]){
  await client.query('INSERT INTO "mailOutbox" VALUES($1,$2,$3)',[id,recipient,date]);await client.query('INSERT INTO "pushDeliveries" VALUES($1,$2,$1,\'queued\',NULL,$3)',[id,row.id,now]);
 }
 assert.equal((await registerPushSubscriptionBatch(database,row))[1].results[0].id,row.id);
 const initial=(await client.query('SELECT "createdAt" FROM "pushSubscriptions" WHERE id=$1',[row.id])).rows[0].createdAt;assert.equal(initial,now);
 await registerPushSubscriptionBatch(database,{...row,id:randomUUID(),now:'2026-11-05T18:02:00.000Z'});
 assert.equal((await client.query('SELECT "createdAt" FROM "pushSubscriptions" WHERE id=$1',[row.id])).rows[0].createdAt,initial);
 const deliveries=Object.fromEntries((await client.query('SELECT id,status FROM "pushDeliveries"')).rows.map(value=>[value.id,value.status]));assert.deepEqual(deliveries,{old:'cancelled',wrong:'cancelled',keep:'queued'});
 await seedExtra(row.ownerId,row.memberId);
 assert.deepEqual((await registerPushSubscriptionBatch(database,{...row,id:randomUUID(),endpoint:`${endpoint}-eleven`}))[1].results,[]);
 assert.equal((await client.query('SELECT count(*)::int AS n FROM "pushSubscriptions" WHERE "ownerId"=$1 AND active',[row.ownerId])).rows[0].n,10);
 assert.equal(trace.composite,0);
 // Only the disposable schema changes. This models migration13's exact target replacement.
 await client.query('BEGIN');await client.query('DROP INDEX push_subscription_endpoint');await client.query('CREATE UNIQUE INDEX push_subscription_endpoint ON "pushSubscriptions"("ownerId","memberId",endpoint)');await client.query('COMMIT');
 const second={...row,id:randomUUID(),ownerId:'qa-owner-b',memberId:'qa-member-b'};
 assert.equal((await registerPushSubscriptionBatch(database,second))[1].results[0].id,second.id);
 assert.equal((await client.query('SELECT count(*)::int AS n FROM "pushSubscriptions" WHERE endpoint=$1',[endpoint])).rows[0].n,2,'The composite fallback never collapses another owner/member.');
 await registerPushSubscriptionBatch(database,{...second,id:randomUUID(),now:'2026-11-05T18:02:00.000Z'});
 assert.equal((await client.query('SELECT count(*)::int AS n FROM "pushSubscriptions" WHERE "ownerId"=$1',[second.ownerId])).rows[0].n,1);
 assert.equal((await client.query('SELECT "createdAt" FROM "pushSubscriptions" WHERE id=$1',[second.id])).rows[0].createdAt,now);
 assert.equal((await client.query('SELECT status FROM "pushDeliveries" WHERE id=\'keep\'')).rows[0].status,'queued','Another account registration cannot cancel the first account delivery.');
 await seedExtra(second.ownerId,second.memberId);
 assert.deepEqual((await registerPushSubscriptionBatch(database,{...second,id:randomUUID(),endpoint:`${endpoint}-eleven-b`}))[1].results,[]);
 assert.equal((await client.query('SELECT count(*)::int AS n FROM "pushSubscriptions" WHERE "ownerId"=$1 AND active',[second.ownerId])).rows[0].n,10);
 assert.equal(trace.composite,3);assert.equal(trace.savepointRollbacks,3);assert.equal(trace.legacy,6);
 console.log(JSON.stringify({result:'PASS',indexShapes:2,knownSavepointFallbacks:3,registrationIdempotent:true,activeDeviceLimit:10,scopedCancellation:true,externalDeliveries:0}));
}finally{
 await client.query('ROLLBACK');await client.query('RESET search_path');await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
 assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_namespace WHERE nspname=$1',[schema])).rows[0].n,0);
 client.release();await pool.end();console.log('QA push transition cleanup PASS: disposable schema removed.');
}
