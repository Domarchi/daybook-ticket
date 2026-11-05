import { test } from 'node:test';
import assert from 'node:assert/strict';
import { automationRuleSchema, automationActivationMatches, taskTemplateSchema, firstAutomationRule, ruleMatches, planAutomation, duplicateCompatible, relationPatchSchema, templateApplySchema, type AutomationRule, type AutomationTicket, type TaskTemplate } from '../lib/automation-model';
import { signSimulationProof, verifySimulationProof } from '../lib/automation-proof';
import { createNotificationTickHandler } from '../lib/notification-tick';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',tag='33333333-3333-4333-8333-333333333333',company='44444444-4444-4444-8444-444444444444';
const definition=(changes:Record<string,unknown>={})=>automationRuleSchema.parse({name:'Acceso',actions:{department:'Soporte'},...changes});
const ticket=(changes:Partial<AutomationTicket>={}):AutomationTicket=>({id:1,ownerId:'test-owner',customerCompanyId:company,requesterMemberId:id,department:'General',priority:'normal',status:'open',assigneeMemberId:null,requestTypeId:null,tagIds:[],taskCount:0,version:0,...changes});
const rule=(changes:Partial<AutomationRule>={}):AutomationRule=>({...definition(),id,enabled:true,enabledAt:'2026-11-05T10:00:00.000Z',version:0,archived:false,updatedByMemberId:id,referencesHash:'hash',createdAt:'',updatedAt:'',...changes});
const candidate=(changes:Record<string,unknown>={})=>({id,name:'Agente',role:'agent',status:'active',hasAccount:true,available:true,capacity:20,openTickets:0,lastAssignedAt:null,...changes});
const template:TaskTemplate={id,version:3,archived:false,name:'Diagnóstico',items:[{title:'Revisar acceso',assigneeMemberId:null,dueAfterHours:8}],createdAt:'',updatedAt:''};
test('pause and reactivation cannot replay old events even within the same millisecond',()=>{const stamp='2026-11-05T10:00:00.000Z',settings={enabled:true,version:3,activatedAt:stamp},event={activationVersion:3,createdAt:stamp};assert.equal(automationActivationMatches(settings,event),true);assert.equal(automationActivationMatches(settings,{...event,activationVersion:1}),false);assert.equal(automationActivationMatches({...settings,enabled:false},event),false);assert.equal(automationActivationMatches({...settings,activatedAt:null},event),false);assert.equal(automationActivationMatches(settings,{...event,createdAt:'2026-11-05T09:59:59.999Z'}),false);});
test('rules default disabled, constrain actions and reject executable/public actions',()=>{
  assert.equal(definition().enabled,false);
  for(const actions of [{},{reply:'Respuesta pública'},{eval:'return true'},{status:'resolved'},{dueAt:'2026-11-06'}, {addTagIds:Array.from({length:21},()=>id)}])assert.equal(automationRuleSchema.safeParse({name:'Regla',actions}).success,false);
  assert.equal(automationRuleSchema.safeParse({name:'Regla',actions:{department:'Soporte'},ownerId:'otro'}).success,false);
  assert.equal(taskTemplateSchema.safeParse({name:'Plantilla',items:Array.from({length:11},()=>({title:'Paso'}))}).success,false);
  assert.equal(taskTemplateSchema.safeParse({name:'Plantilla',items:[{title:'Paso',dueAfterHours:0}]}).success,false);
});
test('conditions require event, company, department, priority, status, type and every tag together',()=>{
  const r=definition({conditions:{events:['client_replied'],customerCompanyId:company,departments:['General'],priorities:['urgent'],statuses:['pending'],requestTypeIds:[id],allTagIds:[tag,other]}}),t=ticket({priority:'urgent',status:'pending',requestTypeId:id,tagIds:[other,tag]});
  assert.equal(ruleMatches(r,t,'client_replied'),true);
  for(const changes of [{customerCompanyId:other},{department:'Otro'},{priority:'low' as const},{status:'open' as const},{requestTypeId:null},{tagIds:[tag]}])assert.equal(ruleMatches(r,ticket({...t,...changes}),'client_replied'),false);
  assert.equal(ruleMatches(r,t,'ticket_created'),false);
});
test('only first enabled current rule runs, sorted by order and stable ID',()=>{
  const first=rule({id:other,position:1}),second=rule({id,position:2}),samePosition=rule({id,position:1}),at='2026-11-05T11:00:00.000Z';
  assert.equal(firstAutomationRule([second,first],ticket(),'ticket_created',at)?.id,other);
  assert.equal(firstAutomationRule([first,samePosition],ticket(),'ticket_created',at)?.id,id);
  assert.equal(firstAutomationRule([rule({enabled:false}),rule({archived:true}),rule({enabledAt:'2026-11-05T12:00:00.000Z'})],ticket(),'ticket_created',at),null);
  assert.equal(firstAutomationRule([rule()],ticket(),'ticket_created','2026-11-05T09:59:59.999Z'),null);
});
test('plan removes no tags, adds only missing tags and leaves same department untouched',()=>{
  const r=definition({actions:{addTagIds:[tag,other],department:'General'}}),plan=planAutomation(r,ticket({tagIds:[tag]}),'ticket_created',[],[]);
  assert.deepEqual(plan.addTagIds,[other]);assert.equal(plan.department,null);assert.equal(plan.matches,true);
  assert.deepEqual(planAutomation(r,ticket(),'client_replied',[],[]),{matches:false,addTagIds:[],department:null,assignee:null,assignmentReason:null,tasks:[]});
});
test('automatic assignment preserves any existing owner and resolved tickets',()=>{
  const r=definition({actions:{assignMemberIds:[id,other]}});
  assert.equal(planAutomation(r,ticket({assigneeMemberId:other}),'ticket_created',[candidate()],[]).assignee,null);
  const resolved=definition({conditions:{statuses:[]},actions:{assignMemberIds:[id]}});
  assert.equal(planAutomation(resolved,ticket({status:'resolved'}),'ticket_created',[candidate()],[]).assignee,null);
});
test('assignment excludes inactive, client, unavailable and full agents; selects smallest live load',()=>{
  const r=definition({actions:{assignMemberIds:[id,other]}});
  for(const changes of [{available:false},{capacity:1,openTickets:1},{status:'revoked'},{hasAccount:false},{role:'client'}])assert.equal(planAutomation(r,ticket(),'ticket_created',[candidate(changes)],[]).assignee,null);
  assert.equal(planAutomation(r,ticket(),'ticket_created',[candidate({openTickets:5}),candidate({id:other,openTickets:2})],[]).assignee?.id,other);
  assert.equal(planAutomation(r,ticket(),'ticket_created',[candidate({lastAssignedAt:'2026-11-05T10:00:00Z'}),candidate({id:other,lastAssignedAt:null})],[]).assignee?.id,other);
});
test('task expansion binds versions, rejects missing/archived templates and bounds total ticket work',()=>{
  const r=definition({actions:{taskTemplateIds:[id]}}),plan=planAutomation(r,ticket(),'ticket_created',[],[template]);
  assert.equal(plan.tasks[0].templateVersion,3);assert.equal(plan.tasks[0].dueAfterHours,8);assert.equal(plan.tasks[0].title,'Revisar acceso');
  assert.throws(()=>planAutomation(r,ticket(),'ticket_created',[],[]),/plantilla/);
  assert.throws(()=>planAutomation(r,ticket(),'ticket_created',[],[{...template,archived:true}]),/plantilla/);
  assert.throws(()=>planAutomation(r,ticket({taskCount:1000}),'ticket_created',[],[template]),/límite/);
  assert.throws(()=>planAutomation(definition({actions:{addTagIds:[other]}}),ticket({tagIds:Array.from({length:20},(_,i)=>`tag-${i}`)}),'ticket_created',[],[]),/20 etiquetas/);
});
test('duplicate links require different tickets, same workspace/company and nonempty same requester',()=>{
  const source=ticket(),target=ticket({id:2});assert.equal(duplicateCompatible(source,target),true);
  for(const changes of [{id:1},{ownerId:'otro'},{customerCompanyId:other},{requesterMemberId:other},{requesterMemberId:null}])assert.equal(duplicateCompatible(source,{...target,...changes}),false);
  assert.equal(duplicateCompatible({...source,requesterMemberId:null},{...target,requesterMemberId:null}),false);
  assert.equal(duplicateCompatible({...source,customerCompanyId:null},{...target,customerCompanyId:null}),true);
});
test('relations and manual templates require versioned bounded inputs, rejecting unrelated changes',()=>{
  assert.equal(relationPatchSchema.safeParse({id,expectedVersion:0,archived:true,moveMessages:true}).success,false);
  assert.equal(templateApplySchema.safeParse({operationId:id,templateId:other}).success,false);
  assert.equal(templateApplySchema.safeParse({operationId:id,templateId:other,expectedTemplateVersion:0}).success,true);
});
const proofData={ownerId:'owner-test',memberId:id,ruleHash:'rule-v1',referencesHash:'references-v1'},secret='test-secret-only-'.repeat(4),now=Date.parse('2026-11-05T10:00:00Z');
test('simulation proof is bound to admin, workspace, exact rule and versioned references',()=>{
  const proof=signSimulationProof(proofData,secret,now);assert.equal(verifySimulationProof(proof,proofData,secret,now+1000),true);
  for(const changed of [{ownerId:'other'},{memberId:other},{ruleHash:'rule-v2'},{referencesHash:'references-v2'}])assert.equal(verifySimulationProof(proof,{...proofData,...changed},secret,now),false);
  assert.equal(verifySimulationProof(proof,proofData,secret+'changed',now),false);
});
test('proof rejects tampered, expired, oversized and malformed signatures without throwing',()=>{
  const proof=signSimulationProof(proofData,secret,now);assert.equal(verifySimulationProof(proof,proofData,secret,now+15*60000),false);assert.equal(verifySimulationProof(proof,proofData,secret,now-1),false);
  for(const invalid of [undefined,'',proof+'x','x'+proof,proof+'.extra','x'.repeat(2049),'☃.invalid','e30.'+'A'.repeat(43)])assert.equal(verifySimulationProof(invalid,proofData,secret,now),false);
  assert.throws(()=>signSimulationProof(proofData,'short',now),/unavailable/);
});
test('private tick authenticates and respects disabled default before reaching worker/database',async()=>{
  let called=0;const run=async()=>{called++;return {processed:1};};
  const request=(authorization?:string)=>new Request('https://example.test/api/internal/automation-tick',{method:'POST',headers:{...(authorization?{authorization}:{}),'content-type':'application/json'},body:JSON.stringify({invocationId:'qa-1',scheduledAt:new Date(now).toISOString()})});
  assert.equal((await createNotificationTickHandler({enabled:true,secret,run})(request())).status,401);
  assert.equal((await createNotificationTickHandler({enabled:false,secret,run})(request(`Bearer ${secret}`))).status,503);assert.equal(called,0);
  const result=await createNotificationTickHandler({enabled:true,secret,run})(request(`Bearer ${secret}`));assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'private, no-store');assert.equal(called,1);
});
