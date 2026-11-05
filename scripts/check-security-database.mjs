import {seedQaWorkspaceProfiles} from './qa-workspace-profile.mjs';
/** Coordinator-only, serial QA check. Everything is fictitious and rolled back. No external providers. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { assertSecurityAccess,recordAuthProof,readIdentitySecurity,requireFreshSecurity,saveSecurityPolicy,listOwnSessions,revokeOwnSessions,listSecurityAudit } from '../lib/security.ts';
import { createBusinessExport } from '../lib/business-export.ts';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE,'1');
assert.equal(new URL(process.env.DATABASE_URL).hostname,'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
for(const name of ['RESEND_API_KEY','RESEND_INBOUND_API_KEY','VAPID_PRIVATE_KEY'])assert.ok(!process.env[name]);
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1}),client=await pool.connect();
const run=randomUUID(),ownerId=randomUUID(),org=`qa-security-${run}`,now=new Date().toISOString(),users={},access={};let savepoint=0;
const transactionalClient={query:(sql,values)=>sql==='SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'?Promise.resolve({rows:[],rowCount:0}):client.query(sql,values)};
const database={prepare(sql){return{bind(...values){return{async all(){const r=await client.query(sql,values);return{results:r.rows,meta:{changes:r.rowCount||0}};},async first(){return(await client.query(sql,values)).rows[0]||null;},async run(){const r=await client.query(sql,values);return{results:r.rows,meta:{changes:r.rowCount||0}};}};}};},async transaction(work){const name=`security_${++savepoint}`;await client.query(`SAVEPOINT ${name}`);try{const result=await work(transactionalClient);await client.query(`RELEASE SAVEPOINT ${name}`);return result;}catch(error){await client.query(`ROLLBACK TO SAVEPOINT ${name}`);throw error;}}};
try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  await client.query('INSERT INTO organizations(id,"ownerId",name,"createdAt") VALUES($1,$2,$3,$4)',[org,ownerId,'QA security',now]);
 await seedQaWorkspaceProfiles(client,[ownerId],now);
  for(const role of ['owner','agent','client']){
    const userId=randomUUID(),memberId=randomUUID(),sessionId=randomUUID(),token=`qa-session-${randomUUID()}`;
    users[role]={userId,memberId,sessionId,token};
    await client.query('INSERT INTO "authUser"(id,name,email,"emailVerified","twoFactorEnabled","createdAt","updatedAt") VALUES($1,$2,$3,true,$4,$5,$5)',[userId,`QA ${role}`,`qa-security-${role}-${run}@example.test`,role==='owner',now]);
    await client.query('INSERT INTO "authSession"(id,token,"userId","expiresAt","createdAt","updatedAt","userAgent") VALUES($1,$2,$3,NOW()+interval \'1 day\',$4,$4,$5)',[sessionId,token,userId,now,'Mozilla Linux Chrome/130.0 secret-ua-sentinel']);
    await client.query(`INSERT INTO members(id,"organizationId","ownerId","userId",name,email,role,status,"customerCompanyId","companyAccess","createdAt","updatedAt","isTest") VALUES($1,$2,$3,$4,$5,$6,$7,'active',NULL,'own',$8,$8,$9)`,[memberId,org,ownerId,userId,`QA ${role}`,`qa-security-${role}-${run}@example.test`,role,now,role==='client']);
    access[role]={organizationId:org,ownerId,userId,sessionId,role,member:{id:memberId,name:`QA ${role}`,email:`qa-${role}@example.test`,role,status:'active',hasAccount:true,isTest:role==='client',customerCompanyId:null,companyAccess:'own',createdAt:now,updatedAt:now}};
  }
  const secondary=randomUUID();
  await client.query('INSERT INTO "authSession"(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,NOW()+interval \'1 day\',$4,$4)',[secondary,`qa-second-${randomUUID()}`,users.owner.userId,now]);
  await recordAuthProof(database,users.owner.token,users.owner.userId,'password');
  await recordAuthProof(database,users.owner.token,users.owner.userId,'mfa');
  await client.query('INSERT INTO "securityProfiles"("userId","recoveryAcknowledgedAt","updatedAt") VALUES($1,$2,$2)',[users.owner.userId,now]);
  assert.equal((await readIdentitySecurity(access.owner,client)).policy.requireStaffMfa,false);
  await saveSecurityPolicy(access.owner,{requireStaffMfa:true,version:0},database);
  await assertSecurityAccess(access.owner,client);
  await assert.rejects(()=>assertSecurityAccess(access.agent,client),error=>error.status===428);
  await assertSecurityAccess(access.client,client);
  await assert.rejects(()=>saveSecurityPolicy(access.owner,{requireStaffMfa:false,version:0},database),error=>error.status===409);
  await client.query('UPDATE "authUser" SET "twoFactorEnabled"=true WHERE id=$1',[users.agent.userId]);
  await recordAuthProof(database,users.agent.token,users.agent.userId,'mfa');
  await assertSecurityAccess(access.agent,client);
  await assert.rejects(()=>requireFreshSecurity(access.agent,client),error=>error.status===428);
  await recordAuthProof(database,users.agent.token,users.agent.userId,'password');
  await requireFreshSecurity(access.agent,client);
  const sessions=await listOwnSessions(access.owner,database);assert.equal(sessions.sessions.length,2);assert.ok(!JSON.stringify(sessions).includes('qa-session'));assert.ok(!JSON.stringify(sessions).includes('secret-ua-sentinel'));assert.ok(!JSON.stringify(sessions).includes('userAgent'));
  assert.equal((await revokeOwnSessions(access.owner,{id:users.agent.sessionId},database)).revoked,0);
  assert.equal((await revokeOwnSessions(access.owner,{others:true},database)).revoked,1);
  assert.equal((await client.query('SELECT id FROM "authSession" WHERE id=$1',[users.agent.sessionId])).rows.length,1);
  const audit=await listSecurityAudit(access.owner,null,database);assert.ok(audit.items.some(row=>row.action==='policy_enabled'));assert.ok(!JSON.stringify(audit).includes(users.owner.token));
  for(const verb of ['UPDATE "securityAudit" SET action=\'policy_disabled\'','DELETE FROM "securityAudit"']){
    await client.query('SAVEPOINT immutable');await assert.rejects(()=>client.query(`${verb} WHERE "ownerId"=$1`,[ownerId]),/security_audit_is_append_only/);await client.query('ROLLBACK TO SAVEPOINT immutable');
  }
  await client.query('INSERT INTO settings("ownerId",data) VALUES($1,$2)',[ownerId,JSON.stringify({brandName:'QA business',RESEND_API_KEY:'SECRET_PROVIDER_SENTINEL'})]);
  const exported=await createBusinessExport(access.owner,database,{read:async()=>{throw Error('No files expected');},remove:async()=>{throw Error('No files expected');}});
  assert.equal(exported.format,'daybook.business-export.v1');assert.ok(!JSON.stringify(exported).includes('SECRET_PROVIDER_SENTINEL'));
  for(const forbidden of ['authUser','authAccount','authSession','twoFactor','securityAssurances','securityProfiles','mailOutbox','pushSubscriptions'])assert.ok(!exported.tables.some(table=>table.name===forbidden));
  assert.ok(exported.tables.find(table=>table.name==='members').rows.every(row=>!('userId'in row)));
  await assert.rejects(()=>createBusinessExport(access.client,database),error=>error.status===403);
  await client.query('DELETE FROM "authSession" WHERE id=$1',[users.agent.sessionId]);
  await assert.rejects(()=>assertSecurityAccess(access.agent,client),error=>error.status===401);
  console.log(JSON.stringify({passed:true,groups:9,mfaPolicy:'fictitious fixtures only',businessExportCredentials:false,externalDeliveries:0}));
}finally{await client.query('ROLLBACK');client.release();await pool.end();}
