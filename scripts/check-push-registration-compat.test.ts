import assert from 'node:assert/strict';
import test from 'node:test';
import type {Pool,PoolClient} from 'pg';
import {Database} from '../db/database';
import {registerPushSubscriptionBatch,type PushRegistrationRecord} from '../lib/push-registration-compat';
const input:PushRegistrationRecord={id:'fictitious-id',ownerId:'owner-a',memberId:'member-a',endpoint:'https://fcm.googleapis.com/fcm/send/fictitious-only',p256dh:'fictitious-key',auth:'fictitious-auth',now:'2026-11-05T18:00:00.000Z'};
const missingTarget=()=>Object.assign(new Error('there is no unique or exclusion constraint matching the ON CONFLICT specification'),{code:'42P10',routine:'infer_arbiter_indexes'});
type Phase='begin'|'savepoint'|'lock'|'legacy'|'composite'|'cancel'|'release'|'rollback-to'|'commit';
function fixture(schema:'legacy'|'composite',failure?:{phase:Phase;error:Error},empty=false){
 const queries:{sql:string;values:unknown[];phase:string}[]=[],writes:{sql:string;values:unknown[]}[]=[];let committed=false,releases=0;
 const phase=(sql:string):string=>sql==='BEGIN'?'begin':sql==='COMMIT'?'commit':sql==='ROLLBACK'?'rollback':sql.startsWith('ROLLBACK TO')?'rollback-to':sql.startsWith('RELEASE SAVEPOINT')?'release':sql.startsWith('SAVEPOINT')?'savepoint':sql.includes('pg_advisory_xact_lock')?'lock':sql.startsWith('INSERT')?(sql.includes('ON CONFLICT(endpoint)')?'legacy':'composite'):'cancel';
 const client={async query(sql:string,values:unknown[]=[]){
  const current=phase(sql);queries.push({sql,values,phase:current});
  if(current==='commit')committed=true; // A lost acknowledgement may already have committed.
  if(current==='rollback'&&!committed)writes.length=0;
  if(current==='rollback-to')writes.length=0;
  if(failure?.phase===current)throw failure.error;
  if(current==='legacy'&&schema==='composite')throw missingTarget();
  if(current==='legacy'||current==='composite'||current==='cancel')writes.push({sql,values});
  return {rows:current==='legacy'||current==='composite'?empty?[]:[{id:input.id}]:[],rowCount:current==='legacy'||current==='composite'?empty?0:1:0};
 },release(){releases++;}};
 return {database:new Database({connect:async()=>client as unknown as PoolClient} as unknown as Pool),queries,writes,get releases(){return releases;}};
}
const insertPhases=(value:ReturnType<typeof fixture>)=>value.queries.filter(query=>['legacy','composite'].includes(query.phase)).map(query=>query.phase);
test('legacy index uses one transaction, one insert and the existing account lock/cancellations',async()=>{
 const f=fixture('legacy'),rows=await registerPushSubscriptionBatch(f.database,input);
 assert.equal(rows[1].results[0].id,input.id);assert.deepEqual(f.queries.map(query=>query.phase),['begin','savepoint','lock','legacy','cancel','release','commit']);assert.equal(f.releases,1);
});
test('only a confirmed missing legacy target repeats the batch after acknowledged rollback, before COMMIT',async()=>{
 const f=fixture('composite'),rows=await registerPushSubscriptionBatch(f.database,input);
 assert.equal(rows[1].results[0].id,input.id);assert.deepEqual(f.queries.map(query=>query.phase),['begin','savepoint','lock','legacy','rollback-to','lock','composite','cancel','release','commit']);
 const attempts=f.queries.filter(query=>['legacy','composite'].includes(query.phase));assert.deepEqual(attempts[0].values,attempts[1].values,'The registration ID, timestamp and bound scope stay identical.');
 assert.match(attempts[1].sql,/ON CONFLICT\("ownerId","memberId",endpoint\)/);assert.match(attempts[1].sql,/"ownerId" = \$2 AND "memberId" = \$3 AND active = true AND endpoint <> \$4\) < 10/);assert.match(attempts[1].sql,/THEN "pushSubscriptions"\."createdAt" ELSE/);
 const cancel=f.queries.find(query=>query.phase==='cancel')!;assert.deepEqual(cancel.values,[input.now,input.endpoint,input.memberId,input.ownerId]);assert.match(cancel.sql,/s\."memberId" = \$3 AND s\."ownerId" = \$4/);assert.equal(f.writes.filter(query=>query.sql.startsWith('INSERT')).length,1);
});
test('empty insert result does not trigger compatibility retries or weaken the ten-device limit',async()=>{
 for(const schema of ['legacy','composite'] as const){const f=fixture(schema,undefined,true),rows=await registerPushSubscriptionBatch(f.database,input);assert.deepEqual(rows[1].results,[]);assert.deepEqual(insertPhases(f),schema==='legacy'?['legacy']:['legacy','composite']);}
});
test('transport, unrelated SQLSTATE, planner and ambiguous 42P10 errors are never retried',async()=>{
 for(const error of [Object.assign(new Error('socket closed'),{code:'ECONNRESET'}),Object.assign(missingTarget(),{code:'23505'}),Object.assign(missingTarget(),{routine:'unrelated_routine'}),Object.assign(missingTarget(),{message:'another invalid column reference'}),Object.assign(new Error('there is no unique or exclusion constraint matching the ON CONFLICT specification'),{code:'42P10'})]){
  const f=fixture('legacy',{phase:'legacy',error});await assert.rejects(()=>registerPushSubscriptionBatch(f.database,input),value=>value===error);assert.deepEqual(insertPhases(f),['legacy']);assert.equal(f.queries.at(-1)?.phase,'rollback');assert.equal(f.writes.length,0);
 }
});
test('the same SQLSTATE from lock, cancellation or release never authorizes replay',async()=>{
 for(const phase of ['begin','savepoint','lock','cancel','release'] as const){const error=missingTarget(),f=fixture('legacy',{phase,error});await assert.rejects(()=>registerPushSubscriptionBatch(f.database,input),value=>value===error);assert.equal(f.queries.some(query=>query.phase==='composite'),false);assert.equal(f.writes.length,0);}
});
test('a lost or failed savepoint rollback acknowledgement prevents the fallback',async()=>{
 const error=Object.assign(new Error('rollback acknowledgement lost'),{code:'ECONNRESET'}),f=fixture('composite',{phase:'rollback-to',error});
 await assert.rejects(()=>registerPushSubscriptionBatch(f.database,input),value=>value===error);assert.deepEqual(insertPhases(f),['legacy']);assert.equal(f.queries.some(query=>query.phase==='commit'),false);
});
test('a second missing target is final: compatibility fallback runs at most once',async()=>{
 const error=missingTarget(),f=fixture('composite',{phase:'composite',error});await assert.rejects(()=>registerPushSubscriptionBatch(f.database,input),value=>value===error);assert.deepEqual(insertPhases(f),['legacy','composite']);assert.equal(f.queries.filter(query=>query.phase==='rollback-to').length,1);assert.equal(f.writes.length,0);
});
test('a lost COMMIT response is never replayed, even after the successful schema fallback',async()=>{
 for(const schema of ['legacy','composite'] as const){const error=Object.assign(new Error('COMMIT acknowledgement lost'),{code:'ECONNRESET'}),f=fixture(schema,{phase:'commit',error});await assert.rejects(()=>registerPushSubscriptionBatch(f.database,input),value=>value===error);assert.equal(f.queries.filter(query=>query.phase==='commit').length,1);assert.deepEqual(insertPhases(f),schema==='legacy'?['legacy']:['legacy','composite']);assert.equal(f.writes.filter(query=>query.sql.startsWith('INSERT')).length,1,'A possible committed registration is not duplicated.');}
});
