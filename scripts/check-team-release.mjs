import assert from 'node:assert/strict';
import { withQaCleanup } from './qa-cleanup-transaction.mjs';
import {randomUUID} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import pg from 'pg';
import {readAllTicketPages,readAllConversationPages} from './qa-paged-read.mjs';
const host='ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE,'1');
assert.equal(new URL(process.env.DATABASE_URL).hostname,host);
assert.equal(process.env.DAYBOOK_QA_DATABASE_HOST,host);
assert.ok(['http://127.0.0.1:5173','http://127.0.0.1:5175'].includes(process.env.DAYBOOK_SITE_URL));
assert.ok(!process.env.RESEND_API_KEY && !process.env.VAPID_PRIVATE_KEY);
const origin=process.env.DAYBOOK_SITE_URL;
let ip=180;
const actor=(email,password)=>({email,password,cookies:{},ip:`192.0.2.${ip++}`});
async function api(person,path,method='GET',body) {
 if(method==='POST'&&(path==='/api/tickets'||/^\/api\/tickets\/\d+\/messages$/.test(path))&&body?.operationId)operationIds.push(body.operationId);
 const response=await fetch(origin+path,{method,headers:{origin,'x-vercel-forwarded-for':person.ip,cookie:Object.entries(person.cookies).map(([k,v])=>`${k}=${v}`).join('; '),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
 for(const line of response.headers.getSetCookie()){const [kv]=line.split(';');const i=kv.indexOf('=');person.cookies[kv.slice(0,i)]=kv.slice(i+1);}
 const value=await response.json().catch(()=>({}));return {status:response.status,value};
}
function ok(result,status=200){assert.equal(result.status,status,`HTTP ${result.status} expected ${status}: ${result.value.error||''}`);return result.value;}
const owner=actor(process.env.DAYBOOK_QA_OWNER_EMAIL||process.env.DAYBOOK_OWNER_EMAIL,process.env.DAYBOOK_QA_OWNER_PASSWORD||'Local-QA-only!Daybook-2026');
assert.ok(owner.email.endsWith('@example.test'));
ok(await api(owner,'/api/auth/sign-in/email','POST',{email:owner.email,password:owner.password}));
const initial=ok(await api(owner,'/api/workspace'));
assert.equal(initial.mailStatus.configured,false);
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
const run=randomUUID(),createdMembers=[],createdCompanies=[],createdTickets=[],savedIds=[],createdUsers=[],operationIds=[];
const spaceOwnerId=(await pool.query('SELECT "ownerId" FROM members WHERE id=$1',[initial.viewer.id])).rows[0].ownerId;
const keep=process.argv.includes('--keep');
async function createActor(label,role='client',company=null,companyAccess='own'){
 const person=actor(`release-${label}-${run}@example.test`,`Qa-${randomUUID()}!`);
 const result=ok(await api(owner,'/api/members','POST',{name:`QA ${label}`,email:person.email,role,customerCompanyId:company,companyAccess}),201);
 person.id=result.member.id;createdMembers.push(person.id);
 const token=new URL(result.invitationUrl).searchParams.get('invite');
 // Signup requires this invitation header.
 const response=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{origin,'content-type':'application/json','x-vercel-forwarded-for':person.ip,'x-daybook-invite':token},body:JSON.stringify({email:person.email,password:person.password,name:`QA ${label}`})});
 assert.equal(response.status,200);
 for(const line of response.headers.getSetCookie()){const [kv]=line.split(';');const i=kv.indexOf('=');person.cookies[kv.slice(0,i)]=kv.slice(i+1);}
 const registered=await response.json();if(registered.user?.id)createdUsers.push(registered.user.id);
 return person;
}
try{
 const a=ok(await api(owner,'/api/companies','POST',{name:`QA Empresa A ${run}`}),201).company;
 const b=ok(await api(owner,'/api/companies','POST',{name:`QA Empresa B ${run}`}),201).company;
 createdCompanies.push(a.id,b.id);
 const client=await createActor('contacto','client',a.id),peer=await createActor('companero','client',a.id),manager=await createActor('encargado','client',a.id,'manager'),outsider=await createActor('otra-empresa','client',b.id),agent=await createActor('agente','agent');
 const createBody={operationId:randomUUID(),subject:`QA soporte con empresas ${run}`,body:'Necesito ayuda con mi equipo.',department:initial.settings.departments[0],priority:'normal'};
 const simultaneous=await Promise.all([api(client,'/api/tickets','POST',createBody),api(client,'/api/tickets','POST',createBody)]);
 const ticket=ok(simultaneous[0],201).ticket;createdTickets.push(ticket.id);
 assert.equal(ok(simultaneous[1],201).ticket.id,ticket.id,'Duplicate create must return same ticket');
 ok(await api(client,'/api/tickets','POST',{...createBody,subject:'Otro contenido'}),409);
 const count=await pool.query('SELECT count(*)::int AS n FROM tickets WHERE "creationKey"=$1',[createBody.operationId]);assert.equal(count.rows[0].n,1);
 const feed=async person=>{const result=ok(await api(person,'/api/tickets/updates'));assert.ok(result.tickets.length<=50);assert.deepEqual(result.messages,[]);return {...result,tickets:await readAllTicketPages(async path=>ok(await api(person,path)))};};
 assert.ok((await feed(manager)).tickets.some(t=>t.id===ticket.id));
 for(const person of [peer,outsider])assert.ok(!(await feed(person)).tickets.some(t=>t.id===ticket.id));
 ok(await api(peer,`/api/tickets/${ticket.id}/messages`,'POST',{operationId:randomUUID(),body:'Prohibido',kind:'reply'}),404);
 ok(await api(manager,`/api/tickets/${ticket.id}/messages`,'POST',{operationId:randomUUID(),body:'Nota prohibida',kind:'note'}),403);
 ok(await api(manager,'/api/saved-replies'),403);ok(await api(agent,'/api/companies','POST',{name:'Prohibida'}),403);
 const claims=await Promise.all([api(owner,`/api/tickets/${ticket.id}/claim`,'POST',{expectedVersion:ticket.version}),api(agent,`/api/tickets/${ticket.id}/claim`,'POST',{expectedVersion:ticket.version})]);
 assert.deepEqual(claims.map(r=>r.status).sort(),[200,409]);
 const current=(await feed(owner)).tickets.find(t=>t.id===ticket.id);
 ok(await api(owner,`/api/tickets/${ticket.id}`,'PATCH',{assigneeMemberId:agent.id,expectedVersion:ticket.version}),409);
 ok(await api(owner,`/api/tickets/${ticket.id}`,'PATCH',{assigneeMemberId:agent.id,expectedVersion:current.version}));
 const saved=ok(await api(owner,'/api/saved-replies','POST',{title:'Confirmación QA',category:'Soporte',body:'Recibimos tu solicitud y estamos revisándola.'}),201).savedReply;savedIds.push(saved.id);
 assert.ok(ok(await api(agent,'/api/saved-replies')).savedReplies.some(r=>r.id===saved.id));
 ok(await api(agent,`/api/saved-replies/${saved.id}`,'DELETE'),403);
 const body={operationId:randomUUID(),body:'Comentario del encargado',kind:'reply'};
 const replies=await Promise.all([api(manager,`/api/tickets/${ticket.id}/messages`,'POST',body),api(manager,`/api/tickets/${ticket.id}/messages`,'POST',body)]);
 assert.equal(ok(replies[0],201).message.id,ok(replies[1],201).message.id);
 ok(await api(manager,`/api/tickets/${ticket.id}/messages`,'POST',{...body,body:'Distinto'}),409);
 ok(await api(owner,`/api/tickets/${ticket.id}/messages`,'POST',{operationId:randomUUID(),body:'Solo equipo QA',kind:'note'}),201);
 ok(await api(agent,`/api/tickets/${ticket.id}/messages`,'POST',{operationId:randomUUID(),body:'Respuesta pública QA',kind:'reply'}),201);
 const managerMessages=await readAllConversationPages(async path=>ok(await api(manager,path)),ticket.id);
 assert.ok(managerMessages.some(m=>m.body==='Respuesta pública QA'));
 assert.ok(!managerMessages.some(m=>m.kind==='note'||m.body==='Solo equipo QA'));
 assert.ok((await feed(client)).alerts.some(n=>n.ticketId===ticket.id&&n.event==='agent_replied'));
 assert.ok((await feed(manager)).alerts.some(n=>n.ticketId===ticket.id&&n.event==='agent_replied'));
 const events=ok(await api(owner,`/api/tickets/${ticket.id}/events`)).events;
 assert.ok(events.some(e=>e.action==='assigneeMemberId'));
 ok(await api(manager,`/api/tickets/${ticket.id}/events`),403);
 ok(await api(owner,`/api/members/${manager.id}`,'PATCH',{customerCompanyId:b.id,companyAccess:'manager'}));
 assert.ok(!(await feed(manager)).tickets.some(t=>t.id===ticket.id));
 assert.ok(!(await feed(manager)).alerts.some(t=>t.ticketId===ticket.id));
 ok(await api(manager,`/api/tickets/${ticket.id}/messages`,'POST',{operationId:randomUUID(),body:'Acceso retirado',kind:'reply'}),404);
 ok(await api(owner,`/api/members/${manager.id}`,'PATCH',{customerCompanyId:a.id,companyAccess:'manager'}));
 if(keep){await mkdir('work',{recursive:true});await writeFile('work/team-release-qa.json',JSON.stringify({origin,owner,client,peer,manager,outsider,agent,ticketId:ticket.id,companyA:a.id,companyB:b.id},null,2),{mode:0o600});}
 console.log(JSON.stringify({result:'PASS',groups:['company-isolation','manager-comment','private-notes','admin-boundaries','concurrent-claim','stale-reassignment','saved-replies','concurrent-operation-idempotency','recipient-alerts','history','membership-revocation'],fixtureRetained:keep}));
}finally{
 try{
  if(!keep){
   await withQaCleanup(pool, spaceOwnerId, async cleanup => {
   const recovered=(await cleanup.query('SELECT id,"userId" FROM members WHERE "ownerId"=$1 AND email LIKE $2',[spaceOwnerId,`release-%-${run}@example.test`])).rows;
   for(const row of recovered){if(!createdMembers.includes(row.id))createdMembers.push(row.id);if(row.userId&&!createdUsers.includes(row.userId))createdUsers.push(row.userId);}
   const recoveredTickets=(await cleanup.query('SELECT id FROM tickets WHERE "ownerId"=$1 AND subject=$2',[spaceOwnerId,`QA soporte con empresas ${run}`])).rows;
   for(const row of recoveredTickets)if(!createdTickets.includes(row.id))createdTickets.push(row.id);
   const recoveredCompanies=(await cleanup.query('SELECT id FROM "customerCompanies" WHERE "ownerId"=$1 AND name=ANY($2::text[])',[spaceOwnerId,[`QA Empresa A ${run}`,`QA Empresa B ${run}`]])).rows;
   for(const row of recoveredCompanies)if(!createdCompanies.includes(row.id))createdCompanies.push(row.id);
   const mailScope='SELECT id FROM "mailOutbox" WHERE "ownerId"=$1 AND ("ticketId"=ANY($2::int[]) OR "recipientMemberId"=ANY($3::text[]))';
   const values=[spaceOwnerId,createdTickets,createdMembers];
   await cleanup.query(`DELETE FROM "mailDeliveryEvents" WHERE "outboxId" IN (${mailScope})`,values);
   await cleanup.query(`DELETE FROM "pushDeliveries" WHERE "eventId" IN (${mailScope})`,values);
   await cleanup.query('DELETE FROM "mailOutbox" WHERE "ownerId"=$1 AND ("ticketId"=ANY($2::int[]) OR "recipientMemberId"=ANY($3::text[]))',values);
   for(const table of ['inboundMailReceipts','ticketSatisfaction','escalationOccurrences','reminderOccurrences','ticketSlaOutcomes','attachments','ticketEvents','messages'])await cleanup.query(`DELETE FROM "${table}" WHERE "ownerId"=$1 AND "ticketId"=ANY($2::int[])`,[spaceOwnerId,createdTickets]);
   await cleanup.query('DELETE FROM operations WHERE "ownerId"=$1 AND ("operationId"=ANY($2::text[]) OR "memberId"=ANY($3::text[]))',[spaceOwnerId,operationIds,createdMembers]);
   await cleanup.query('DELETE FROM tickets WHERE "ownerId"=$1 AND id=ANY($2::int[])',[spaceOwnerId,createdTickets]);
   for(const id of savedIds)await cleanup.query('DELETE FROM "savedReplies" WHERE id=$1 AND "ownerId"=$2',[id,spaceOwnerId]);
   await cleanup.query('DELETE FROM "pushSubscriptions" WHERE "ownerId"=$1 AND "memberId"=ANY($2::text[])',[spaceOwnerId,createdMembers]);
   await cleanup.query('DELETE FROM "agentAvailability" WHERE "ownerId"=$1 AND "memberId"=ANY($2::text[])',[spaceOwnerId,createdMembers]);
   await cleanup.query('DELETE FROM invitations WHERE "ownerId"=$1 AND "memberId"=ANY($2::text[])',[spaceOwnerId,createdMembers]);
   await cleanup.query('DELETE FROM members WHERE "ownerId"=$1 AND id=ANY($2::text[])',[spaceOwnerId,createdMembers]);
   await cleanup.query('DELETE FROM "servicePolicies" WHERE "ownerId"=$1 AND "customerCompanyId"=ANY($2::text[])',[spaceOwnerId,createdCompanies]);
   await cleanup.query('DELETE FROM "assignmentRules" WHERE "ownerId"=$1 AND "customerCompanyId"=ANY($2::text[])',[spaceOwnerId,createdCompanies]);
   await cleanup.query('DELETE FROM "customerCompanies" WHERE "ownerId"=$1 AND id=ANY($2::text[])',[spaceOwnerId,createdCompanies]);
   await cleanup.query('DELETE FROM "authUser" WHERE id=ANY($1::text[]) OR email LIKE $2',[createdUsers,`release-%-${run}@example.test`]);
   const remaining=(await cleanup.query('SELECT (SELECT count(*)::int FROM members WHERE id=ANY($1::text[])) AS members,(SELECT count(*)::int FROM "authUser" WHERE id=ANY($2::text[]) OR email LIKE $3) AS users,(SELECT count(*)::int FROM tickets WHERE id=ANY($4::int[])) AS tickets,(SELECT count(*)::int FROM "customerCompanies" WHERE id=ANY($5::text[])) AS companies',[createdMembers,createdUsers,`release-%-${run}@example.test`,createdTickets,createdCompanies])).rows[0];
   assert.ok(Object.values(remaining).every(value=>value===0),'All team release fixture records must be removed.');
   });
   ok(await api(owner,'/api/auth/sign-out','POST',{}));
   console.log('QA team release cleanup PASS: all generated accounts, memberships, tickets, companies, saved replies, operations and own test session removed.');
  }
 }finally{await pool.end();}
}
