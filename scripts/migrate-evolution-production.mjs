/** Explicit, reviewed, contiguous evolution release operator. No app imports, seeds, jobs or provider calls. */
import {createHash} from 'node:crypto';
import {readFile,mkdtemp,mkdir,writeFile,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import pg from 'pg';
import {drizzle} from 'drizzle-orm/node-postgres';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import {MigrationOperatorError,validateProductionConnectionTargets,createMigrationSavepointClient} from './migrate-notifications-production.mjs';
import {RELIABILITY_PINNED_MIGRATIONS} from './migrate-reliability-production.mjs';

export {MigrationOperatorError};
/** Extend ONLY after the corresponding PR, normalized journal and isolated SQL rehearsal have been reviewed. */
export const REVIEWED_EVOLUTION_MIGRATIONS=Object.freeze([
 Object.freeze({tag:'0007_collaboration',when:1793912000000,hash:'19a2066c705193953e3aae2aaf3311bebf732dd7de38f6632a96f79d4da597a5'}),
 Object.freeze({tag:'0008_organization',when:1793912001000,hash:'7f9a8e8d585752e8cecce99414aa10042e517f4e03e84abe579046e90d78f058'}),
 Object.freeze({tag:'0009_service_context',when:1793912002000,hash:'c0326e1ea6366594eb186020800ae9b413cd309b3dcc789ce6cd466b9b799a25'}),
]);
export const EVOLUTION_PINNED_MIGRATIONS=Object.freeze([...RELIABILITY_PINNED_MIGRATIONS,...REVIEWED_EVOLUTION_MIGRATIONS]);
const BASE_TARGET='daybook-ticket:ep-dawn-moon-bbwpjcrp.c-15.us-east-1.aws.neon.tech/daybook_ticket';
const sha256=value=>createHash('sha256').update(value).digest('hex');
const quote=value=>`"${value.replaceAll('"','""')}"`;
function guard(condition,code){if(!condition)throw new MigrationOperatorError(code);}
export function evolutionConfirmTarget(through){targetIndex(through);return `${BASE_TARGET}:through-${through}`;}
function targetIndex(through){guard(typeof through==='string'&&/^(000[7-9]|001[0-3])$/.test(through),'explicit_evolution_prefix_required');return Number(through);}
export function validateEvolutionCliArguments(args,environment){
 guard(args.length===2,'usage_mode_and_through_required');
 const mode=args.find(value=>['--audit','--dry-run','--apply'].includes(value)),target=args.find(value=>/^--through=/.test(value));
 guard(mode&&target&&new Set(args).size===2,'usage_mode_and_through_required');
 const through=target.slice('--through='.length);targetIndex(through);
 if(mode!=='--audit')guard(environment.DAYBOOK_PRODUCTION_MIGRATION_CONFIRM_TARGET===evolutionConfirmTarget(through),'exact_target_confirmation_required');
 if(mode==='--apply')guard(environment.DAYBOOK_PRODUCTION_MIGRATION_ALLOW_APPLY===`evolution-through-${through}`,'explicit_evolution_apply_guard_required');
 return {mode:mode.slice(2),through};
}
export function validateEvolutionProductionTargets(environment){guard(environment.NODE_TLS_REJECT_UNAUTHORIZED!=='0','tls_verification_must_remain_enabled');const direct=new URL(validateProductionConnectionTargets(environment));direct.searchParams.set('sslmode','verify-full');return direct.toString();}

/** Small lexical reader, not a general SQL executor. Strings, comments and dollar bodies cannot hide top-level commands. */
function tokens(sql){
 const result=[];let i=0;
 while(i<sql.length){
  if(/\s/.test(sql[i])){i++;continue;}
  if(sql.startsWith('--',i)){const end=sql.indexOf('\n',i+2);i=end<0?sql.length:end+1;continue;}
  if(sql.startsWith('/*',i)){let depth=1;i+=2;while(i<sql.length&&depth){if(sql.startsWith('/*',i)){depth++;i+=2;}else if(sql.startsWith('*/',i)){depth--;i+=2;}else i++;}guard(depth===0,'invalid_evolution_sql');continue;}
  if(sql[i]==="'"||sql[i]==='"'){
   const delimiter=sql[i],kind=delimiter==="'"?'string':'identifier';let value='';i++;let closed=false;
   while(i<sql.length){if(sql[i]===delimiter){if(sql[i+1]===delimiter){value+=delimiter;i+=2;}else{i++;closed=true;break;}}else value+=sql[i++];}
   guard(closed,'invalid_evolution_sql');result.push({kind,value});continue;
  }
  const dollar=sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
  if(dollar){const end=sql.indexOf(dollar,i+dollar.length);guard(end>=0,'invalid_evolution_sql');result.push({kind:'body',value:sql.slice(i+dollar.length,end)});i=end+dollar.length;continue;}
  const word=sql.slice(i).match(/^[A-Za-z_][A-Za-z0-9_$]*/)?.[0];if(word){result.push({kind:'word',value:word.toLowerCase()});i+=word.length;continue;}
  const number=sql.slice(i).match(/^\d+/)?.[0];if(number){result.push({kind:'number',value:number});i+=number.length;continue;}
  result.push({kind:'symbol',value:sql[i++]});
 }
 return result;
}
const word=(token,value)=>token?.kind==='word'&&token.value===value;
const identifier=token=>token&&(token.kind==='identifier'||token.kind==='word')?token.value:null;
function groups(input,delimiter=','){const rows=[];let depth=0,row=[];for(const token of input){if(token.kind==='symbol'&&token.value==='(')depth++;if(token.kind==='symbol'&&token.value===')')depth--;guard(depth>=0,'invalid_evolution_sql');if(token.kind==='symbol'&&token.value===delimiter&&depth===0){rows.push(row);row=[];}else row.push(token);}guard(depth===0,'invalid_evolution_sql');if(row.length)rows.push(row);return rows;}
function canonical(input){const values=(typeof input==='string'?tokens(input):input).filter(token=>token.kind!=='symbol'||token.value!==';').map(token=>token.kind==='string'?`'${token.value.replaceAll("'","''")}'`:token.kind==='body'?'$body$':token.value);return values.join(' ').replaceAll('public . ','').replaceAll('using btree ','');}
const OLD_PUSH=canonical('CREATE UNIQUE INDEX push_subscription_endpoint ON public."pushSubscriptions" USING btree (endpoint)');
const NEW_PUSH=canonical('CREATE UNIQUE INDEX push_subscription_endpoint ON public."pushSubscriptions" USING btree ("ownerId","memberId",endpoint)');
function columnDefinition(input){
 const name=identifier(input[0]),kind=input[1]?.value;guard(name&&['text','integer','boolean','bigint','timestamptz'].includes(kind),'unsupported_evolution_column');
 let value=null,expression=null;const index=input.findIndex(token=>word(token,'default'));
 if(index>=0){const token=input[index+1];guard(token,'unsupported_evolution_default');
  if(token.kind==='string'){guard(kind==='text','unsupported_evolution_default');value=token.value;expression=`'${value.replaceAll("'","''")}'::text`;}
  else if(token.kind==='number'){guard(['integer','bigint'].includes(kind)&&Number.isSafeInteger(Number(token.value)),'unsupported_evolution_default');value=Number(token.value);expression=String(value);}
  else if(word(token,'true')||word(token,'false')){guard(kind==='boolean','unsupported_evolution_default');value=token.value==='true';expression=token.value;}
  else throw new MigrationOperatorError('unsupported_evolution_default');
  const following=input[index+2];guard(!following||['not','primary','references','check','constraint','unique'].some(item=>word(following,item)),'unsupported_evolution_default');
 }
 const notNull=input.some((token,index)=>word(token,'not')&&word(input[index+1],'null')||word(token,'primary')&&word(input[index+1],'key'));
 return {column_name:name,data_type:kind==='timestamptz'?'timestamp with time zone':kind,not_null:notNull,column_default:expression,defaultValue:value};
}
const SAFE_DEFAULTS={evolutionFeatures:{featuresJson:'{}'},serviceContextNotificationSettings:{enabled:false},automationSettings:{enabled:false},automationRules:{enabled:false},securityPolicies:{requireStaffMfa:false},authUser:{twoFactorEnabled:false},workspaceProfiles:{state:'draft',mailEnabled:false,inboundEnabled:false}};
function safeDefaults(table,columns){for(const [name,value]of Object.entries(SAFE_DEFAULTS[table]||{})){const column=columns.find(item=>item.column_name===name);if(column)guard(column.defaultValue===value&&column.column_default!==null,'unsafe_evolution_activation_default');}}

/** Reviewed hash validation is also mandatory. This additional grammar rejects data writes and destructive DDL. */
export function analyzeEvolutionSql(index,sql){
 guard(Number.isInteger(index)&&index>=7&&index<=13&&typeof sql==='string'&&!sql.includes('\0'),'invalid_evolution_sql');
 const plan={tables:[],additions:[],indexes:[],replacesPushEndpoint:false,replacesAttachmentKind:false};let droppedPush=0,createdPush=0,droppedKind=0,createdKind=0;
 for(const statement of groups(tokens(sql),';')){
  if(word(statement[0],'create')&&word(statement[1],'table')){
   const name=identifier(statement[2]);guard(name&&statement[3]?.value==='('&&statement.at(-1)?.value===')','unsupported_evolution_ddl');
   const definitions=groups(statement.slice(4,-1)),columns=definitions.filter(row=>!['constraint','primary','foreign','unique','check'].some(value=>word(row[0],value))).map(columnDefinition);
   guard(columns.length>0&&new Set(columns.map(item=>item.column_name)).size===columns.length,'invalid_evolution_table');
   for(const row of definitions.filter(row=>word(row[0],'primary')&&word(row[1],'key')))for(const token of row.slice(3,-1)){const name=identifier(token),column=columns.find(item=>item.column_name===name);if(column)column.not_null=true;}
   safeDefaults(name,columns);plan.tables.push({name,columns});continue;
  }
  if(word(statement[0],'alter')&&word(statement[1],'table')){
   const table=identifier(statement[2]);guard(table,'unsupported_evolution_ddl');
   if(word(statement[3],'drop')){guard(index===9&&canonical(statement)===canonical('ALTER TABLE attachments DROP CONSTRAINT attachments_kind'),'destructive_evolution_ddl');droppedKind++;continue;}
   const parts=groups(statement.slice(3));
   for(const part of parts){
    if(word(part[0],'add')&&word(part[1],'column')){const definition=columnDefinition(part.slice(2));guard(!definition.not_null||definition.column_default!==null,'unsafe_nonnullable_evolution_addition');safeDefaults(table,[definition]);plan.additions.push({table,...definition});}
    else {guard(index===9&&table==='attachments'&&word(part[0],'add')&&word(part[1],'constraint')&&['attachments_kind','attachment_contract_scope'].includes(identifier(part[2]))&&word(part[3],'check'),'unsupported_evolution_ddl');if(identifier(part[2])==='attachments_kind'){guard(canonical(part)===canonical("ADD CONSTRAINT attachments_kind CHECK(kind IN ('request','reply','note','contract'))"),'unexpected_attachment_constraint_replacement');createdKind++;}}
   }
   continue;
  }
  if(word(statement[0],'drop')){guard(index===13&&canonical(statement)===canonical('DROP INDEX push_subscription_endpoint'),'destructive_evolution_ddl');droppedPush++;continue;}
  if(word(statement[0],'create')&&(word(statement[1],'index')||word(statement[1],'unique')&&word(statement[2],'index'))){
   const position=word(statement[1],'unique')?3:2,name=identifier(statement[position]);guard(name&&word(statement[position+1],'on')&&identifier(statement[position+2]),'unsupported_evolution_ddl');
   if(name==='push_subscription_endpoint'){guard(index===13&&canonical(statement)===NEW_PUSH,'unexpected_push_index_replacement');createdPush++;}
   plan.indexes.push({name,table:identifier(statement[position+2])});continue;
  }
  if(word(statement[0],'create')&&word(statement[1],'function')){
   const name=identifier(statement[2]),approved=index===12&&name==='daybook_security_audit_immutable'||index===13&&name==='daybook_workspace_quota';
   guard(approved&&canonical(statement)===`create function ${name} ( ) returns trigger language plpgsql as $body$`,'unsupported_evolution_function');continue;
  }
  if(word(statement[0],'create')&&word(statement[1],'trigger')){
   const name=identifier(statement[2]),allowed=index===12&&name==='security_audit_immutable'||index===13&&['workspace_quota_members','workspace_quota_tickets','workspace_quota_messages','workspace_quota_attachments','workspace_quota_mail'].includes(name);
   guard(allowed&&!statement.some(token=>token.kind==='body'),'unsupported_evolution_trigger');continue;
  }
  throw new MigrationOperatorError('unsupported_evolution_ddl');
 }
 guard(droppedPush===createdPush&&droppedPush<=1,'unexpected_push_index_replacement');guard(droppedKind===createdKind&&droppedKind<=1,'unexpected_attachment_constraint_replacement');plan.replacesAttachmentKind=droppedKind===1;plan.replacesPushEndpoint=droppedPush===1;return plan;
}
function checkedArtifacts(source,through){
 const index=targetIndex(through);guard(index<EVOLUTION_PINNED_MIGRATIONS.length,'evolution_prefix_not_reviewed');let journal;
 try{journal=JSON.parse(source.journalText);}catch{throw new MigrationOperatorError('invalid_source_journal');}
 guard(journal.version==='7'&&journal.dialect==='postgresql'&&Array.isArray(journal.entries)&&journal.entries.length>index&&journal.entries.length<=256&&Array.isArray(source.files)&&source.files.length===index+1,'unexpected_source_journal');
 for(const [i,entry]of journal.entries.entries())guard(entry?.idx===i&&entry.version==='7'&&entry.breakpoints===true&&Number.isSafeInteger(entry.when)&&entry.when>0&&(i===0||entry.when>journal.entries[i-1].when)&&typeof entry.tag==='string'&&new RegExp(`^${String(i).padStart(4,'0')}_[a-z0-9_]+$`).test(entry.tag),'noncontiguous_source_journal');
 const files=EVOLUTION_PINNED_MIGRATIONS.slice(0,index+1).map((pinned,i)=>{
  const entry=journal.entries[i],file=source.files[i];guard(entry.tag===pinned.tag&&entry.when===pinned.when&&(i<7||pinned.when===1793912000000+1000*(i-7)),'unexpected_source_journal');
  guard(file?.tag===pinned.tag&&file.when===pinned.when&&file.hash===pinned.hash&&(Buffer.isBuffer(file.content)||typeof file.content==='string'),'migration_source_hash_mismatch');
  const content=Buffer.from(file.content);guard(sha256(content)===pinned.hash,'migration_source_hash_mismatch');return {...pinned,content,...(i<7?{}:{plan:analyzeEvolutionSql(i,content.toString('utf8'))})};
 });
 return {files,journalText:JSON.stringify({version:'7',dialect:'postgresql',entries:journal.entries.slice(0,index+1)})};
}
export async function loadEvolutionMigrationArtifacts(through,folder=new URL('../drizzle-postgres/',import.meta.url)){
 const index=targetIndex(through);guard(index<EVOLUTION_PINNED_MIGRATIONS.length,'evolution_prefix_not_reviewed');const directory=folder instanceof URL?fileURLToPath(folder):folder;
 const journalText=await readFile(join(directory,'meta/_journal.json'),'utf8'),files=await Promise.all(EVOLUTION_PINNED_MIGRATIONS.slice(0,index+1).map(async pinned=>({...pinned,content:await readFile(join(directory,`${pinned.tag}.sql`))})));
 return checkedArtifacts({journalText,files},through);
}
export function validateEvolutionMigrationJournal(rows,through){const last=targetIndex(through);guard(last<EVOLUTION_PINNED_MIGRATIONS.length,'evolution_prefix_not_reviewed');guard(Array.isArray(rows)&&rows.length>=7&&rows.length<=last+1,'unexpected_database_journal_length');rows.forEach((row,i)=>guard(row.hash===EVOLUTION_PINNED_MIGRATIONS[i].hash&&String(row.created_at)===String(EVOLUTION_PINNED_MIGRATIONS[i].when),'unexpected_database_journal'));return rows.length;}
async function journal(client){return(await client.query('SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id')).rows;}
async function columns(client){
 const rows=(await client.query(`SELECT c.relname AS table_name,a.attname AS column_name,a.attnum::integer AS position,format_type(a.atttypid,a.atttypmod) AS data_type,a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS column_default,a.attidentity AS identity,a.attgenerated AS generated,a.attcollation::text AS collation
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname COLLATE "C",a.attnum`)).rows;
 const tables=new Map();for(const row of rows)tables.set(row.table_name,[...(tables.get(row.table_name)||[]),row]);guard(['tickets','messages','mailOutbox','members','authUser','organizations','pushSubscriptions'].every(table=>tables.has(table)),'unexpected_public_schema');return tables;
}
async function indexes(client){return(await client.query('SELECT indexname,tablename,indexdef FROM pg_indexes WHERE schemaname=\'public\' ORDER BY indexname COLLATE "C"')).rows;}
async function constraints(client){return(await client.query(`SELECT r.relname AS table_name,c.conname AS constraint_name,c.contype AS type,c.convalidated AS validated,c.condeferrable AS deferrable,c.condeferred AS deferred,pg_get_constraintdef(c.oid,true) AS definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' ORDER BY r.relname COLLATE "C",c.conname COLLATE "C"`)).rows;}
function kindConstraint(definition,values){
 const input=tokens(definition).filter(token=>token.kind!=='symbol'||!['(',')',';'].includes(token.value)),withoutCasts=[];
 for(let i=0;i<input.length;i++){if(input[i]?.value===':'&&input[i+1]?.value===':'&&word(input[i+2],'text')){i+=2;continue;}withoutCasts.push(input[i]);}
 const actual=canonical(withoutCasts),expected=canonical(`CHECK(kind=ANY(ARRAY[${values.map(value=>"'"+value+"'").join(',')}]))`);
 return actual===canonical(tokens(expected).filter(token=>token.kind!=='symbol'||!['(',')'].includes(token.value)))||actual===canonical(tokens(`CHECK(kind IN (${values.map(value=>"'"+value+"'").join(',')}))`).filter(token=>token.kind!=='symbol'||!['(',')'].includes(token.value)));
}
function validKindConstraint(row,values){return row?.table_name==='attachments'&&row.constraint_name==='attachments_kind'&&row.type==='c'&&row.validated===true&&row.deferrable===false&&row.deferred===false&&kindConstraint(row.definition,values);}
function verifyConstraints(before,after,pending){
 const replacement=pending.some(file=>file.plan.replacesAttachmentKind),byName=new Map(after.map(row=>[`${row.table_name}:${row.constraint_name}`,row]));
 for(const row of before){const current=byName.get(`${row.table_name}:${row.constraint_name}`);if(replacement&&row.table_name==='attachments'&&row.constraint_name==='attachments_kind')guard(validKindConstraint(row,['request','reply','note'])&&validKindConstraint(current,['request','reply','note','contract']),'unexpected_attachment_constraint_replacement');else guard(current&&JSON.stringify(current)===JSON.stringify(row),'existing_constraint_definition_changed');}
 if(replacement)guard(before.some(row=>row.table_name==='attachments'&&row.constraint_name==='attachments_kind'),'missing_original_attachment_constraint');
}
async function fingerprints(client,tables){
 const labels=[...tables.keys()],sql=[...tables].map(([table,columns],i)=>`SELECT $${i+1}::text AS "table",${columns.length}::integer AS columns,count(*)::text AS rows,encode(sha256(convert_to(COALESCE(string_agg(row_hash,'' ORDER BY row_hash COLLATE "C"),''),'UTF8')),'hex') AS sha256 FROM (SELECT encode(sha256(convert_to(jsonb_build_array(${columns.map(column=>quote(column.column_name)).join(',')})::text,'UTF8')),'hex') AS row_hash FROM public.${quote(table)}) original_rows`);
 return(await client.query(`SELECT * FROM (${sql.join(' UNION ALL ')}) all_fingerprints ORDER BY "table" COLLATE "C"`,labels)).rows;
}
function checkColumn(actual,expected){return actual&&['column_name','data_type','not_null','column_default'].every(key=>actual[key]===expected[key]);}
function verifySchema(tables,source,count){
 const applied=source.files.slice(7,count),pending=source.files.slice(Math.max(7,count));
 for(const file of applied){for(const table of file.plan.tables){const expected=[...table.columns,...applied.flatMap(item=>item.plan.additions.filter(column=>column.table===table.name))],actual=tables.get(table.name);guard(actual?.length===expected.length&&expected.every((column,i)=>checkColumn(actual[i],column)),'evolution_table_schema_mismatch');}for(const column of file.plan.additions)guard(checkColumn(tables.get(column.table)?.find(item=>item.column_name===column.column_name),column),'evolution_added_column_schema_mismatch');}
 for(const file of pending){for(const table of file.plan.tables)guard(!tables.has(table.name),'partial_evolution_schema_without_journal');for(const column of file.plan.additions)guard(!tables.get(column.table)?.some(item=>item.column_name===column.column_name),'partial_evolution_schema_without_journal');}
}
function verifyOriginals(before,after,pending){
 const created=pending.flatMap(file=>file.plan.tables.map(table=>table.name)),expected=[...new Set([...before.keys(),...created])].sort();guard(JSON.stringify([...after.keys()].sort())===JSON.stringify(expected),'unexpected_public_schema_change');
 for(const [table,old]of before){const current=after.get(table);guard(current&&old.every((column,i)=>JSON.stringify(column)===JSON.stringify(current[i])),'existing_column_definition_changed');const added=pending.flatMap(file=>file.plan.additions.filter(column=>column.table===table).map(column=>column.column_name));guard(JSON.stringify(current.map(column=>column.column_name))===JSON.stringify([...old.map(column=>column.column_name),...added]),'unexpected_public_column_change');}
}
function verifyAppliedIndexes(current,source,count){
 const byName=new Map(current.map(row=>[row.indexname,row]));
 for(const file of source.files.slice(7,count))for(const index of file.plan.indexes)guard(byName.get(index.name)?.tablename===index.table,'evolution_index_missing');
 if(source.files.slice(7,count).some(file=>file.plan.replacesPushEndpoint))guard(canonical(byName.get('push_subscription_endpoint')?.indexdef||'')===NEW_PUSH,'unexpected_push_index_replacement');
}
function verifyIndexes(before,after,pending){
 const replacement=pending.some(file=>file.plan.replacesPushEndpoint),byName=new Map(after.map(row=>[row.indexname,row]));
 for(const row of before){const current=byName.get(row.indexname);if(replacement&&row.indexname==='push_subscription_endpoint'){guard(row.tablename==='pushSubscriptions'&&canonical(row.indexdef)===OLD_PUSH&&current?.tablename==='pushSubscriptions'&&canonical(current.indexdef)===NEW_PUSH,'unexpected_push_index_replacement');}else guard(current&&JSON.stringify(current)===JSON.stringify(row),'existing_index_definition_changed');}
 if(replacement)guard(before.some(row=>row.indexname==='push_subscription_endpoint'),'missing_original_push_index');
 for(const file of pending)for(const index of file.plan.indexes)guard(byName.get(index.name)?.tablename===index.table,'evolution_index_missing');
}
async function newStateCounts(client,pending){
 const created=pending.flatMap(file=>file.plan.tables.map(table=>table.name)),additions=pending.flatMap(file=>file.plan.additions),parts=[],values=[];
 for(const table of created){values.push(table);parts.push(`SELECT $${values.length}::text AS subject,count(*)::text AS invalid FROM public.${quote(table)}`);}
 for(const column of additions){values.push(`${column.table}.${column.column_name}`,column.defaultValue);parts.push(`SELECT $${values.length-1}::text AS subject,count(*)::text AS invalid FROM public.${quote(column.table)} WHERE ${quote(column.column_name)} IS DISTINCT FROM $${values.length}::${column.data_type}`);}
 if(!parts.length)return[];const rows=(await client.query(`SELECT * FROM (${parts.join(' UNION ALL ')}) evolution_new_state ORDER BY subject COLLATE "C"`,values)).rows;guard(rows.every(row=>row.invalid==='0'),'unexpected_evolution_backfill');return rows;
}

async function freezeCheckedSource(source){
 const directory=await mkdtemp(join(tmpdir(),'daybook-evolution-'));
 try{await chmod(directory,0o700);await mkdir(join(directory,'meta'),{mode:0o700});await writeFile(join(directory,'meta/_journal.json'),source.journalText,{mode:0o600,flag:'wx'});for(const file of source.files)await writeFile(join(directory,`${file.tag}.sql`),file.content,{mode:0o600,flag:'wx'});return directory;}
 catch(error){await rm(directory,{recursive:true,force:true}).catch(()=>undefined);throw error;}
}
/** Testable private snapshot primitive; callers own removal of the returned directory. */
export async function freezeEvolutionArtifacts(through,artifacts){return freezeCheckedSource(checkedArtifacts(artifacts,through));}

/** Same path for an independently guarded QA client. The production CLI never accepts client, artifact or target overrides. */
export async function runEvolutionMigrationOperator(client,{mode='audit',through,artifacts}={}){
 guard(['audit','dry-run','apply'].includes(mode),'invalid_operator_mode');const source=checkedArtifacts(artifacts??await loadEvolutionMigrationArtifacts(through),through),writing=mode!=='audit';
 let active=false,snapshotDirectory,commitStarted=false;
 try{
  await client.query(writing?'BEGIN ISOLATION LEVEL READ COMMITTED':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');active=true;
  await client.query("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='45s'; SET LOCAL idle_in_transaction_session_timeout='60s'; SET LOCAL TIME ZONE 'UTC'; SET LOCAL search_path=public; SET LOCAL standard_conforming_strings=on");
  const identity=(await client.query("SELECT current_database() AS name,current_setting('server_version_num') AS version")).rows[0];guard(identity?.name==='daybook_ticket','unexpected_database');if(Number(identity.version)>=170000)await client.query("SET LOCAL transaction_timeout='180s'");
  if(writing){guard((await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended('daybook-evolution-migrations',0)) AS locked")).rows[0]?.locked===true,'another_migration_operator_is_running');await client.query('LOCK TABLE drizzle.__drizzle_migrations IN SHARE ROW EXCLUSIVE MODE');}
  const count=validateEvolutionMigrationJournal(await journal(client),through),beforeColumns=await columns(client),beforeIndexes=await indexes(client),beforeConstraints=await constraints(client);
  if(writing){await client.query(`LOCK TABLE ${[...beforeColumns.keys()].map(table=>`public.${quote(table)}`).join(', ')} IN SHARE ROW EXCLUSIVE MODE`);guard(JSON.stringify([...(await columns(client))])===JSON.stringify([...beforeColumns])&&JSON.stringify(await indexes(client))===JSON.stringify(beforeIndexes)&&JSON.stringify(await constraints(client))===JSON.stringify(beforeConstraints),'public_schema_changed_during_locking');}
  verifySchema(beforeColumns,source,count);if(source.files.slice(7,count).some(file=>file.plan.replacesAttachmentKind))guard(beforeConstraints.some(row=>validKindConstraint(row,['request','reply','note','contract'])),'unexpected_attachment_constraint_replacement');verifyAppliedIndexes(beforeIndexes,source,count);const before=await fingerprints(client,beforeColumns),pending=source.files.slice(Math.max(7,count));
  if(mode==='audit'||!pending.length){await client.query('ROLLBACK');active=false;return {result:'PASS',mode,through,pendingMigrations:pending.map(file=>file.tag),committed:false,migration:pending.length?'pending':'already_applied_no_changes',fingerprints:before};}
  if(pending.some(file=>file.plan.replacesPushEndpoint))guard(beforeIndexes.some(row=>row.indexname==='push_subscription_endpoint'&&row.tablename==='pushSubscriptions'&&canonical(row.indexdef)===OLD_PUSH),'unexpected_push_index_replacement');
  if(pending.some(file=>file.plan.replacesAttachmentKind))guard(beforeConstraints.some(row=>validKindConstraint(row,['request','reply','note'])),'unexpected_attachment_constraint_replacement');
  snapshotDirectory=await freezeCheckedSource(source);
  const adapter=createMigrationSavepointClient(client);await migrate(drizzle({client:adapter.client,logger:false}),{migrationsFolder:snapshotDirectory});adapter.assertReleased();
  guard(validateEvolutionMigrationJournal(await journal(client),through)===source.files.length,'evolution_journal_not_applied');const afterColumns=await columns(client);verifyOriginals(beforeColumns,afterColumns,pending);verifySchema(afterColumns,source,source.files.length);verifyIndexes(beforeIndexes,await indexes(client),pending);verifyConstraints(beforeConstraints,await constraints(client),pending);
  guard(JSON.stringify(await fingerprints(client,beforeColumns))===JSON.stringify(before),'original_data_preservation_failed');const newState=await newStateCounts(client,pending);
  if(mode==='apply'){commitStarted=true;await client.query('COMMIT');}else await client.query('ROLLBACK');active=false;
  return {result:'PASS',mode,through,migration:mode==='apply'?'applied':'would_apply',committed:mode==='apply',appliedMigrations:pending.map(file=>file.tag),originalColumnsUnchanged:true,preservedTables:beforeColumns.size,preservedRows:before.reduce((sum,row)=>sum+BigInt(row.rows),0n).toString(),fingerprints:before,newState};
 }catch(error){if(active)await client.query('ROLLBACK').catch(()=>undefined);if(commitStarted)throw new MigrationOperatorError('commit_outcome_unknown');throw error;}
 finally{if(snapshotDirectory)await rm(snapshotDirectory,{recursive:true,force:true}).catch(()=>undefined);}
}
export function evolutionFailureReport(error){const candidate=error?.code??error?.cause?.code,code=error instanceof MigrationOperatorError&&/^[a-z][a-z0-9_]{0,99}$/.test(error.operatorCode)?error.operatorCode:/^[0-9A-Z]{5}$/.test(candidate||'')?candidate:'operator_failed';return{result:'FAIL',code,...(code==='commit_outcome_unknown'?{committed:'unknown',nextAction:'audit_before_any_retry'}:{})};}
async function main(){
 const options=validateEvolutionCliArguments(process.argv.slice(2),process.env),artifacts=await loadEvolutionMigrationArtifacts(options.through),connectionString=validateEvolutionProductionTargets(process.env),client=new pg.Client({connectionString,connectionTimeoutMillis:10000,query_timeout:60000,application_name:`daybook-ticket-evolution-through-${options.through}-operator`});
 try{await client.connect();console.log(JSON.stringify(await runEvolutionMigrationOperator(client,{...options,artifacts})));}finally{await client.end().catch(()=>undefined);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(JSON.stringify(evolutionFailureReport(error)));process.exitCode=1;});
