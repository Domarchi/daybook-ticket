import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import pg from 'pg';
import {readAllTicketPages,readAllConversationPages} from './qa-paged-read.mjs';
const host='ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE,'1');
assert.equal(new URL(process.env.DATABASE_URL).hostname,host);
assert.equal(process.env.DAYBOOK_QA_DATABASE_HOST,host);
assert.equal(process.env.DAYBOOK_SITE_URL,'http://127.0.0.1:5173');
assert.ok(!process.env.RESEND_API_KEY && !process.env.VAPID_PRIVATE_KEY);
const origin=process.env.DAYBOOK_SITE_URL;
let ip=180;
const actor=(email,password)=>({email,password,cookies:{},ip:`192.0.2.${ip++}`});
async function api(person,path,method='GET',body) {
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
const run=randomUUID().slice(0,8),createdMembers=[],createdCompanies=[],createdTickets=[],savedIds=[];
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
 if(!keep){
  for(const id of createdTickets){await pool.query('DELETE FROM "mailDeliveryEvents" WHERE "outboxId" IN (SELECT id FROM "mailOutbox" WHERE "ticketId"=$1)',[id]);await pool.query('DELETE FROM "pushDeliveries" WHERE "eventId" IN (SELECT id FROM "mailOutbox" WHERE "ticketId"=$1)',[id]);await pool.query('DELETE FROM "mailOutbox" WHERE "ticketId"=$1',[id]);for(const table of ['inboundMailReceipts','ticketSatisfaction','escalationOccurrences','reminderOccurrences','ticketSlaOutcomes'])await pool.query(`DELETE FROM "${table}" WHERE "ticketId"=$1`,[id]);await pool.query('DELETE FROM attachments WHERE "ticketId"=$1',[id]);await pool.query('DELETE FROM "ticketEvents" WHERE "ticketId"=$1',[id]);await pool.query('DELETE FROM messages WHERE "ticketId"=$1',[id]);await pool.query('DELETE FROM tickets WHERE id=$1',[id]);}
  for(const id of savedIds)await pool.query('DELETE FROM "savedReplies" WHERE id=$1',[id]);
  for(const id of createdMembers)await pool.query('UPDATE members SET status=\'revoked\' WHERE id=$1',[id]);
 }
 await pool.end();
}
