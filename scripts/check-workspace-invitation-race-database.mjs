/** Coordinator-only, SERIAL QA. Exact current helpers, cloned fictitious schema,
 * two real transactions. No public writes, deliveries or provider requests. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {acceptInvitation,prepareInvitation} from '../lib/invitations.ts';
import {renewPilotOwnerInvitation} from '../lib/workspaces.ts';
import {acquireTicketWorkLock} from '../lib/work-lock.ts';
import {DEFAULT_PILOT_LIMITS} from '../lib/workspace-model.ts';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE,'1');
const target=new URL(process.env.DATABASE_URL);assert.equal(target.hostname,'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');assert.equal(target.pathname,'/daybook_ticket');
for(const key of ['RESEND_API_KEY','RESEND_INBOUND_API_KEY','VAPID_PRIVATE_KEY'])assert.ok(!process.env[key]);
// These connections retain a private schema across transactions. Use direct QA, not PgBouncer.
target.hostname='ep-falling-water-bbfa4ijl.c-15.us-east-1.aws.neon.tech';target.searchParams.set('sslmode','verify-full');
const pool=new pg.Pool({connectionString:target.href,max:2}),left=await pool.connect(),right=await pool.connect();
const schema=`qa_invitation_${randomUUID().replaceAll('-','')}`,ownerId=`qa-invitation-${randomUUID()}`,workspaceId=randomUUID(),memberId=randomUUID(),userId=randomUUID(),now=new Date().toISOString(),email=`${userId}@example.test`;
assert.match(schema,/^qa_invitation_[a-f0-9]{32}$/);
const tables=['organizations','workspaceProfiles','members','invitations','authUser','mailOutbox'];
async function inventory(){const output={};for(const table of tables)output[table]=Number((await left.query(`SELECT count(*)::int AS n FROM public."${table}"`)).rows[0].n);return output;}
const before=await inventory(),oldFetch=globalThis.fetch,oldSite=process.env.DAYBOOK_SITE_URL;let externalRequests=0,created=false;
globalThis.fetch=async()=>{externalRequests++;throw Error('External request forbidden in invitation QA');};
process.env.DAYBOOK_SITE_URL||='https://qa.example.invalid';
function database(client){return {
 prepare(sql){return{bind(...values){return{sql,values};}};},
 async execute(statement,tx=client){const result=await tx.query(statement.sql,statement.values);return {results:result.rows,meta:{changes:result.rowCount??0}};},
 async transaction(work){await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='150ms'");try{const result=await work(client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}}
};}
try{
 await left.query(`CREATE SCHEMA "${schema}"`);created=true;
 for(const connection of [left,right]){await connection.query(`SET search_path TO "${schema}",public`);assert.equal((await connection.query('SELECT current_schema() AS name')).rows[0].name,schema);}
 for(const table of tables)await left.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
 const sql=await readFile(new URL('../drizzle-postgres/0013_workspaces.sql',import.meta.url),'utf8'),quota=sql.match(/CREATE FUNCTION "daybook_workspace_quota"\(\)[\s\S]+?END; \$\$;/)?.[0];assert.ok(quota);
 await left.query(quota);await left.query('CREATE TRIGGER qa_member_quota BEFORE INSERT OR UPDATE OF status ON members FOR EACH ROW EXECUTE FUNCTION "daybook_workspace_quota"()');
 await left.query('INSERT INTO organizations(id,"ownerId",name,"createdAt") VALUES($1,$2,\'Fictitious invitation race\',$3)',[workspaceId,ownerId,now]);
 await left.query('INSERT INTO "workspaceProfiles"("workspaceId","ownerId",state,"brandName","limitsJson","createdAt","updatedAt") VALUES($1,$2,\'draft\',\'Fictitious invitation race\',$3,$4,$4)',[workspaceId,ownerId,JSON.stringify(DEFAULT_PILOT_LIMITS),now]);
 await left.query('INSERT INTO "authUser"(id,email,name,"emailVerified","createdAt","updatedAt") VALUES($1,$2,\'Fictitious owner\',true,$3,$3)',[userId,email,now]);
 await left.query('INSERT INTO members(id,"ownerId","organizationId",email,name,role,status,"createdAt","updatedAt") VALUES($1,$2,$3,$4,\'Fictitious owner\',\'owner\',\'invited\',$5,$5)',[memberId,ownerId,workspaceId,email,now]);
 const initial=await prepareInvitation(database(left),ownerId,memberId);await database(left).execute(initial.statement);const token=new URL(initial.url).searchParams.get('invite');
 await right.query('BEGIN');await acquireTicketWorkLock(right,ownerId);
 await assert.rejects(()=>acceptInvitation(database(left),token,{userId,email}),error=>error.code==='55P03');
 assert.equal((await left.query('SELECT status FROM members WHERE id=$1',[memberId])).rows[0].status,'invited');
 await right.query('ROLLBACK');
 const renewed=await renewPilotOwnerInvitation(workspaceId,0,database(right)),newToken=new URL(renewed.invitationUrl).searchParams.get('invite');assert.notEqual(newToken,token);
 await assert.rejects(()=>acceptInvitation(database(left),token,{userId,email}),error=>error.status===403);
 const accepted=await acceptInvitation(database(left),newToken,{userId,email});assert.deepEqual(accepted,{workspaceId,accepted:true});assert.deepEqual(await acceptInvitation(database(left),newToken,{userId,email}),accepted);
 assert.equal((await left.query('SELECT count(*)::int AS n FROM members WHERE "userId"=$1',[userId])).rows[0].n,1);
 assert.equal(externalRequests,0);
}finally{
 for(const connection of [left,right]){await connection.query('ROLLBACK').catch(()=>undefined);await connection.query('SET search_path TO public');}
 if(created)await left.query(`DROP SCHEMA "${schema}" CASCADE`);
 assert.deepEqual(await inventory(),before);globalThis.fetch=oldFetch;if(oldSite===undefined)delete process.env.DAYBOOK_SITE_URL;else process.env.DAYBOOK_SITE_URL=oldSite;left.release();right.release();await pool.end();
}
console.log(JSON.stringify({result:'PASS',waitedBeforeMemberLocks:true,renewalInvalidatesPreviousToken:true,sameTokenRetryStable:true,isolatedSchemaRemoved:true,publicInventoryUnchanged:true,externalDeliveries:0}));
