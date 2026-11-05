/** Serial coordinator: additive evolution migrations on the already isolated QA database. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import pg from 'pg';
import {drizzle} from 'drizzle-orm/node-postgres';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import {createMigrationSavepointClient} from './migrate-notifications-production.mjs';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE,'1');
for(const key of ['RESEND_API_KEY','RESEND_INBOUND_API_KEY','VAPID_PRIVATE_KEY'])assert.ok(!process.env[key]);
const url=new URL(process.env.DATABASE_URL);assert.equal(url.hostname,'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');assert.equal(url.pathname,'/daybook_ticket');
url.hostname='ep-falling-water-bbfa4ijl.c-15.us-east-1.aws.neon.tech';url.searchParams.set('sslmode','verify-full');
const journal=JSON.parse(await readFile('drizzle-postgres/meta/_journal.json','utf8'));
const sources=await Promise.all(journal.entries.map(async(entry,index)=>{assert.equal(entry.idx,index);const source=await readFile(`drizzle-postgres/${entry.tag}.sql`,'utf8');if(index>=7)assert.ok(!/(?:^|;)\s*(DROP|DELETE|UPDATE|TRUNCATE)\b/im.test(source),'Evolution migrations must preserve existing data.');return {...entry,hash:createHash('sha256').update(source).digest('hex')};}));
const client=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:10000});
const quote=value=>`"${value.replaceAll('"','""')}"`;
async function fingerprint(tables){
 const result=[];
 for(const [table,columns] of tables){const row=(await client.query(`SELECT count(*)::text AS rows,encode(sha256(convert_to(COALESCE(string_agg(h,'' ORDER BY h COLLATE "C"),''),'UTF8')),'hex') AS sha256 FROM (SELECT encode(sha256(convert_to(jsonb_build_array(${columns.map(quote).join(',')})::text,'UTF8')),'hex') AS h FROM public.${quote(table)}) r`)).rows[0];result.push({table,...row});}
 return result;
}
try{
 await client.connect();await client.query("BEGIN;SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='45s';SET LOCAL transaction_timeout='180s'");
 await client.query("SELECT pg_advisory_xact_lock(hashtextextended('daybook-evolution-migrations',0))");
 const columns=(await client.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name COLLATE \"C\",ordinal_position")).rows,tables=new Map();
 for(const row of columns)tables.set(row.table_name,[...(tables.get(row.table_name)||[]),row.column_name]);
 if(tables.size)await client.query(`LOCK TABLE ${[...tables.keys()].map(table=>`public.${quote(table)}`).join(',')} IN SHARE ROW EXCLUSIVE MODE`);
 const before=await fingerprint(tables),recorded=(await client.query('SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id')).rows;
 assert.ok(recorded.length<=sources.length);recorded.forEach((row,index)=>{assert.equal(row.hash,sources[index].hash);assert.equal(String(row.created_at),String(sources[index].when));});
 const adapter=createMigrationSavepointClient(client);await migrate(drizzle({client:adapter.client}),{migrationsFolder:'./drizzle-postgres'});adapter.assertReleased();
 assert.deepEqual(await fingerprint(tables),before,'All preexisting rows and original columns must remain identical.');
 assert.equal((await client.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations')).rows[0].n,sources.length);
 const apply=process.argv.includes('--apply');await client.query(apply?'COMMIT':'ROLLBACK');await mkdir('work',{recursive:true});
 const result={result:'PASS',applied:apply,migrations:sources.length,preservedTables:tables.size,preservedRows:before.reduce((sum,row)=>sum+Number(row.rows),0),originalColumnsUnchanged:true};
 await writeFile(`work/evolution-migration-${apply?'applied':'rehearsed'}.json`,JSON.stringify({...result,fingerprints:before},null,2),{mode:0o600});console.log(JSON.stringify(result));
}catch(error){await client.query('ROLLBACK').catch(()=>undefined);console.error(JSON.stringify({result:'FAIL',code:error.code||error.name,message:error instanceof assert.AssertionError?error.message:undefined}));process.exitCode=1;}finally{await client.end();}
