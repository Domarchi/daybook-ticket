import { sessionRevocationSchema } from '../lib/security-model';
import assert from 'node:assert/strict';
import test from 'node:test';
import { workspaceApiPath,isWorkspaceSetupPath,workspaceHome,workspaceIdFromPath,operatorGranted,verifiedWorkspaceSender,DEFAULT_PILOT_LIMITS,limitsSchema,parsePilotCapacity,fitsPilotCapacity } from '../lib/workspace-model';
import { safeTicketReturnPath } from '../lib/return-path';
import { WORKSPACE_ROUTE_REGISTRY } from '../lib/workspace-route-registry';
import { TicketDraftStore,ticketDraftKey } from '../lib/ticket-drafts';
import { workspaceStorageKey } from '../lib/workspace-client';
import { buildMailPayload } from '../lib/mail-templates';
test('explicit workspace URLs select scope while old links retain only Daybook',()=>{
 assert.equal(workspaceIdFromPath('/api/workspaces/alpha/tickets/123'),'alpha');assert.equal(workspaceIdFromPath('/w/beta?ticket=2'),'beta');
 assert.equal(workspaceIdFromPath('/api/tickets/123?workspaceId=beta'),'daybook');assert.equal(workspaceIdFromPath('/'),'daybook');
 for(const path of ['/w/%2F/tickets','/api/workspaces/a%2fb/tickets','/w/a.b'])assert.throws(()=>workspaceIdFromPath(path));
 assert.equal(workspaceApiPath('/api/tickets/3?limit=20','alpha'),'/api/workspaces/alpha/tickets/3?limit=20');
 assert.equal(workspaceApiPath('/api/attachments/upload','alpha'),'/api/workspaces/alpha/attachments/upload');
 assert.equal(workspaceApiPath('/api/tickets/3','daybook'),'/api/tickets/3');
 for(const path of ['/api/auth/sign-out','/api/account/security','/api/operator/workspaces','/api/workspaces/invitations/accept'])assert.equal(workspaceApiPath(path,'alpha'),path);
});
test('ticket and sign-in return links preserve their business and reject arbitrary destinations',()=>{
 assert.equal(workspaceHome('alpha',123),'/w/alpha?ticket=123');assert.equal(workspaceHome('daybook',123),'/?ticket=123');
 assert.equal(safeTicketReturnPath('/w/alpha?ticket=123'),'/w/alpha?ticket=123');assert.equal(safeTicketReturnPath('/workspaces'),'/workspaces');
 for(const value of ['//outside.test','https://outside.test/w/a','/w/a/../../operator','/w/a?ticket=1&redirect=https://outside.test','/w/%2f?ticket=2'])assert.equal(safeTicketReturnPath(value),'/');
});
test('opaque session identifiers remain manageable without requiring a UUID',()=>{assert.equal(sessionRevocationSchema.safeParse({id:'opaque-BetterAuth-session-id'}).success,true);assert.equal(sessionRevocationSchema.safeParse({id:''}).success,false);assert.equal(sessionRevocationSchema.safeParse({others:true,id:'mixed'}).success,false);});
test('operator privilege is explicit and does not derive from a workspace owner role',()=>{
 assert.equal(operatorGranted({userId:'owner-a',email:'a@example.test'},{}),false);
 assert.equal(operatorGranted({userId:'operator-a',email:'a@example.test'},{DAYBOOK_PLATFORM_OPERATOR_USER_IDS:'operator-a,operator-b'}),true);
 assert.equal(operatorGranted({userId:'other',email:'ADMIN@EXAMPLE.TEST'},{DAYBOOK_PLATFORM_OPERATOR_EMAILS:' admin@example.test '}),false);
 assert.equal(operatorGranted({userId:'owner-a',email:'a@example.test'},{DAYBOOK_PLATFORM_OPERATOR_USER_IDS:'not-owner-a'}),false);
});
test('sender verification is per business and cannot be self asserted or borrowed',()=>{
 const sender='Empresa A <soporte@example.test>',config={DAYBOOK_VERIFIED_WORKSPACE_SENDERS_JSON:JSON.stringify({alpha:sender})};
 assert.equal(verifiedWorkspaceSender('alpha',sender,config),true);assert.equal(verifiedWorkspaceSender('beta',sender,config),false);
 assert.equal(verifiedWorkspaceSender('alpha','other@example.test',config),false);assert.equal(verifiedWorkspaceSender('alpha',sender+'\r\nBcc: x@example.test',config),false);
 assert.equal(verifiedWorkspaceSender('alpha',sender,{DAYBOOK_VERIFIED_WORKSPACE_SENDERS_JSON:'bad'}),false);
});
test('pilot activation has explicit bounded capacities without purchasing infrastructure',()=>{
 assert.equal(parsePilotCapacity({}),null);assert.equal(limitsSchema.safeParse({...DEFAULT_PILOT_LIMITS,mailMonthly:0}).success,false);
 const capacity={...DEFAULT_PILOT_LIMITS,maxActiveWorkspaces:2};
 assert.equal(fitsPilotCapacity([{...DEFAULT_PILOT_LIMITS}],capacity),true);
 assert.equal(fitsPilotCapacity([{...DEFAULT_PILOT_LIMITS},{...DEFAULT_PILOT_LIMITS}],capacity),false);
 assert.equal(parsePilotCapacity({DAYBOOK_PILOT_CAPACITY_JSON:JSON.stringify({...capacity,maxActiveWorkspaces:11})}),null);
});
test('the same account can keep two tabs with independent reply drafts and private-note recovery',()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'window'),storage=new Map<string,string>(),port={getItem:(key:string)=>storage.get(key)||null,setItem:(key:string,value:string)=>{storage.set(key,value);},removeItem:(key:string)=>{storage.delete(key);}};
 const scope={memberId:'same-identity-fixture',role:'agent',ticketId:5},store=new TicketDraftStore(port);
 try{
  Object.defineProperty(globalThis,'window',{value:{location:{pathname:'/w/alpha'}},configurable:true});
  const alpha=ticketDraftKey(scope);store.edit(scope,'Alpha private working copy');
  Object.defineProperty(globalThis,'window',{value:{location:{pathname:'/w/beta'}},configurable:true});
  assert.notEqual(ticketDraftKey(scope),alpha);assert.equal(store.read(scope).reply,'');store.edit(scope,'Beta working copy');
  Object.defineProperty(globalThis,'window',{value:{location:{pathname:'/w/alpha'}},configurable:true});assert.equal(store.read(scope).reply,'Alpha private working copy');
  assert.notEqual(workspaceStorageKey('filters','alpha'),workspaceStorageKey('filters','beta'));assert.equal(workspaceStorageKey('old-key','daybook'),'old-key');
 }finally{if(descriptor)Object.defineProperty(globalThis,'window',descriptor);else Reflect.deleteProperty(globalThis,'window');}
});
test('scoped registry admits domain handlers but excludes global identity, providers and privileged workers',()=>{
 const admits=(path:string)=>WORKSPACE_ROUTE_REGISTRY.some(item=>item.pattern.test(path));
 for(const path of ['tickets','tickets/1/messages','tickets/1/conversation','attachments/id/download','members','alerts','security','security/sessions','security/export','evolution/features'])assert.equal(admits(path),true,path);
 for(const path of ['auth/sign-in/email','account/security','operator/workspaces','internal/notification-tick','webhooks/resend','setup','backups','backups/schedule','demo'])assert.equal(admits(path),false,path);
});
test('business mail uses an escaped label and an explicit portal link with the shared Daybook CID asset',()=>{
 const payload=buildMailPayload({id:'fixture-id',environment:'qa',event:'ticket_created',ticketId:7,from:'support@example.test',to:'client@example.test',url:'https://portal.example.test/w/alpha?ticket=7',brandName:'Empresa <script>unsafe</script>'});
 assert.ok(payload.html?.includes('Empresa &lt;script&gt;unsafe&lt;/script&gt;'));assert.ok(!payload.html?.includes('<script>unsafe'));
 assert.ok(payload.text.includes('/w/alpha?ticket=7'));assert.ok(payload.attachments?.[0].content_id);assert.ok(payload.subject.includes('Empresa'));
});

test('draft setup never admits domain exports, conversations, audit or provider health',()=>{
 for(const path of ['security','security/policy','security/sessions','administration','evolution/features'])assert.equal(isWorkspaceSetupPath(`/api/workspaces/alpha/${path}`),true,path);
 for(const path of ['workspace','tickets','security/export','security/audit','security/health','security/policy/extra','evolution/features/extra'])assert.equal(isWorkspaceSetupPath(`/api/workspaces/alpha/${path}`),false,path);
});
