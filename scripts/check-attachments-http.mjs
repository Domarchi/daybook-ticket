import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {put} from '@vercel/blob';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE,'1');
assert.equal(process.env.DAYBOOK_SITE_URL,'http://127.0.0.1:5173');
assert.equal(new URL(process.env.DATABASE_URL).hostname,'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
assert.equal(process.env.DAYBOOK_BLOB_ENV,'qa');
assert.ok(process.env.DAYBOOK_BLOB_QA_READ_WRITE_TOKEN && !process.env.DAYBOOK_BLOB_PRODUCTION_READ_WRITE_TOKEN);
const fixture=JSON.parse(await readFile('work/team-release-qa.json','utf8'));
const {owner,client,manager,outsider}=fixture,origin=fixture.origin;
async function request(person,path,method='GET',body){
 return fetch(origin+path,{method,headers:{origin,'x-vercel-forwarded-for':person.ip,cookie:Object.entries(person.cookies).map(([k,v])=>`${k}=${v}`).join('; '),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
}
async function api(person,path,method='GET',body,expected=200){const response=await request(person,path,method,body);const text=await response.text();let value;try{value=JSON.parse(text);}catch{throw new Error(`${path}: HTTP ${response.status}, non-JSON response (${text.length} bytes)`);}assert.equal(response.status,expected,`${path}: ${value.error||response.status}`);return value;}
async function upload(person,scope,name,text){
 const bytes=Buffer.from(text),reserved=await api(person,'/api/attachments/reserve','POST',{...scope,name,size:bytes.length,contentType:'text/plain'},201);
 const result=await api(person,'/api/attachments/upload','POST',{type:'blob.generate-client-token',payload:{pathname:reserved.pathname,multipart:false,clientPayload:JSON.stringify({attachmentId:reserved.attachment.id})}});
 assert.ok(result.clientToken,'Token endpoint must return scoped client token');
 await put(reserved.pathname,bytes,{access:'private',token:result.clientToken,contentType:'text/plain',addRandomSuffix:false,allowOverwrite:false});
 await api(person,`/api/attachments/${reserved.attachment.id}/complete`,'POST',{});
 return reserved.attachment.id;
}
const draftId=randomUUID(),text='Archivo ficticio QA de Daybook Ticket. Sin datos reales.';
const file=await upload(client,{draftId,kind:'request'},'solicitud-qa.txt',text);
const workspace=await api(client,'/api/workspace');
const payload={operationId:randomUUID(),draftId,attachmentIds:[file],subject:'QA adjunto privado de cliente',body:'Solicitud con un archivo ficticio.',department:workspace.settings.departments[0],priority:'normal'};
const {ticket}=await api(client,'/api/tickets','POST',payload,201);
const replay=await api(client,'/api/tickets','POST',payload,201);assert.equal(replay.ticket.id,ticket.id);
for(const person of [client,owner,manager]){const response=await request(person,`/api/attachments/${file}/download`);assert.equal(response.status,200);assert.ok(response.headers.get('cache-control').includes('no-store'));assert.ok(response.headers.get('content-disposition').startsWith('attachment;'));assert.equal(await response.text(),text);}
await api(outsider,`/api/attachments/${file}/download`,'GET',undefined,404);
const feed=await api(client,'/api/tickets/updates');assert.ok(feed.messages.find(m=>m.ticketId===ticket.id)?.attachments.some(a=>a.id===file));
const noteDraft=randomUUID(),noteFile=await upload(owner,{draftId:noteDraft,kind:'note',ticketId:ticket.id},'nota-interna-qa.txt','Archivo interno ficticio QA.');
await api(owner,`/api/tickets/${ticket.id}/messages`,'POST',{operationId:randomUUID(),draftId:noteDraft,attachmentIds:[noteFile],body:'Nota interna con archivo privado.',kind:'reply'},409);
const note={operationId:randomUUID(),draftId:noteDraft,attachmentIds:[noteFile],body:'Nota interna con archivo privado.',kind:'note'};
const noteSent=await api(owner,`/api/tickets/${ticket.id}/messages`,'POST',note,201);
const noteReplay=await api(owner,`/api/tickets/${ticket.id}/messages`,'POST',note,201);assert.equal(noteSent.message.id,noteReplay.message.id);
for(const person of [client,manager,outsider])await api(person,`/api/attachments/${noteFile}/download`,'GET',undefined,404);
const ownerFile=await request(owner,`/api/attachments/${noteFile}/download`);assert.equal(ownerFile.status,200);await ownerFile.arrayBuffer();
await api(owner,`/api/members/${manager.id}`,'PATCH',{customerCompanyId:fixture.companyB,companyAccess:'manager'});
await api(manager,`/api/attachments/${file}/download`,'GET',undefined,404);
await api(owner,`/api/members/${manager.id}`,'PATCH',{customerCompanyId:fixture.companyA,companyAccess:'manager'});
console.log(JSON.stringify({result:'PASS',realPrivateBlob:true,ticketId:ticket.id,checks:['reserve-token-upload-validate-link-download','request-replay-no-duplicate','client-manager-staff-download','company-isolation','internal-note-attachment-private','note-cannot-be-public','atomic-link-rollback','note-replay-no-duplicate','membership-revocation','no-store-download']}));
