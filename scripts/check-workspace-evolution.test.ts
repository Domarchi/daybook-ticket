import assert from 'node:assert/strict';
import test from 'node:test';
import type {PoolClient} from 'pg';
import type {Database} from '../db/database';
import {workspaceRequestInput,workspaceStorageKey} from '../lib/workspace-client';
import {workspaceApiPath} from '../lib/workspace-model';
import {DraftOperations} from '../lib/draft-operations';
import {TicketDraftStore,ticketDraftKey} from '../lib/ticket-drafts';
import {readNewTicketDraft,writeNewTicketDraft,readNewTicketOrganization,writeNewTicketOrganization,clearNewTicketDraft} from '../lib/new-ticket-draft';
import {workspaceOperationalInTransaction} from '../lib/workspaces';
import {automationEnabledInTransaction} from '../lib/automation';
import {enqueueServiceContextReminder,isServiceReminderEligibleForDelivery} from '../lib/service-context-reminders';
import {WORKSPACE_ROUTE_REGISTRY} from '../lib/workspace-route-registry';
import {BUSINESS_EXPORT_TABLES,businessExportColumns} from '../lib/business-export';

test('workspace routing also preserves the body, header and explicit destination of URL/Request inputs',async()=>{
 const origin='https://qa.example.test';
 const url=workspaceRequestInput(new URL('/api/tickets?cursor=abc',origin),'alpha',origin);
 assert.equal(String(url),`${origin}/api/workspaces/alpha/tickets?cursor=abc`);
 const original=new Request(`${origin}/api/tickets/4/messages`,{method:'POST',headers:{'Content-Type':'application/json','X-Daybook-Member-Id':'alpha-member'},body:JSON.stringify({body:'Same submission',operationId:'same-operation'})});
 const scoped=workspaceRequestInput(original,'alpha',origin) as Request;
 assert.equal(scoped.url,`${origin}/api/workspaces/alpha/tickets/4/messages`);
 assert.equal(scoped.method,'POST');assert.equal(scoped.headers.get('X-Daybook-Member-Id'),'alpha-member');
 assert.deepEqual(await scoped.json(),{body:'Same submission',operationId:'same-operation'});
 for(const path of ['/api/auth/sign-out','/api/account/security','/api/preferences','/api/preferences?theme=dark','/api/workspaces/beta/tickets'])assert.equal(workspaceApiPath(path,'alpha'),path);
 const external=new URL('/api/tickets','https://other.example.test');assert.equal(workspaceRequestInput(external,'alpha',origin),external);
});

test('two tabs recover independent citations, mentions, custom fields and uncertain operation IDs',()=>{
 const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),oldStorage=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
 const saved=new Map<string,string>(),port={getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>{saved.set(key,value);},removeItem:(key:string)=>{saved.delete(key);}};
 let counter=0;const operations=new DraftOperations(port,()=>`operation-${++counter}`),store=new TicketDraftStore(port,operations),scope={memberId:'one-identity',role:'agent',ticketId:19};
 const fieldId='b86c58ea-4c0d-4cda-9e3b-117457867f00',typeId='db6baf99-9657-48cb-adb6-f62eb036673a';
 const tab=(name:string)=>Object.defineProperty(globalThis,'window',{configurable:true,value:{sessionStorage:port,location:{pathname:`/w/${name}`,origin:'https://qa.example.test'}}});
 try{
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:port});tab('alpha');
  store.edit(scope,'Alpha public reply');store.setReferences(scope,'reply',{replyToMessageId:91});
  const alphaKey=ticketDraftKey(scope),payload={body:'Alpha public reply',kind:'reply',replyToMessageId:91,attachmentIds:['alpha-file']};
  const id=operations.forPayload(`${alphaKey}.reply`,payload);
  writeNewTicketDraft('new-account',{body:'Alpha request',subject:'Alpha'});writeNewTicketOrganization('new-account',{requestTypeId:typeId,fieldValues:{[fieldId]:'Alpha detail'}});
  tab('beta');assert.notEqual(ticketDraftKey(scope),alphaKey);assert.equal(store.read(scope).reply,'');assert.deepEqual(readNewTicketDraft('new-account'),{});assert.deepEqual(readNewTicketOrganization('new-account'),{});
  store.selectKind(scope,'note');store.edit(scope,'Beta internal');store.setReferences(scope,'note',{replyToMessageId:92,mentionMemberIds:['beta-agent']});
  writeNewTicketDraft('new-account',{body:'Beta request'});writeNewTicketOrganization('new-account',{fieldValues:{[fieldId]:true}});
  assert.notEqual(operations.forPayload(`${alphaKey}.reply`,payload),id);
  tab('alpha');const restored=new TicketDraftStore(port,new DraftOperations(port));assert.equal(restored.read(scope).references?.reply?.replyToMessageId,91);
  assert.equal(new DraftOperations(port).forPayload(`${alphaKey}.reply`,{attachmentIds:['alpha-file'],replyToMessageId:91,kind:'reply',body:'Alpha public reply'}),id);
  assert.equal(readNewTicketOrganization('new-account').fieldValues?.[fieldId],'Alpha detail');clearNewTicketDraft('new-account');
  tab('beta');assert.equal(readNewTicketDraft('new-account').body,'Beta request');assert.equal(readNewTicketOrganization('new-account').fieldValues?.[fieldId],true);
  assert.deepEqual(store.read(scope).references?.note,{replyToMessageId:92,mentionMemberIds:['beta-agent']});
  assert.notEqual(workspaceStorageKey('filters','alpha'),workspaceStorageKey('filters','beta'));
 }finally{if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else Reflect.deleteProperty(globalThis,'window');if(oldStorage)Object.defineProperty(globalThis,'sessionStorage',oldStorage);else Reflect.deleteProperty(globalThis,'sessionStorage');}
});

test('suspended/missing businesses do not consume automation or reminder stage keys',async()=>{
 for(const row of [{id:'alpha',state:'suspended'},{id:'alpha',state:'draft'},null]){
  const calls:string[]=[];
  const tx={async query(sql:string){calls.push(sql);if(sql.startsWith('SELECT pg_advisory'))return {rows:[]};if(sql.includes('LEFT JOIN "workspaceProfiles"'))return {rows:row?[row]:[]};throw Error('Paused worker accessed operational data');}} as unknown as PoolClient;
  assert.equal(await workspaceOperationalInTransaction('fixture-owner',tx),false);
  assert.equal(await automationEnabledInTransaction(tx,'fixture-owner'),false);
  const database={transaction:async<T>(callback:(query:PoolClient)=>Promise<T>)=>callback(tx)} as unknown as Database;
  assert.equal(await enqueueServiceContextReminder(database,'fixture-owner','asset','asset-fixture'),0);
  assert.equal(await isServiceReminderEligibleForDelivery(database,{ownerId:'fixture-owner',recipientMemberId:'agent-fixture',serviceReminderId:'reminder-fixture'}),null);
  assert.ok(calls.every(sql=>sql.startsWith('SELECT')));
 }
});

test('new collaboration, organization and automation handlers resolve inside the selected workspace',()=>{
 for(const [path,method,names] of [
  ['tickets/4/messages/search','GET',['id']],['tickets/4/messages/9','GET',['id','messageId']],['tickets/4/files','GET',['id']],['tickets/4/followers','PUT',['id']],
  ['organization/catalog','PATCH',[]],['saved-views/id','DELETE',['id']],['ticket-tasks/id','PATCH',['id']],['tickets/4/organization','PATCH',['id']],
  ['service-context/assets/id/tickets','GET',['id']],['service-context/contracts/id/documents','POST',['id']],['tickets/4/service-context','PUT',['id']],
  ['automation/simulate','POST',[]],['automation/rules/id/versions','GET',['id']],['tickets/4/relations','POST',['id']],['tickets/4/task-templates','POST',['id']],
 ] as const){const route=WORKSPACE_ROUTE_REGISTRY.find(value=>value.pattern.test(path));assert.deepEqual(route?.names,[...names],path);assert.equal(typeof (route?.handlers as Record<string,unknown>)[method],'function',path);}
 assert.equal(WORKSPACE_ROUTE_REGISTRY.some(value=>value.pattern.test('preferences')),false);
});

test('business export includes the new business models while excluding all global identity credentials',()=>{
 for(const table of ['messageMentions','ticketFollowers','ticketOrganization','ticketTasks','savedTicketViews','customerAssets','serviceContracts','ticketAssetLinks','automationRules','automationEvents','automationExecutions','ticketRelations'])assert.ok((BUSINESS_EXPORT_TABLES as readonly string[]).includes(table),table);
 for(const table of ['authUser','authAccount','twoFactor','securityProfiles','userPreferences','authSession','securityAssurances','mailOutbox','pushSubscriptions'])assert.ok(!(BUSINESS_EXPORT_TABLES as readonly string[]).includes(table),table);
 assert.deepEqual(businessExportColumns(['id','userId','secret','backupCodes','name','tokenHash','actorUserId']),['id','name']);
});
