import type { PoolClient } from 'pg';
import { z } from 'zod';
import { ApiError, db } from './server';
import { requireAdmin, requireStaff, type AccessContext } from './access';
import { lockAccess, lockTicket, operationHash, recordEvent } from './ticket-mutations';
import { acquireTicketWorkLock } from './work-lock';
import { catalogMutationSchema, catalogPatchSchema, organizationSubmissionSchema, ticketOrganizationPatchSchema, taskCreateSchema, taskPatchSchema, savedViewSchema, selectCompanyForm, validateOrganizationValues, visibleOrganization, type CatalogItem, type CatalogKind, type FieldSnapshot, type OrganizationCatalog, type PreparedOrganization, type TicketOrganization, type TicketTask, type SavedTicketView } from './work-organization-model';

type CatalogRow = { id: string; kind: CatalogKind; name: string; version: number; archived: boolean; definitionJson: string; createdAt: string; updatedAt: string };
const EMPTY: PreparedOrganization = { requestType: null, form: null, values: {} };
const CATALOG_COLUMNS = 'id,kind,name,version,archived,"definitionJson","createdAt","updatedAt"';
const staffRole = (access: AccessContext) => access.role !== 'client';
const item = (row: CatalogRow): CatalogItem => ({ id: row.id, kind: row.kind, name: row.name, version: row.version, archived: row.archived, definition: JSON.parse(row.definitionJson), createdAt: row.createdAt, updatedAt: row.updatedAt });
function fail(message: string): never { throw new ApiError(400,message); }
export function parseOrganizationCatalogQuery(params: URLSearchParams) {
  return z.object({ kind: z.enum(['tag','requestType','field','form']).optional(), q: z.string().trim().max(100).default(''), cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(50), includeArchived: z.enum(['true','false']).default('false'), customerCompanyId: z.string().uuid().optional() }).parse(Object.fromEntries(params));
}
async function company(tx: PoolClient, access: AccessContext, id: string | null) {
  if (id) {
    const { rows } = await tx.query('SELECT id FROM "customerCompanies" WHERE id=$1 AND "ownerId"=$2 AND "organizationId"=$3 FOR SHARE',[id,access.ownerId,access.organizationId]);
    if (!rows[0]) fail('Selecciona una empresa de este espacio.');
  }
}
async function catalog(tx: PoolClient, ownerId: string): Promise<OrganizationCatalog> {
  const { rows } = await tx.query(`SELECT ${CATALOG_COLUMNS} FROM "workOrganizationCatalog" WHERE "ownerId"=$1 AND NOT archived ORDER BY kind,name,id LIMIT 400`,[ownerId]);
  const values = rows.map(row => item(row as CatalogRow));
  return { tags: values.filter(v=>v.kind==='tag'), requestTypes: values.filter(v=>v.kind==='requestType'), fields: values.filter(v=>v.kind==='field'), forms: values.filter(v=>v.kind==='form') } as unknown as OrganizationCatalog;
}
function publicCatalog(value: OrganizationCatalog, companyId: string | null): OrganizationCatalog {
  const forms = value.forms.filter(v=>!v.archived && v.definition.published && (v.definition.customerCompanyId===null || v.definition.customerCompanyId===companyId)).map(v=>{
    const fields=v.definition.fields.filter(f=>f.visibility==='public');
    return {...v,definition:{...v.definition,fields,fieldIds:fields.map(f=>f.id)}};
  });
  const typeIds=new Set(forms.map(v=>v.definition.requestTypeId));
  const definitions=new Map<string,FieldSnapshot>();for(const form of forms) for(const field of form.definition.fields) definitions.set(`${field.id}:${field.version}`,field);
  return {tags:[],requestTypes:value.requestTypes.filter(v=>!v.archived && typeIds.has(v.id)),forms,fields:[...definitions.values()].map(f=>({id:f.id,kind:'field',name:f.name,version:f.version,archived:false,definition:f,createdAt:'',updatedAt:''}))};
}
export async function readOrganizationCatalog(access: AccessContext, query: ReturnType<typeof parseOrganizationCatalogQuery>) {
  return db().transaction(async tx=>{
    const fresh=await lockAccess(tx,access);
    const companyId=fresh.role==='client'?fresh.member.customerCompanyId:query.customerCompanyId??null;
    if(fresh.role!=='client' && companyId) await company(tx,fresh,companyId);
    const all=await catalog(tx,fresh.ownerId);
    const visible=fresh.role==='client'?publicCatalog(all,companyId):all;
    if(staffRole(fresh)) {
      const values=[fresh.ownerId,query.kind??null,query.q,query.includeArchived==='true'];
      const where='"ownerId"=$1 AND ($2::text IS NULL OR kind=$2) AND ($3=\'\' OR strpos(lower(name),lower($3))>0) AND ($4::boolean OR NOT archived)';
      const count=await tx.query(`SELECT count(*)::integer AS count FROM "workOrganizationCatalog" WHERE ${where}`,values);
      const page=await tx.query(`SELECT ${CATALOG_COLUMNS} FROM "workOrganizationCatalog" WHERE ${where} AND ($5::text IS NULL OR id>$5) ORDER BY id LIMIT $6`,[...values,query.cursor??null,query.limit+1]);
      return {catalog:visible,items:page.rows.slice(0,query.limit).map(v=>item(v)),nextCursor:page.rows.length>query.limit?page.rows[query.limit-1].id:null,total:count.rows[0].count};
    }
    const name=query.q.toLocaleLowerCase('es');
    const matching=Object.values(visible).flat().filter(v=>(!query.kind||v.kind===query.kind)&&(!name||v.name.toLocaleLowerCase('es').includes(name))).sort((a,b)=>a.id.localeCompare(b.id));
    const page=matching.filter(v=>!query.cursor||v.id>query.cursor).slice(0,query.limit+1);
    return {catalog:visible,items:page.slice(0,query.limit),nextCursor:page.length>query.limit?page[query.limit-1].id:null,total:matching.length};
  });
}
async function resolvedDefinition(tx: PoolClient, access: AccessContext, input: z.output<typeof catalogMutationSchema>): Promise<Record<string,unknown>> {
  if(input.kind!=='form') return input.definition;
  const definition=input.definition;
  await company(tx,access,definition.customerCompanyId);
  const {rows:types}=await tx.query('SELECT id FROM "workOrganizationCatalog" WHERE id=$1 AND "ownerId"=$2 AND kind=\'requestType\' AND NOT archived FOR SHARE',[definition.requestTypeId,access.ownerId]);
  if(!types[0]) fail('Selecciona un tipo de solicitud activo.');
  const {rows:fields}=await tx.query(`SELECT ${CATALOG_COLUMNS} FROM "workOrganizationCatalog" WHERE "ownerId"=$1 AND kind='field' AND NOT archived AND id=ANY($2::text[]) FOR SHARE`,[access.ownerId,definition.fieldIds]);
  if(fields.length!==definition.fieldIds.length) fail('Uno de los campos ya no está disponible.');
  const map=new Map(fields.map(row=>[row.id,item(row as CatalogRow)]));
  return {...definition,fields:definition.fieldIds.map(id=>{const field=map.get(id)!;return {...field.definition,id,version:field.version};})};
}
export async function createOrganizationCatalog(access: AccessContext, input: z.output<typeof catalogMutationSchema>) {
  return db().transaction(async tx=>{
    await acquireTicketWorkLock(tx,access.ownerId);
    const fresh=requireAdmin(await lockAccess(tx,access));
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`organization-catalog:${fresh.ownerId}`]);
    const count=await tx.query('SELECT count(*)::integer AS count FROM "workOrganizationCatalog" WHERE "ownerId"=$1 AND kind=$2',[fresh.ownerId,input.kind]);
    if(count.rows[0].count>=1000) throw new ApiError(409,'El catálogo alcanzó su límite de 1.000 entradas por tipo.');
    const active=await tx.query('SELECT count(*)::integer AS count FROM "workOrganizationCatalog" WHERE "ownerId"=$1 AND kind=$2 AND NOT archived',[fresh.ownerId,input.kind]);
    if(active.rows[0].count>=100) throw new ApiError(409,'Archiva una entrada antes de superar 100 activas por tipo.');
    const definition=await resolvedDefinition(tx,fresh,input),now=new Date().toISOString(),id=crypto.randomUUID();
    const duplicate=await tx.query('SELECT id FROM "workOrganizationCatalog" WHERE "ownerId"=$1 AND kind=$2 AND lower(name)=lower($3) AND NOT archived',[fresh.ownerId,input.kind,input.definition.name]);
    if(duplicate.rows.length) throw new ApiError(409,'Ya existe una entrada activa con ese nombre.');
    const {rows}=await tx.query(`INSERT INTO "workOrganizationCatalog" (id,"ownerId",kind,name,"definitionJson",version,archived,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,0,false,$6,$6) RETURNING ${CATALOG_COLUMNS}`,[id,fresh.ownerId,input.kind,input.definition.name,JSON.stringify(definition),now]);
    await tx.query('INSERT INTO "workOrganizationRevisions" ("catalogId",version,"ownerId","definitionJson","createdAt") VALUES ($1,0,$2,$3,$4)',[id,fresh.ownerId,JSON.stringify(definition),now]);
    return item(rows[0]);
  });
}
export async function patchOrganizationCatalog(access: AccessContext, input: z.output<typeof catalogPatchSchema>) {
  return db().transaction(async tx=>{
    await acquireTicketWorkLock(tx,access.ownerId);
    const fresh=requireAdmin(await lockAccess(tx,access));
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`organization-catalog:${fresh.ownerId}`]);
    const {rows}=await tx.query(`SELECT ${CATALOG_COLUMNS} FROM "workOrganizationCatalog" WHERE id=$1 AND "ownerId"=$2 FOR UPDATE`,[input.id,fresh.ownerId]);
    const old=rows[0] as CatalogRow|undefined;
    if(!old) throw new ApiError(404,'La entrada no existe.');
    if(old.version!==input.expectedVersion) throw new ApiError(409,'La entrada cambió. Actualiza antes de guardar.');
    const parsed=input.definition===undefined?null:catalogMutationSchema.parse({kind:old.kind,definition:input.definition});
    const definition=parsed?await resolvedDefinition(tx,fresh,parsed):JSON.parse(old.definitionJson);
    const archived=input.archived??old.archived,now=new Date().toISOString();
    if(!archived) {
      const count=await tx.query('SELECT count(*)::integer AS count FROM "workOrganizationCatalog" WHERE "ownerId"=$1 AND kind=$2 AND NOT archived AND id<>$3',[fresh.ownerId,old.kind,old.id]);
      if(count.rows[0].count>=100) throw new ApiError(409,'Se alcanzó el límite de entradas activas.');
      const duplicate=await tx.query('SELECT id FROM "workOrganizationCatalog" WHERE "ownerId"=$1 AND kind=$2 AND lower(name)=lower($3) AND NOT archived AND id<>$4',[fresh.ownerId,old.kind,definition.name,old.id]);
      if(duplicate.rows.length) throw new ApiError(409,'Ya existe una entrada activa con ese nombre.');
    }
    const updated=await tx.query(`UPDATE "workOrganizationCatalog" SET name=$1,"definitionJson"=$2,archived=$3,version=version+1,"updatedAt"=$4 WHERE id=$5 RETURNING ${CATALOG_COLUMNS}`,[definition.name,JSON.stringify(definition),archived,now,old.id]);
    await tx.query('INSERT INTO "workOrganizationRevisions" ("catalogId",version,"ownerId","definitionJson","createdAt") VALUES ($1,$2,$3,$4,$5)',[old.id,old.version+1,fresh.ownerId,JSON.stringify(definition),now]);
    return item(updated.rows[0]);
  });
}

/** Call within ticket creation's existing transaction, after requester/company resolution. */
export async function prepareTicketOrganization(tx: PoolClient, access: AccessContext, input: { customerCompanyId: string|null; requestTypeId?: string|null; fieldValues?: Record<string,string|boolean|null> }): Promise<PreparedOrganization> {
  const parsed=organizationSubmissionSchema.parse({requestTypeId:input.requestTypeId,fieldValues:input.fieldValues??{}}),submitted=parsed.fieldValues??{};
  if(!parsed.requestTypeId) {if(Object.keys(submitted).length) fail('Selecciona un tipo de solicitud para enviar estos campos.');return structuredClone(EMPTY);}
  const all=await catalog(tx,access.ownerId);
  const type=all.requestTypes.find(v=>v.id===parsed.requestTypeId&&!v.archived);
  if(!type) fail('El tipo de solicitud ya no está disponible.');
  const form=selectCompanyForm(all.forms,type.id,input.customerCompanyId,staffRole(access));
  if(!form && !staffRole(access)) fail('El formulario ya no está publicado para tu empresa.');
  if(!form && Object.keys(submitted).length) fail('Este tipo no tiene formulario para esa empresa.');
  let values: PreparedOrganization['values'];
  try {values=validateOrganizationValues(form?.definition.fields??[],submitted,staffRole(access));} catch(error) {fail(error instanceof Error?error.message:'Revisa el formulario.');}
  if(!staffRole(access)) for(const field of form?.definition.fields??[]) if(field.visibility==='internal') values![field.id]={definition:structuredClone(field),value:null};
  return {requestType:{id:type.id,name:type.name,version:type.version},form:form?{id:form.id,name:form.name,version:form.version,published:form.definition.published,customerCompanyId:form.definition.customerCompanyId}:null,values:values!};
}
export async function saveTicketOrganization(tx: PoolClient, access: AccessContext, ticketId: number, prepared: PreparedOrganization) {
  await tx.query('INSERT INTO "ticketOrganization" ("ticketId","ownerId","metadataJson","updatedAt") VALUES ($1,$2,$3,$4)',[ticketId,access.ownerId,JSON.stringify(prepared),new Date().toISOString()]);
}
async function readTicketOrganizationTx(tx: PoolClient, access: AccessContext, ticketId: number): Promise<TicketOrganization> {
  const ticket=await lockTicket(tx,access,ticketId);
  const {rows}=await tx.query('SELECT * FROM "ticketOrganization" WHERE "ticketId"=$1 AND "ownerId"=$2',[ticketId,access.ownerId]);
  const row=rows[0],prepared:PreparedOrganization=row?JSON.parse(row.metadataJson):structuredClone(EMPTY);
  const metadata=access.role==='client'&&prepared.form?.customerCompanyId&&prepared.form.customerCompanyId!==ticket.customerCompanyId?EMPTY:visibleOrganization(prepared,staffRole(access));
  const ids: string[]=row?JSON.parse(row.tagIdsJson):[];
  const tags=staffRole(access)&&ids.length?(await tx.query(`SELECT ${CATALOG_COLUMNS} FROM "workOrganizationCatalog" WHERE "ownerId"=$1 AND kind='tag' AND id=ANY($2::text[]) ORDER BY name,id`,[access.ownerId,ids])).rows.map(v=>item(v)) : [];
  return {...metadata,customerCompanyId:ticket.customerCompanyId,version:row?.version??0,tags:tags as TicketOrganization['tags'],...(staffRole(access)?{waitReason:row?.waitReason??''}:{})};
}
export async function readTicketOrganization(access: AccessContext, ticketId: number) {return db().transaction(async tx=>{await acquireTicketWorkLock(tx,access.ownerId);return readTicketOrganizationTx(tx,await lockAccess(tx,access),ticketId);});}
export async function patchTicketOrganization(access: AccessContext,ticketId:number,input:z.output<typeof ticketOrganizationPatchSchema>) {
  return db().transaction(async tx=>{
    await acquireTicketWorkLock(tx,access.ownerId);
    const fresh=requireStaff(await lockAccess(tx,access)),ticket=await lockTicket(tx,fresh,ticketId),old=await readTicketOrganizationTx(tx,fresh,ticketId);
    if(old.version!==input.expectedVersion) throw new ApiError(409,'La organización del ticket cambió. Actualiza antes de guardar.');
    let metadata:PreparedOrganization={requestType:old.requestType,form:old.form,values:old.values};
    if(input.requestTypeId!==undefined&&input.requestTypeId!==old.requestType?.id) metadata=await prepareTicketOrganization(tx,fresh,{customerCompanyId:ticket.customerCompanyId,requestTypeId:input.requestTypeId,fieldValues:input.fieldValues??{}});
    else if(input.fieldValues!==undefined) {
      const merged=Object.fromEntries(Object.entries(old.values).map(([key,v])=>[key,v.value]));
      try {metadata.values=validateOrganizationValues(Object.values(old.values).map(v=>v.definition),{...merged,...input.fieldValues},true);} catch(error) {fail(error instanceof Error?error.message:'Revisa los campos.');}
    }
    let tagIds=input.tagIds?[...new Set(input.tagIds)]:old.tags.map(v=>v.id);
    if(input.tagIds) {
      const current=new Set(old.tags.map(v=>v.id));
      const {rows}=await tx.query('SELECT id,archived FROM "workOrganizationCatalog" WHERE "ownerId"=$1 AND kind=\'tag\' AND id=ANY($2::text[])',[access.ownerId,tagIds]);
      if(rows.length!==tagIds.length||rows.some(v=>v.archived&&!current.has(v.id))) fail('Selecciona etiquetas activas de este espacio.');
      tagIds=rows.map(v=>v.id);
    }
    const now=new Date().toISOString(),waitReason=input.waitReason??old.waitReason??'';
    await tx.query(`INSERT INTO "ticketOrganization" ("ticketId","ownerId","metadataJson","tagIdsJson","waitReason",version,"updatedAt") VALUES ($1,$2,$3,$4,$5,1,$6)
      ON CONFLICT ("ticketId") DO UPDATE SET "metadataJson"=EXCLUDED."metadataJson","tagIdsJson"=EXCLUDED."tagIdsJson","waitReason"=EXCLUDED."waitReason",version="ticketOrganization".version+1,"updatedAt"=EXCLUDED."updatedAt"`,[ticketId,access.ownerId,JSON.stringify(metadata),JSON.stringify(tagIds),waitReason,now]);
    const names=tagIds.length?(await tx.query('SELECT name FROM "workOrganizationCatalog" WHERE "ownerId"=$1 AND id=ANY($2::text[]) ORDER BY name',[access.ownerId,tagIds])).rows.map(v=>v.name):[];
    const summary=(type:string|undefined,tags:string[],reason:string)=>`${type||'Solicitud general'} · Etiquetas: ${tags.join(', ')||'ninguna'} · Espera: ${reason||'sin motivo'}`;
    await recordEvent(tx,fresh,ticketId,'organization',summary(old.requestType?.name,old.tags.map(v=>v.name),old.waitReason??''),summary(metadata.requestType?.name,names,waitReason));
    await tx.query('UPDATE tickets SET version=version+1,"updatedAt"=$1 WHERE id=$2 AND "ownerId"=$3',[now,ticketId,access.ownerId]);
    return readTicketOrganizationTx(tx,fresh,ticketId);
  });
}
const TASK_COLUMNS='t.id,t."ticketId",t.title,t."assigneeMemberId",m.name AS "assigneeName",t."dueAt",t.status,t.version,t."createdAt",t."updatedAt"';
async function assignee(tx:PoolClient,access:AccessContext,id:string|null) {
  if(!id) return;
  const {rows}=await tx.query('SELECT id FROM members WHERE id=$1 AND "ownerId"=$2 AND "organizationId"=$3 AND status=\'active\' AND "userId" IS NOT NULL AND role IN (\'owner\',\'admin\',\'agent\') FOR SHARE',[id,access.ownerId,access.organizationId]);
  if(!rows[0]) fail('Selecciona un integrante activo del equipo.');
}
export async function listTicketTasks(access:AccessContext,ticketId:number,cursor:string|null=null,limit=50) {
  if(cursor&&!z.string().uuid().safeParse(cursor).success||!Number.isInteger(limit)||limit<1||limit>100) fail('La página de tareas no es válida.');
  return db().transaction(async tx=>{
    await acquireTicketWorkLock(tx,access.ownerId);
    const fresh=requireStaff(await lockAccess(tx,access));await lockTicket(tx,fresh,ticketId);
    const {rows}=await tx.query(`SELECT ${TASK_COLUMNS} FROM "ticketTasks" t LEFT JOIN members m ON m.id=t."assigneeMemberId" AND m."ownerId"=t."ownerId" WHERE t."ownerId"=$1 AND t."ticketId"=$2 AND ($3::text IS NULL OR (t."createdAt",t.id)<(SELECT "createdAt",id FROM "ticketTasks" WHERE id=$3 AND "ownerId"=$1 AND "ticketId"=$2)) ORDER BY t."createdAt" DESC,t.id DESC LIMIT $4`,[access.ownerId,ticketId,cursor,limit+1]);
    return {items:rows.slice(0,limit) as TicketTask[],nextCursor:rows.length>limit?rows[limit-1].id:null};
  });
}
export async function createTicketTask(access:AccessContext,ticketId:number,input:z.output<typeof taskCreateSchema>) {
  return db().transaction(async tx=>{
    await acquireTicketWorkLock(tx,access.ownerId);
    const fresh=requireStaff(await lockAccess(tx,access));await assignee(tx,fresh,input.assigneeMemberId);await lockTicket(tx,fresh,ticketId);
    const hash=operationHash({ticketId,...input}),old=await tx.query('SELECT id,"requestHash","createdByMemberId","ticketId" FROM "ticketTasks" WHERE "ownerId"=$1 AND "operationId"=$2 FOR UPDATE',[access.ownerId,input.operationId]);
    if(old.rows[0]) {
      if(old.rows[0].requestHash!==hash||old.rows[0].createdByMemberId!==fresh.member.id||old.rows[0].ticketId!==ticketId) throw new ApiError(409,'Esta operación ya se utilizó con otros datos.');
      return (await tx.query(`SELECT ${TASK_COLUMNS} FROM "ticketTasks" t LEFT JOIN members m ON m.id=t."assigneeMemberId" AND m."ownerId"=t."ownerId" WHERE t.id=$1`,[old.rows[0].id])).rows[0] as TicketTask;
    }
    const count=await tx.query('SELECT count(*)::integer AS count FROM "ticketTasks" WHERE "ownerId"=$1 AND "ticketId"=$2',[access.ownerId,ticketId]);
    if(count.rows[0].count>=1000) throw new ApiError(409,'El ticket alcanzó su límite de tareas.');
    const now=new Date().toISOString(),id=crypto.randomUUID();
    await tx.query('INSERT INTO "ticketTasks" (id,"ownerId","ticketId","createdByMemberId","operationId","requestHash",title,"assigneeMemberId","dueAt","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)',[id,access.ownerId,ticketId,fresh.member.id,input.operationId,hash,input.title,input.assigneeMemberId,input.dueAt,now]);
    await recordEvent(tx,fresh,ticketId,'task_created',null,input.title);
    await tx.query('UPDATE tickets SET version=version+1,"updatedAt"=$1 WHERE id=$2',[now,ticketId]);
    return (await tx.query(`SELECT ${TASK_COLUMNS} FROM "ticketTasks" t LEFT JOIN members m ON m.id=t."assigneeMemberId" AND m."ownerId"=t."ownerId" WHERE t.id=$1`,[id])).rows[0] as TicketTask;
  });
}
export async function patchTicketTask(access:AccessContext,id:string,input:z.output<typeof taskPatchSchema>) {
  return db().transaction(async tx=>{
    await acquireTicketWorkLock(tx,access.ownerId);const fresh=requireStaff(await lockAccess(tx,access));
    const {rows}=await tx.query('SELECT * FROM "ticketTasks" WHERE id=$1 AND "ownerId"=$2 FOR UPDATE',[id,access.ownerId]);const old=rows[0];
    if(!old) throw new ApiError(404,'La tarea no existe.');
    if(input.assigneeMemberId!==undefined&&input.assigneeMemberId!==old.assigneeMemberId) await assignee(tx,fresh,input.assigneeMemberId);
    await lockTicket(tx,fresh,old.ticketId);
    if(old.version!==input.expectedVersion) throw new ApiError(409,'La tarea cambió. Actualiza antes de guardar.');
    const next={title:input.title??old.title,assigneeMemberId:input.assigneeMemberId===undefined?old.assigneeMemberId:input.assigneeMemberId,dueAt:input.dueAt===undefined?old.dueAt:input.dueAt,status:input.status??old.status},now=new Date().toISOString();
    await tx.query('UPDATE "ticketTasks" SET title=$1,"assigneeMemberId"=$2,"dueAt"=$3,status=$4,version=version+1,"updatedAt"=$5 WHERE id=$6',[next.title,next.assigneeMemberId,next.dueAt,next.status,now,id]);
    const labels:Record<string,string>={open:'Pendiente',done:'Completada',cancelled:'Cancelada'};
    await recordEvent(tx,fresh,old.ticketId,'task_updated',`${old.title} · ${labels[old.status]}`,`${next.title} · ${labels[next.status]}`);
    await tx.query('UPDATE tickets SET version=version+1,"updatedAt"=$1 WHERE id=$2',[now,old.ticketId]);
    return (await tx.query(`SELECT ${TASK_COLUMNS} FROM "ticketTasks" t LEFT JOIN members m ON m.id=t."assigneeMemberId" AND m."ownerId"=t."ownerId" WHERE t.id=$1`,[id])).rows[0] as TicketTask;
  });
}
export async function savedTicketViews(access:AccessContext) {return db().transaction(async tx=>{
  const fresh=await lockAccess(tx,access);const {rows}=await tx.query('SELECT id,name,"filtersJson",version FROM "savedTicketViews" WHERE "ownerId"=$1 AND "memberId"=$2 ORDER BY name,id LIMIT 50',[fresh.ownerId,fresh.member.id]);
  return rows.map(v=>({id:v.id,name:v.name,filters:JSON.parse(v.filtersJson),version:v.version})) as SavedTicketView[];
});}
export async function saveTicketView(access:AccessContext,input:z.output<typeof savedViewSchema>,id?:string,expectedVersion?:number) {
  return db().transaction(async tx=>{
    const fresh=await lockAccess(tx,access),now=new Date().toISOString();
    if(fresh.role==='client'&&['company','agent','department','priority'].some(key=>input.filters[key as keyof typeof input.filters]!=='all')) fail('Las vistas de cliente solo admiten búsqueda y estado.');
    const {rows:current}=await tx.query('SELECT id,version FROM "savedTicketViews" WHERE "ownerId"=$1 AND "memberId"=$2 ORDER BY id FOR UPDATE',[fresh.ownerId,fresh.member.id]);
    if(!id&&current.length>=50) throw new ApiError(409,'Puedes guardar hasta 50 vistas personales.');
    if(id&&!current.some(v=>v.id===id)) throw new ApiError(404,'La vista no existe.');
    if(id&&current.find(v=>v.id===id)?.version!==expectedVersion) throw new ApiError(409,'La vista cambió. Actualiza antes de guardar.');
    const duplicate=await tx.query('SELECT id FROM "savedTicketViews" WHERE "memberId"=$1 AND name=$2 AND ($3::text IS NULL OR id<>$3)',[fresh.member.id,input.name,id??null]);
    if(duplicate.rows.length) throw new ApiError(409,'Ya tienes una vista con ese nombre.');
    const values=id?await tx.query('UPDATE "savedTicketViews" SET name=$1,"filtersJson"=$2,version=version+1,"updatedAt"=$3 WHERE id=$4 AND "ownerId"=$5 AND "memberId"=$6 RETURNING id,name,"filtersJson",version',[input.name,JSON.stringify(input.filters),now,id,fresh.ownerId,fresh.member.id]):await tx.query('INSERT INTO "savedTicketViews" (id,"ownerId","memberId",name,"filtersJson","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id,name,"filtersJson",version',[crypto.randomUUID(),fresh.ownerId,fresh.member.id,input.name,JSON.stringify(input.filters),now]);
    const row=values.rows[0];return {id:row.id,name:row.name,filters:JSON.parse(row.filtersJson),version:row.version} as SavedTicketView;
  });
}
export async function deleteTicketView(access:AccessContext,id:string,expectedVersion:number) {return db().transaction(async tx=>{
  const fresh=await lockAccess(tx,access);const {rows}=await tx.query('DELETE FROM "savedTicketViews" WHERE id=$1 AND "ownerId"=$2 AND "memberId"=$3 AND version=$4 RETURNING id',[id,fresh.ownerId,fresh.member.id,expectedVersion]);
  if(!rows.length) throw new ApiError(409,'La vista cambió o ya no está disponible.');return {ok:true};
});}
