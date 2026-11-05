import test from 'node:test';
import assert from 'node:assert/strict';
import type {Database} from '../db/database';
import {acceptInvitation} from '../lib/invitations';

test('invitation acceptance locks the business before the member/quota and revalidates the exact token',async()=>{
 const queries:string[]=[];let latest=true;
 const database={transaction:async<T>(work:(tx:unknown)=>Promise<T>)=>work({query:async(sql:string)=>{
  queries.push(sql);
  if(sql.startsWith('SELECT "ownerId" FROM invitations'))return {rows:[{ownerId:'fixture-owner'}]};
  if(sql.startsWith('SELECT pg_advisory'))return {rows:[]};
  if(sql.includes('LEFT JOIN "workspaceProfiles"'))return {rows:[{id:'fixture-workspace',state:'draft'}]};
  if(sql.startsWith('SELECT i.*'))return {rows:latest?[{memberId:'fixture-member',ownerId:'fixture-owner',organizationId:'fixture-workspace',email:'invited@example.test',status:'invited',userId:null,acceptedAt:null,expiresAt:'2099-01-01T00:00:00Z'}]:[]};
  if(sql.startsWith('SELECT id FROM "authUser"'))return {rows:[{id:'fixture-user'}]};
  if(sql.startsWith('UPDATE'))return {rows:[]};
  throw Error(`Unexpected query: ${sql}`);
 }})} as unknown as Database;
 const token='a'.repeat(64),identity={userId:'fixture-user',email:'invited@example.test'};
 assert.deepEqual(await acceptInvitation(database,token,identity),{workspaceId:'fixture-workspace',accepted:true});
 const owner=queries.findIndex(sql=>sql.startsWith('SELECT pg_advisory_xact_lock(')),state=queries.findIndex(sql=>sql.startsWith('SELECT pg_advisory_xact_lock_shared(')),member=queries.findIndex(sql=>sql.includes('FOR UPDATE OF i,m')),update=queries.findIndex(sql=>sql.startsWith('UPDATE members'));
 assert.ok(owner>=0&&state>owner&&member>state&&update>member);
 latest=false;queries.length=0;
 await assert.rejects(()=>acceptInvitation(database,token,identity),error=>(error as {status:number}).status===403);
 assert.ok(!queries.some(sql=>sql.startsWith('UPDATE')),'A renewed token is never accepted from the initial unlocked lookup.');
});
