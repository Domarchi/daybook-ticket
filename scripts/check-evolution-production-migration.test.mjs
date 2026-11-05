import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile,mkdtemp,mkdir,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
 MigrationOperatorError,EVOLUTION_PINNED_MIGRATIONS,REVIEWED_EVOLUTION_MIGRATIONS,evolutionConfirmTarget,
 validateEvolutionCliArguments,validateEvolutionProductionTargets,loadEvolutionMigrationArtifacts,
 validateEvolutionMigrationJournal,analyzeEvolutionSql,freezeEvolutionArtifacts,runEvolutionMigrationOperator,evolutionFailureReport,
} from './migrate-evolution-production.mjs';

const through='0007',hash=value=>createHash('sha256').update(value).digest('hex'),clone=value=>structuredClone(value),compare=(a,b)=>a<b?-1:a>b?1:0;
const environment={DATABASE_URL:'postgresql://fictional_user:fictional_password@ep-dawn-moon-bbwpjcrp-pooler.c-15.us-east-1.aws.neon.tech/daybook_ticket?sslmode=require',DIRECT_DATABASE_URL:'postgresql://fictional_user:fictional_password@ep-dawn-moon-bbwpjcrp.c-15.us-east-1.aws.neon.tech/daybook_ticket?sslmode=require&channel_binding=require',DAYBOOK_PRODUCTION_MIGRATION_CONFIRM_TARGET:evolutionConfirmTarget(through),DAYBOOK_PRODUCTION_MIGRATION_ALLOW_APPLY:`evolution-through-${through}`};
const expectedJournal=EVOLUTION_PINNED_MIGRATIONS.slice(0,8).map((entry,i)=>({id:i+1,hash:entry.hash,created_at:String(entry.when)}));
const column=(table,name,position,type='text',notNull=true,defaultValue=null)=>({table_name:table,column_name:name,position,data_type:type,not_null:notNull,column_default:defaultValue,identity:'',generated:'',collation:type==='text'?'100':'0'});

/** Exercises the ACTUAL installed Drizzle migrator on a transactional fake client. It does not validate PostgreSQL syntax. */
class FixtureClient {
 constructor(options={}){
  this.options=options;this.queries=[];this.commits=0;this.rollbacks=0;
  const fixture=(name,fields,rows)=>({columns:fields.map((field,i)=>column(name,field,i+1,['id'].includes(field)&&['tickets','messages'].includes(name)?'integer':'text')),rows});
  this.state={constraints:[{table_name:'attachments',constraint_name:'attachments_kind',type:'c',validated:true,deferrable:false,deferred:false,definition:"CHECK (kind = ANY (ARRAY['request'::text,'reply'::text,'note'::text]))"}],journal:clone(expectedJournal.slice(0,7)),indexes:[{indexname:'push_subscription_endpoint',tablename:'pushSubscriptions',indexdef:'CREATE UNIQUE INDEX push_subscription_endpoint ON public."pushSubscriptions" USING btree (endpoint)'}],tables:{
   organizations:fixture('organizations',['id','ownerId'],[{id:'fictional-org',ownerId:'fictional-owner'}]),
   authUser:fixture('authUser',['id','email'],[{id:'fictional-user',email:'PRIVATE_FICTIONAL_EMAIL'}]),
   authAccount:fixture('authAccount',['id','password'],[{id:'fictional-account',password:'PRIVATE_FICTIONAL_PASSWORD_HASH'}]),
   authSession:fixture('authSession',['id','token'],[{id:'fictional-session',token:'PRIVATE_FICTIONAL_SESSION_TOKEN'}]),
   members:fixture('members',['id','role','status'],[{id:'fictional-owner',role:'owner',status:'active'}]),
   settings:fixture('settings',['ownerId','data'],[{ownerId:'fictional-owner',data:'{"remindersEnabled":true,"automationEnabled":true,"requireStaffMfa":true}'}]),
   tickets:fixture('tickets',['id','subject','dueAt'],[{id:6,subject:'PRIVATE_FICTIONAL_SUBJECT',dueAt:'2026-11-05T15:00:00.000Z'}]),
   messages:fixture('messages',['id','body','kind'],[{id:1,body:'PRIVATE_FICTIONAL_CONVERSATION ** literal text **',kind:'reply'}]),
   mailOutbox:fixture('mailOutbox',['id','payloadJson','status'],[{id:'fictional-mail',payloadJson:'{"text":"PRIVATE_FICTIONAL_FROZEN_MAIL"}',status:'queued'}]),
   attachments:fixture('attachments',['id','pathname'],[{id:'fictional-file',pathname:'PRIVATE_FICTIONAL_BLOB_PATH'}]),
   pushSubscriptions:fixture('pushSubscriptions',['id','ownerId','memberId','endpoint'],[{id:'fictional-push',ownerId:'fictional-owner',memberId:'fictional-agent',endpoint:'PRIVATE_FICTIONAL_PUSH_ENDPOINT'}]),
   'unknown"table':fixture('unknown"table',['strange"column'],[{'strange"column':'PRIVATE_FICTIONAL_UNKNOWN_DATA'}]),
  }};this.initial=clone(this.state);
 }
 catalog(){return Object.keys(this.state.tables).sort(compare).flatMap(name=>this.state.tables[name].columns);}
 async query(input,values=[]){
  const sql=typeof input==='string'?input:input.text,trimmed=sql.trim(),result=rows=>({rows,rowCount:rows.length});this.queries.push({sql,values});
  if(this.options.fail?.(sql))throw Object.assign(new Error('PRIVATE_FICTIONAL_DATABASE_DETAIL'),{code:'55P03'});
  if(/^BEGIN ISOLATION LEVEL /.test(trimmed)){assert.equal(this.outerSnapshot,undefined);this.outerSnapshot=clone(this.state);await this.options.onBegin?.();return result([]);}
  if(/^SET LOCAL /.test(trimmed))return result([]);
  if(sql.includes('current_database()'))return result([{name:this.options.database||'daybook_ticket',version:'170006'}]);
  if(sql.includes('pg_try_advisory_xact_lock'))return result([{locked:this.options.locked??true}]);
  if(/^SELECT hash, created_at FROM drizzle\.__drizzle_migrations/.test(trimmed))return result(clone(this.state.journal));
  if(sql.includes('format_type(a.atttypid'))return result(clone(this.catalog()));
  if(sql.includes('FROM pg_constraint'))return result(clone(this.state.constraints));
  if(sql.includes('FROM pg_indexes'))return result(clone([...this.state.indexes].sort((a,b)=>compare(a.indexname,b.indexname))));
  if(/^LOCK TABLE /.test(trimmed)){if(trimmed.startsWith('LOCK TABLE public.'))await this.options.afterTableLock?.(this.state);return result([]);}
  if(sql.includes('all_fingerprints')){
   const fingerprints=[...sql.matchAll(/jsonb_build_array\((.*?)\)::text[\s\S]*?FROM public\."((?:""|[^"])*)"/g)].map(match=>{
    const names=[...match[1].matchAll(/"((?:""|[^"])*)"/g)].map(item=>item[1].replaceAll('""','"')),table=match[2].replaceAll('""','"'),rows=this.state.tables[table].rows.map(row=>hash(JSON.stringify(names.map(name=>row[name]??null)))).sort(compare);
    return{table,columns:names.length,rows:String(rows.length),sha256:hash(rows.join(''))};
   }).sort((a,b)=>compare(a.table,b.table));assert.deepEqual(fingerprints.map(row=>row.table),values);return result(fingerprints);
  }
  if(/^CREATE SCHEMA IF NOT EXISTS "drizzle"/.test(trimmed)||/^CREATE TABLE IF NOT EXISTS "drizzle"\./.test(trimmed))return result([]);
  if(/^select id, hash, created_at from "drizzle"\./.test(trimmed))return result([clone(this.state.journal.at(-1))]);
  if(/^SAVEPOINT /.test(trimmed)){this.savepointSnapshot=clone(this.state);return result([]);}
  if(/^ROLLBACK TO SAVEPOINT /.test(trimmed)){this.state=clone(this.savepointSnapshot);return result([]);}
  if(/^RELEASE SAVEPOINT /.test(trimmed)){this.savepointSnapshot=undefined;if(!this.injected&&this.state.journal.length===8){await this.options.afterMigration?.(this.state);this.injected=true;}return result([]);}
  if(/^insert into "drizzle"\."__drizzle_migrations"/.test(trimmed)){this.state.journal.push({id:this.state.journal.length+1,hash:values[0],created_at:String(values[1])});return result([]);}
  if(/^(?:ALTER TABLE|CREATE TABLE|CREATE (?:UNIQUE )?INDEX)/.test(trimmed)){
   const plan=analyzeEvolutionSql(7,sql);
   for(const table of plan.tables){assert.equal(this.state.tables[table.name],undefined);this.state.tables[table.name]={columns:table.columns.map((field,i)=>column(table.name,field.column_name,i+1,field.data_type,field.not_null,field.column_default)),rows:[]};}
   for(const field of plan.additions){const table=this.state.tables[field.table];assert.ok(table);table.columns.push(column(field.table,field.column_name,table.columns.length+1,field.data_type,field.not_null,field.column_default));table.rows.forEach(row=>{row[field.column_name]=field.defaultValue;});}
   for(const index of plan.indexes)this.state.indexes.push({indexname:index.name,tablename:index.table,indexdef:sql.trim()});return result([]);
  }
  if(sql.includes('evolution_new_state')){
   const plan=analyzeEvolutionSql(7,(await source()).files[7].content.toString()),rows=[];
   for(const table of plan.tables)rows.push({subject:table.name,invalid:String(this.state.tables[table.name].rows.length)});
   for(const field of plan.additions)rows.push({subject:`${field.table}.${field.column_name}`,invalid:String(this.state.tables[field.table].rows.filter(row=>row[field.column_name]!==field.defaultValue).length)});
   return result(rows.sort((a,b)=>compare(a.subject,b.subject)));
  }
  if(trimmed==='COMMIT'){
   if(this.options.commitFailure==='before')throw Object.assign(new Error('PRIVATE_FICTIONAL_LOST_COMMIT'),{code:'ECONNRESET'});
   assert.ok(this.outerSnapshot);this.commits++;this.outerSnapshot=undefined;if(this.options.commitFailure==='after')throw Object.assign(new Error('PRIVATE_FICTIONAL_LOST_COMMIT'),{code:'ECONNRESET'});return result([]);
  }
  if(trimmed==='ROLLBACK'){this.rollbacks++;if(this.outerSnapshot){this.state=clone(this.outerSnapshot);this.outerSnapshot=undefined;}return result([]);}
  throw new Error(`Unexpected fixture SQL: ${sql}`);
 }
}
const source=()=>loadEvolutionMigrationArtifacts(through);
async function artifactFolder(t,change=()=>undefined){const artifacts=await source();change(artifacts);const directory=await mkdtemp(join(tmpdir(),'daybook-evolution-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));await mkdir(join(directory,'meta'));await writeFile(join(directory,'meta/_journal.json'),artifacts.journalText);for(const file of artifacts.files)await writeFile(join(directory,`${file.tag}.sql`),file.content);return directory;}

test('evolution requires a single explicit reviewed prefix, exact confirmation and independent apply token',()=>{
 assert.deepEqual(validateEvolutionCliArguments(['--audit','--through=0007'],{}),{mode:'audit',through});assert.deepEqual(validateEvolutionCliArguments(['--through=0007','--dry-run'],environment),{mode:'dry-run',through});assert.equal(validateEvolutionCliArguments(['--apply','--through=0007'],environment).mode,'apply');
 for(const args of[[],['--audit'],['--apply','--audit'],['--apply','--through=0007','secret'],['--audit','--through=0006'],['--audit','--through=0014'],['--audit','--through=7'],['--audit','--through=0007,0009'],['--audit','--through=0007;SELECT 1']])assert.throws(()=>validateEvolutionCliArguments(args,environment),MigrationOperatorError);
 for(const mode of['--dry-run','--apply'])assert.throws(()=>validateEvolutionCliArguments([mode,'--through=0007'],{}),MigrationOperatorError);
 for(const token of[undefined,'0007','true','evolution-through-0008'])assert.throws(()=>validateEvolutionCliArguments(['--apply','--through=0007'],{...environment,DAYBOOK_PRODUCTION_MIGRATION_ALLOW_APPLY:token}),MigrationOperatorError);
 assert.throws(()=>validateEvolutionCliArguments(['--dry-run','--through=0007'],{...environment,DAYBOOK_PRODUCTION_MIGRATION_CONFIRM_TARGET:evolutionConfirmTarget('0008')}),MigrationOperatorError);
});
test('both exact production hosts, database and allowlisted TLS options are mandatory',()=>{
 assert.equal(new URL(validateEvolutionProductionTargets(environment)).searchParams.get('sslmode'),'verify-full');
 for(const field of['DATABASE_URL','DIRECT_DATABASE_URL'])for(const value of[undefined,'postgresql://x:y@localhost/daybook_ticket?sslmode=require',environment[field].replace('/daybook_ticket?','/other?'),environment[field].replace('sslmode=require','sslmode=disable'),environment[field].replace('sslmode=require','sslmode=prefer'),`${environment[field]}&host=localhost`,`${environment[field]}&options=-c%20search_path%3Devil`,`${environment[field]}&dbname=other`,`${environment[field]}&sslmode=require`,`${environment[field]}&channel_binding=disable`,`${environment[field]}#secret`,environment[field].replace('.neon.tech/','.neon.tech:5433/')])assert.throws(()=>validateEvolutionProductionTargets({...environment,[field]:value}),MigrationOperatorError);
 assert.throws(()=>validateEvolutionProductionTargets({...environment,DIRECT_DATABASE_URL:environment.DATABASE_URL}),MigrationOperatorError);
 assert.throws(()=>validateEvolutionProductionTargets({...environment,NODE_TLS_REJECT_UNAUTHORIZED:'0'}),error=>error.operatorCode==='tls_verification_must_remain_enabled');
});
test('only immutable base and reviewed evolution sources may enter a contiguous snapshot',async t=>{
 const artifacts=await source();assert.equal(artifacts.files.length,8);assert.equal(REVIEWED_EVOLUTION_MIGRATIONS[0].hash,'19a2066c705193953e3aae2aaf3311bebf732dd7de38f6632a96f79d4da597a5');assert.ok(artifacts.files.every((file,i)=>hash(file.content)===EVOLUTION_PINNED_MIGRATIONS[i].hash));
 if(EVOLUTION_PINNED_MIGRATIONS.length<=13)await assert.rejects(loadEvolutionMigrationArtifacts(String(EVOLUTION_PINNED_MIGRATIONS.length).padStart(4,'0')),error=>error.operatorCode==='evolution_prefix_not_reviewed');
 for(const i of[0,3,6,7]){const directory=await artifactFolder(t,a=>{a.files[i].content=Buffer.from('SELECT 1;');});await assert.rejects(loadEvolutionMigrationArtifacts(through,directory),error=>error.operatorCode==='migration_source_hash_mismatch');}
 for(const change of[j=>{j.entries[7].when++;},j=>{j.entries[7].idx=9;},j=>{j.entries[7].when=j.entries[6].when;},j=>{j.entries[7].tag='../private';},j=>{j.entries.splice(2,1);},j=>{j.entries[0].breakpoints=false;}]){const directory=await artifactFolder(t,a=>{const journal=JSON.parse(a.journalText);change(journal);a.journalText=JSON.stringify(journal);});await assert.rejects(loadEvolutionMigrationArtifacts(through,directory),MigrationOperatorError);}
 const directory=await artifactFolder(t,a=>{const journal=JSON.parse(a.journalText);journal.entries.push({idx:8,version:'7',when:1793912001000,tag:'0008_unreviewed',breakpoints:true});a.journalText=JSON.stringify(journal);});assert.equal((await loadEvolutionMigrationArtifacts(through,directory)).files.length,8);
});
test('database journal must be the exact immutable prefix, without gaps, amendments or downgrades',()=>{
 assert.equal(validateEvolutionMigrationJournal(expectedJournal.slice(0,7),through),7);assert.equal(validateEvolutionMigrationJournal(expectedJournal,through),8);
 for(const rows of[[],expectedJournal.slice(0,6),[...expectedJournal,expectedJournal[7]],[...expectedJournal].reverse(),expectedJournal.map((row,i)=>i===2?{...row,hash:'amended'}:row),expectedJournal.map((row,i)=>i===7?{...row,created_at:String(Number(row.created_at)+1)}:row)])assert.throws(()=>validateEvolutionMigrationJournal(rows,through),MigrationOperatorError);
});
test('SQL guard rejects top-level data writes, destructive or executable commands and nonliteral defaults',()=>{
 for(const sql of['DROP TABLE tickets;','TRUNCATE tickets;','DELETE FROM tickets;','UPDATE tickets SET status=\'resolved\';','INSERT INTO tickets VALUES(1);','ALTER TABLE tickets DROP COLUMN subject;','ALTER TABLE tickets ALTER COLUMN subject TYPE integer;','DO $$ BEGIN DELETE FROM tickets; END $$;','SELECT secret FROM members;','CREATE TABLE x AS SELECT * FROM tickets;','CREATE TABLE x(id text DEFAULT current_user);','CREATE TABLE x(id text); UPDATE tickets SET id=2;','CREATE OR REPLACE FUNCTION x() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW;END$$;'])assert.throws(()=>analyzeEvolutionSql(7,sql),MigrationOperatorError);
 for(const sql of['CREATE TABLE "evolutionFeatures" ("featuresJson" text DEFAULT \'{"pilots":true}\');','CREATE TABLE "automationSettings" (enabled boolean DEFAULT true);','ALTER TABLE "authUser" ADD COLUMN "twoFactorEnabled" boolean NOT NULL DEFAULT true;','CREATE TABLE "workspaceProfiles" (state text DEFAULT \'active\');'])assert.throws(()=>analyzeEvolutionSql(sql.includes('authUser')?12:sql.includes('workspaceProfiles')?13:7,sql),error=>error.operatorCode==='unsafe_evolution_activation_default');
 const parsed=analyzeEvolutionSql(7,"/* UPDATE ignored comment */ CREATE TABLE x(id text DEFAULT 'DELETE; DROP TABLE (tickets)'); -- TRUNCATE ignored\n");assert.equal(parsed.tables[0].columns[0].defaultValue,'DELETE; DROP TABLE (tickets)');
 assert.throws(()=>analyzeEvolutionSql(7,'ALTER TABLE tickets ADD COLUMN risky text NOT NULL;'),error=>error.operatorCode==='unsafe_nonnullable_evolution_addition');
});
test('only reviewed attachment-kind and tenant-scoped push index replacement exceptions are allowed',()=>{
 assert.doesNotThrow(()=>analyzeEvolutionSql(9,'ALTER TABLE attachments DROP CONSTRAINT attachments_kind; ALTER TABLE attachments ADD CONSTRAINT attachments_kind CHECK(kind IN (\'request\',\'reply\',\'note\',\'contract\'));'));
 for(const index of[7,8,10,11,12,13])assert.throws(()=>analyzeEvolutionSql(index,'ALTER TABLE attachments DROP CONSTRAINT attachments_kind;'),MigrationOperatorError);
 const replacement='DROP INDEX "push_subscription_endpoint"; CREATE UNIQUE INDEX "push_subscription_endpoint" ON "pushSubscriptions" ("ownerId","memberId",endpoint);';assert.equal(analyzeEvolutionSql(13,replacement).replacesPushEndpoint,true);
 for(const sql of['DROP INDEX "push_subscription_endpoint";',replacement.replace('"ownerId","memberId",',''),replacement.replace('"memberId"','"otherId"'),replacement.replace('UNIQUE ',''),replacement.replace('"push_subscription_endpoint"','"other"'),replacement+' DROP TABLE "pushSubscriptions";'])assert.throws(()=>analyzeEvolutionSql(13,sql),MigrationOperatorError);
 assert.throws(()=>analyzeEvolutionSql(12,replacement),MigrationOperatorError);
});
test('private snapshot copies checked buffers and is owner-only on disk',async t=>{
 const artifacts=await source(),directory=await freezeEvolutionArtifacts(through,artifacts);t.after(()=>rm(directory,{recursive:true,force:true}));artifacts.files[7].content.fill(0);
 assert.equal((await stat(directory)).mode&0o777,0o700);assert.equal((await stat(join(directory,'meta'))).mode&0o777,0o700);
 assert.equal((await stat(join(directory,'meta/_journal.json'))).mode&0o777,0o600);assert.equal(hash(await readFile(join(directory,'0007_collaboration.sql'))),REVIEWED_EVOLUTION_MIGRATIONS[0].hash);assert.equal((await stat(join(directory,'0007_collaboration.sql'))).mode&0o777,0o600);
});
test('audit is one read-only snapshot and does not lock, migrate, write data or disclose content',async()=>{
 const client=new FixtureClient(),report=await runEvolutionMigrationOperator(client,{through});assert.equal(report.committed,false);assert.equal(report.migration,'pending');assert.deepEqual(report.pendingMigrations,['0007_collaboration']);assert.equal(client.queries[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal(client.queries.at(-1).sql,'ROLLBACK');
 assert.equal(client.queries.some(({sql})=>/^\s*(LOCK|CREATE|ALTER|INSERT|UPDATE|DELETE|COMMIT|SAVEPOINT)\b/i.test(sql)||sql.includes('pg_try_advisory_xact_lock')),false);assert.deepEqual(client.state,client.initial);assert.ok(report.fingerprints.some(row=>row.table==='unknown"table'));assert.equal(/PRIVATE_FICTIONAL|fictional_password/.test(JSON.stringify(report)),false);
});
test('dry-run executes installed migrator inside one savepoint and restores all schema, journal and data',async()=>{
 const client=new FixtureClient(),report=await runEvolutionMigrationOperator(client,{mode:'dry-run',through});assert.equal(report.migration,'would_apply');assert.equal(report.committed,false);assert.equal(client.commits,0);assert.deepEqual(client.state,client.initial);
 for(const command of['BEGIN ','SAVEPOINT ','RELEASE SAVEPOINT '])assert.equal(client.queries.filter(({sql})=>sql.startsWith(command)).length,1);assert.equal(client.queries.at(-1).sql,'ROLLBACK');assert.equal(client.queries.some(({sql})=>/CREATE TABLE "messageMentions"/.test(sql)),true);assert.equal(client.queries.some(({sql})=>/CREATE TABLE "tickets"/.test(sql)),false);
 const inserted=client.queries.filter(({sql})=>/^\s*insert into\b/i.test(sql));assert.equal(inserted.length,1);assert.equal(inserted[0].values[0],REVIEWED_EVOLUTION_MIGRATIONS[0].hash);
});
test('apply commits once after locking every table and preserving credentials, sessions, files, deadlines and frozen mail',async()=>{
 const client=new FixtureClient(),report=await runEvolutionMigrationOperator(client,{mode:'apply',through});assert.equal(report.committed,true);assert.equal(client.commits,1);assert.equal(client.state.journal.length,8);assert.equal(report.preservedTables,12);assert.equal(report.preservedRows,'12');assert.equal(client.queries.at(-1).sql,'COMMIT');assert.ok(report.newState.every(row=>row.invalid==='0'));
 for(const[table,field]of[['authAccount','password'],['authSession','token'],['attachments','pathname'],['tickets','dueAt'],['messages','body'],['mailOutbox','payloadJson'],['settings','data']])assert.equal(client.state.tables[table].rows[0][field],client.initial.tables[table].rows[0][field]);assert.equal(client.state.tables.messages.rows[0].replyToMessageId,null);assert.equal(client.state.tables.mailOutbox.rows[0].sourceMessageId,null);
 const locks=client.queries.find(({sql})=>sql.startsWith('LOCK TABLE public.')).sql;assert.ok(locks.includes('public."unknown""table"'));assert.ok(locks.includes('"authSession"'));assert.equal(/PRIVATE_FICTIONAL|fictional_password/.test(JSON.stringify(report)),false);
});
test('already-applied audits and write modes preserve live controls and never rerun migration or commit',async()=>{
 const client=new FixtureClient();await runEvolutionMigrationOperator(client,{mode:'apply',through});client.state.tables.evolutionFeatures.rows.push({ownerId:'fictional-owner',featuresJson:'{"collaboration":true,"security":true}',version:2,updatedAt:'2026-11-05T15:00:00Z'});client.state.tables.userPreferences.rows.push({userId:'fictional-user',theme:'dark',updatedAt:'2026-11-05T15:00:00Z'});client.state.tables.mailOutbox.rows[0].sourceMessageId=1;const preserved=clone(client.state);
 for(const mode of['audit','dry-run','apply']){client.queries=[];const report=await runEvolutionMigrationOperator(client,{mode,through});assert.equal(report.migration,'already_applied_no_changes');assert.equal(report.committed,false);assert.deepEqual(client.state,preserved);assert.equal(client.queries.some(({sql})=>/^\s*(CREATE|ALTER|INSERT|UPDATE|DELETE|SAVEPOINT|COMMIT)\b/i.test(sql)),false);}
});
test('artifact changes after checking cannot influence the standard migrator snapshot',async()=>{
 const artifacts=await source(),client=new FixtureClient({onBegin:()=>artifacts.files[7].content.fill(0)});assert.equal((await runEvolutionMigrationOperator(client,{mode:'dry-run',through,artifacts})).migration,'would_apply');
 const tampered=await source();tampered.files[7].content.fill(0);const untouched=new FixtureClient();await assert.rejects(runEvolutionMigrationOperator(untouched,{mode:'apply',through,artifacts:tampered}),MigrationOperatorError);assert.equal(untouched.queries.length,0);
});
test('wrong target, contention, lock timeout, schema races and DDL failures roll back',async()=>{
 for(const options of[{database:'other'},{locked:false},{fail:sql=>sql.startsWith('LOCK TABLE public.')},{fail:sql=>/CREATE TABLE "ticketFollowers"/.test(sql)},{afterTableLock:state=>{state.tables.authSession.columns[1].column_default="'changed'::text";}}]){const client=new FixtureClient(options);await assert.rejects(runEvolutionMigrationOperator(client,{mode:'apply',through}));assert.equal(client.commits,0);assert.equal(client.queries.at(-1).sql,'ROLLBACK');assert.deepEqual(client.state,client.initial);}
});
test('journal amendments, partial schema and missing applied indexes stop before migration',async()=>{
 for(const change of[state=>{state.journal[0].hash='changed';},state=>{state.tables.messageMentions={rows:[],columns:[column('messageMentions','id',1)]};},state=>{state.tables.messages.columns.push(column('messages','replyToMessageId',4,'integer',false));}]){const client=new FixtureClient();change(client.state);const before=clone(client.state);await assert.rejects(runEvolutionMigrationOperator(client,{mode:'apply',through}),MigrationOperatorError);assert.equal(client.queries.some(({sql})=>/^\s*(CREATE|ALTER|INSERT|SAVEPOINT)\b/i.test(sql)),false);assert.deepEqual(client.state,before);}
 const client=new FixtureClient();await runEvolutionMigrationOperator(client,{mode:'apply',through});client.state.indexes=client.state.indexes.filter(row=>row.indexname!=='message_mentions_recipient');await assert.rejects(runEvolutionMigrationOperator(client,{through}),error=>error.operatorCode==='evolution_index_missing');
});
test('all data, column, new-state, index and journal fault injections abort before commit',async()=>{
 const cases=[
  [state=>{state.tables.authAccount.rows[0].password='changed';},'original_data_preservation_failed'],
  [state=>{state.tables.mailOutbox.rows[0].payloadJson='changed';},'original_data_preservation_failed'],
  [state=>{state.tables.attachments.rows[0].pathname='changed';},'original_data_preservation_failed'],
  [state=>{state.tables.authSession.columns[1].collation='999';},'existing_column_definition_changed'],
  [state=>{state.tables.unknown={rows:[],columns:[column('unknown','id',1)]};},'unexpected_public_schema_change'],
  [state=>{state.tables.messages.columns.push(column('messages','extra',5));},'unexpected_public_column_change'],
  [state=>{state.tables.userPreferences.columns[1].column_default="'dark'::text";},'evolution_table_schema_mismatch'],
  [state=>{state.tables.messages.columns.find(row=>row.column_name==='replyToMessageId').not_null=true;},'evolution_added_column_schema_mismatch'],
  [state=>{state.tables.messages.rows[0].replyToMessageId=99;},'unexpected_evolution_backfill'],
  [state=>{state.tables.evolutionFeatures.rows.push({ownerId:'new',featuresJson:'{"pilots":true}'});},'unexpected_evolution_backfill'],
  [state=>{state.indexes[0].indexdef='CREATE UNIQUE INDEX push_subscription_endpoint ON public."pushSubscriptions" ("memberId",endpoint)';},'existing_index_definition_changed'],
  [state=>{state.indexes=state.indexes.filter(row=>row.indexname!=='ticket_followers_owner');},'evolution_index_missing'],
  [state=>{state.journal[7].hash='changed';},'unexpected_database_journal'],
  [state=>{state.constraints[0].definition='CHECK (true)';},'existing_constraint_definition_changed'],
 ];
 for(const[afterMigration,code]of cases){const client=new FixtureClient({afterMigration});await assert.rejects(runEvolutionMigrationOperator(client,{mode:'apply',through}),error=>error.operatorCode===code,code);assert.equal(client.commits,0);assert.deepEqual(client.state,client.initial);}
});
test('lost COMMIT responses remain uncertain even when the server committed and are never retried',async()=>{
 for(const commitFailure of['before','after']){const client=new FixtureClient({commitFailure});let failure;try{await runEvolutionMigrationOperator(client,{mode:'apply',through});}catch(error){failure=evolutionFailureReport(error);}assert.deepEqual(failure,{result:'FAIL',code:'commit_outcome_unknown',committed:'unknown',nextAction:'audit_before_any_retry'});assert.equal(client.queries.filter(({sql})=>sql==='COMMIT').length,1);assert.equal(client.state.journal.length,commitFailure==='after'?8:7);client.options.commitFailure=undefined;const audit=await runEvolutionMigrationOperator(client,{through});assert.equal(audit.migration,commitFailure==='after'?'already_applied_no_changes':'pending');assert.equal(audit.committed,false);}
});
test('failure summaries never print credentials, arbitrary operator codes or row/error detail',()=>{
 for(const error of[new Error('PRIVATE_FICTIONAL_CREDENTIAL'),{code:'PRIVATE_FICTIONAL_PASSWORD',detail:'PRIVATE_FICTIONAL_TICKET'},{operatorCode:'PRIVATE_FICTIONAL'}])assert.deepEqual(evolutionFailureReport(error),{result:'FAIL',code:'operator_failed'});
 assert.deepEqual(evolutionFailureReport(new MigrationOperatorError('original_data_preservation_failed')),{result:'FAIL',code:'original_data_preservation_failed'});assert.deepEqual(evolutionFailureReport({cause:{code:'55P03',message:'PRIVATE_FICTIONAL_PASSWORD'}}),{result:'FAIL',code:'55P03'});
});
