import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE,'1');
assert.equal(process.env.DAYBOOK_SITE_URL,'http://127.0.0.1:5173');
assert.equal(new URL(process.env.DATABASE_URL).hostname,'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
assert.equal(process.env.DAYBOOK_BLOB_ENV,'qa');
assert.ok(process.env.DAYBOOK_BLOB_QA_READ_WRITE_TOKEN && !process.env.DAYBOOK_BLOB_PRODUCTION_READ_WRITE_TOKEN);
const fixture=JSON.parse(await readFile('work/team-release-qa.json','utf8'));
const {owner}=fixture,origin=fixture.origin;
async function request(person,path,method='GET',body){
 return fetch(origin+path,{method,headers:{origin,'x-vercel-forwarded-for':person.ip,cookie:Object.entries(person.cookies).map(([k,v])=>`${k}=${v}`).join('; '),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
}
async function api(person,path,method='GET',body,expected=200){const response=await request(person,path,method,body);const text=await response.text();let value;try{value=JSON.parse(text);}catch{throw new Error(`${path}: HTTP ${response.status}, non-JSON response (${text.length} bytes)`);}assert.equal(response.status,expected,`${path}: ${value.error||response.status}`);return value;}
const people=[fixture.owner,fixture.client,fixture.peer,fixture.manager,fixture.outsider];
const started=Date.now();
const tickets=await Promise.all(people.map(async(person,index)=>{
 const result=await api(person,'/api/tickets','POST',{operationId:randomUUID(),subject:`QA concurrent pool ${index} ${randomUUID()}`,body:'Solicitud simultánea ficticia para verificar el pool transaccional.',department:'Soporte técnico',priority:'normal',...(person===owner?{requesterMemberId:fixture.client.id}:{})},201);
 return result.ticket;
}));
await Promise.all(people.map((person,index)=>api(person,`/api/tickets/${tickets[index].id}/messages`,'POST',{operationId:randomUUID(),kind:'reply',body:'Respuesta simultánea ficticia para verificar avisos en transacción.'},201)));
assert.equal(new Set(tickets.map(ticket=>ticket.id)).size,5);
console.log(JSON.stringify({result:'PASS',checks:['five-distinct-actors-create-concurrently','five-distinct-actors-reply-concurrently','no-extra-pool-connection-inside-transaction'],elapsedMs:Date.now()-started}));
