import assert from 'node:assert/strict';
import test from 'node:test';
import { assetSchema, calendarDate, contractSchema, profileSchema, serviceDueStage, santiagoDate, ticketContextSchema } from '../lib/service-context-model';
import { attachmentScopeSchema, reserveAttachmentSchema } from '../lib/attachments';
import { buildMailPayload, readFrozenMailPayload } from '../lib/mail-templates';
import { notificationStatements } from '../lib/mail';
import { BACKUP_TABLES, LEGACY_BACKUP_TABLES, RELIABILITY_BACKUP_TABLES, canonicalBackupRows, sha256, validateBackup } from '../lib/backup-format';
import type { Database } from '../db/database';
const company='11111111-1111-4111-8111-111111111111',contract='22222222-2222-4222-8222-222222222222',draft='33333333-3333-4333-8333-333333333333';
test('calendar dates validate real leap years, not shape alone',()=>{
 assert.ok(calendarDate.safeParse('2028-02-29').success);assert.ok(!calendarDate.safeParse('2027-02-29').success);assert.ok(!calendarDate.safeParse('2026-13-01').success);assert.ok(!calendarDate.safeParse('2026-02-30').success);
});
test('contracts keep explicit company and dates and reject invalid service references',()=>{
 const base={companyId:company,name:'QA contrato',startsOn:'2026-01-01',endsOn:'2026-12-31'};
 assert.deepEqual(contractSchema.parse(base).serviceIds,[]);
 assert.ok(!contractSchema.safeParse({...base,endsOn:'2025-12-31'}).success);assert.ok(!contractSchema.safeParse({...base,renewalOn:'2025-12-31'}).success);
 assert.ok(!contractSchema.safeParse({...base,serviceIds:[contract,contract]}).success);assert.ok(!contractSchema.safeParse({...base,price:123}).success);
});
test('private context rejects credential-bearing website URLs and excess fields',()=>{
 assert.ok(profileSchema.safeParse({companyId:company,website:'https://example.test/support'}).success);
 for(const website of ['http://example.test','https://user:password@example.test','javascript:alert(1)'])assert.ok(!profileSchema.safeParse({companyId:company,website}).success);
 assert.ok(!assetSchema.safeParse({companyId:company,name:'Equipo',warrantyUntil:'2026-02-30'}).success);
 assert.ok(!assetSchema.safeParse({companyId:company,name:'Equipo',password:'do-not-store'}).success);
});
test('reminders use Santiago calendar stages and recover only the currently applicable stage',()=>{
 const due='2026-12-31',baseline='2026-10-01T12:00:00Z';
 assert.equal(serviceDueStage(due,baseline,baseline,new Date('2026-11-30T15:00:00Z')),null);
 assert.equal(serviceDueStage(due,baseline,baseline,new Date('2026-12-01T15:00:00Z')),30);
 assert.equal(serviceDueStage(due,baseline,baseline,new Date('2026-12-20T15:00:00Z')),30);
 assert.equal(serviceDueStage(due,baseline,baseline,new Date('2026-12-24T15:00:00Z')),7);
 assert.equal(serviceDueStage(due,baseline,baseline,new Date('2026-12-31T15:00:00Z')),0);
 assert.equal(santiagoDate(new Date('2026-12-31T02:30:00Z')),'2026-12-30');
 assert.equal(serviceDueStage(due,baseline,baseline,new Date('2026-12-31T02:30:00Z')),7);
});
test('importing, changing dates or enabling reminders never creates prior stages',()=>{
 const due='2026-12-31';
 assert.equal(serviceDueStage(due,'2026-12-26T15:00:00Z','2026-10-01T12:00:00Z',new Date('2026-12-27T15:00:00Z')),null);
 assert.equal(serviceDueStage(due,'2026-10-01T12:00:00Z','2026-12-26T15:00:00Z',new Date('2026-12-27T15:00:00Z')),null);
 assert.equal(serviceDueStage(due,'2026-12-26T15:00:00Z','2026-12-26T15:00:00Z',new Date('2026-12-31T15:00:00Z')),0);
 assert.equal(serviceDueStage('2026-02-30','bad','bad',new Date()),null);
});
test('contract uploads have an explicit exclusive destination and retain existing file limits',()=>{
 assert.ok(attachmentScopeSchema.safeParse({draftId:draft,kind:'contract',contractId:contract}).success);
 for(const value of [{draftId:draft,kind:'contract'},{draftId:draft,kind:'contract',contractId:contract,ticketId:1},{draftId:draft,kind:'reply',contractId:contract,ticketId:1},{draftId:draft,kind:'request',contractId:contract}])assert.ok(!attachmentScopeSchema.safeParse(value).success);
 assert.ok(attachmentScopeSchema.safeParse({draftId:draft,kind:'note',ticketId:1}).success);
 assert.ok(!reserveAttachmentSchema.safeParse({draftId:draft,kind:'contract',contractId:contract,name:'a.pdf',contentType:'application/pdf',size:10*1024*1024+1}).success);
 assert.ok(!ticketContextSchema.safeParse({expectedVersion:0,assetIds:[company,company],contractIds:[]}).success);
});
test('service due mail only contains a private portal link and retains frozen legacy payloads',()=>{
 const payload=buildMailPayload({id:contract,environment:'qa',event:'service_due',ticketId:null,from:'Daybook <tickets@example.test>',to:'agent@example.test',url:'https://example.test/?serviceContext=1',metadata:{subject:'INTERNAL CONTRACT NOTES',status:'open',priority:'urgent',dueAt:'2026-12-31'}});
 assert.ok(payload.html?.includes('cid:'));assert.ok(payload.text.includes('https://example.test/?serviceContext=1'));assert.ok(!JSON.stringify(payload).includes('INTERNAL CONTRACT NOTES'));assert.ok(!payload.text.includes('Abierto'));
 const old='{"from":"legacy@example.test","to":["old@example.test"],"subject":"old immutable","text":"frozen"}';assert.deepEqual(readFrozenMailPayload(old),JSON.parse(old));
});
test('service outbox stage keys are recipient scoped and include the occurrence reference',()=>{
 const prepared:{sql:string;values:unknown[]}[]=[];
 const database={prepare:(sql:string)=>({bind:(...values:unknown[])=>{const value={sql,values};prepared.push(value);return value;}})} as unknown as Database;
 const statements=notificationStatements(database,{ownerId:'qa-owner',event:'service_due',eventKey:'asset:id:2026-12-31:7',recipientMemberId:company,serviceReminderId:contract,actionUrl:'https://example.test/?serviceContext=1'});
 assert.equal(statements.length,1);assert.ok(prepared[0].sql.includes('"serviceReminderId"'));assert.ok(prepared[0].values.includes(contract));assert.ok(prepared[0].values.includes(`service_due:asset:id:2026-12-31:7:${company}`));
 const positions=[...prepared[0].sql.matchAll(/\$(\d+)/g)].map(match=>Number(match[1]));assert.equal(Math.max(...positions),prepared[0].values.length);
});

test('new private context is restored before file/outbox references and old v1 manifests remain valid',()=>{
 assert.ok(BACKUP_TABLES.indexOf('serviceContracts')<BACKUP_TABLES.indexOf('attachments'));
 assert.ok(BACKUP_TABLES.indexOf('serviceContextReminders')<BACKUP_TABLES.indexOf('mailOutbox'));
 for(const names of [LEGACY_BACKUP_TABLES,RELIABILITY_BACKUP_TABLES,BACKUP_TABLES]) {
  const manifest={format:'daybook.workspace.v1',createdAt:'2026-11-05T12:00:00Z',ownerId:'qa',organizationId:'qa',tables:names.map(name=>({name,columns:[],rows:[],sha256:sha256(canonicalBackupRows([]))})),files:[],omissions:[]};
  assert.equal(validateBackup(manifest).tables.length,names.length);
  if(names===LEGACY_BACKUP_TABLES){const mixed=structuredClone(manifest);mixed.tables[0].name='companyProfiles' as typeof mixed.tables[number]['name'];assert.throws(()=>validateBackup(mixed),/missing required/);}
 }
});
