import { createHash,randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { Database } from '../db/database';
import { requireStaff,type AccessContext } from './access';
import { ApiError,db } from './server';
import { lockAccess } from './ticket-mutations';
import { runKnowledgeOperation } from './knowledge';
import { productionTicketSql } from './test-data';
import type { MetricsQuery } from './agent-metrics-model';
import { companyReportSchema,monthlyReportPeriod,type CompanyOperationalReport,type CompanyMonthlyReport,monthlyReportCreateSchema } from './knowledge-model';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
async function company(tx:PoolClient,access:AccessContext,companyId:string|null) {
 if(!companyId||!z.string().uuid().safeParse(companyId).success)throw new ApiError(400,'Selecciona una empresa.');
 const row=(await tx.query<{id:string;name:string}>('SELECT id,name FROM "customerCompanies" WHERE id=$1 AND "ownerId"=$2 AND "organizationId"=$3 FOR SHARE',[companyId,access.ownerId,access.organizationId])).rows[0];
 if(!row)throw new ApiError(404,'La empresa no existe en este espacio.');return row;
}
/** One SQL snapshot; only bounded aggregates leave PostgreSQL. Outcomes retain their original SLA snapshots. */
async function aggregate(tx:PoolClient,access:AccessContext,period:MetricsQuery,now:Date):Promise<CompanyOperationalReport> {
 const current=await company(tx,access,period.companyId);
 const query=`WITH scoped AS (
  SELECT t.id,t.status,t."createdAt",t."dueAt" FROM tickets t WHERE t."ownerId"=$1 AND t."customerCompanyId"=$2 AND ($5::boolean OR ${productionTicketSql('t')})
 ), created AS (SELECT * FROM scoped WHERE "createdAt">=$3 AND "createdAt"<$4), outcomes AS (
  SELECT o.* FROM "ticketSlaOutcomes" o JOIN tickets t ON t.id=o."ticketId" AND t."ownerId"=o."ownerId" WHERE o."ownerId"=$1 AND o."customerCompanyId"=$2 AND o."resolvedAt">=$3 AND o."resolvedAt"<$4 AND ($5::boolean OR ${productionTicketSql('t')})
 ), typed AS (
  SELECT COALESCE(NULLIF(o."metadataJson"::jsonb->'requestType'->>'name',''),'Sin tipo registrado') AS label,count(*)::int AS count FROM created t LEFT JOIN "ticketOrganization" o ON o."ticketId"=t.id AND o."ownerId"=$1 GROUP BY 1
 ), ranked_types AS (SELECT *,row_number() OVER(ORDER BY count DESC,label) AS n FROM typed), type_rows AS (
  SELECT label,count FROM ranked_types WHERE n<=50 UNION ALL SELECT 'Otros tipos',sum(count)::int FROM ranked_types WHERE n>50 HAVING count(*)>0
 ), asset_groups AS (
  SELECT a.id,a.name || ' · ' || left(a.id,8) AS label,count(DISTINCT t.id)::int AS count FROM created t JOIN "ticketAssetLinks" l ON l."ticketId"=t.id AND l."ownerId"=$1 JOIN "customerAssets" a ON a.id=l."assetId" AND a."ownerId"=$1 AND a."companyId"=$2 GROUP BY a.id,a.name
 ), ranked_assets AS (SELECT *,row_number() OVER(ORDER BY count DESC,label,id) AS n FROM asset_groups), asset_rows AS (
  SELECT label,count FROM ranked_assets WHERE n<=50 UNION ALL SELECT 'Otros equipos',sum(count)::int FROM ranked_assets WHERE n>50 HAVING count(*)>0
 ), daily AS (SELECT to_char("createdAt"::timestamptz AT TIME ZONE 'America/Santiago','YYYY-MM-DD') AS label,count(*)::int AS count FROM created GROUP BY 1)
 SELECT json_build_object(
  'created',(SELECT count(*)::int FROM created),
  'currentOpen',(SELECT count(*)::int FROM scoped WHERE status='open'),
  'currentPending',(SELECT count(*)::int FROM scoped WHERE status='pending'),
  'currentOverdue',(SELECT count(*)::int FROM scoped WHERE status IN ('open','pending') AND "dueAt"<$6),
  'resolutions',(SELECT count(*)::int FROM outcomes),
  'slaMet',(SELECT count(*)::int FROM outcomes WHERE "resolvedAt"<="dueAt"),
  'slaBreached',(SELECT count(*)::int FROM outcomes WHERE "resolvedAt">"dueAt"),
  'slaCompliancePercent',(SELECT CASE WHEN count(*)>0 THEN 100.0*count(*) FILTER(WHERE "resolvedAt"<="dueAt")/count(*) ELSE NULL END FROM outcomes),
  'publicReplies',(SELECT count(*)::int FROM messages m JOIN scoped t ON t.id=m."ticketId" WHERE m."ownerId"=$1 AND m.kind='reply' AND m."authorRole" IN ('owner','admin','agent') AND m."createdAt">=$3 AND m."createdAt"<$4),
  'unknownResolved',(SELECT count(*)::int FROM scoped t WHERE status='resolved' AND NOT EXISTS(SELECT 1 FROM "ticketSlaOutcomes" o WHERE o."ownerId"=$1 AND o."ticketId"=t.id)),
  'untyped',(SELECT count(*)::int FROM created t LEFT JOIN "ticketOrganization" o ON o."ticketId"=t.id AND o."ownerId"=$1 WHERE NULLIF(o."metadataJson"::jsonb->'requestType'->>'name','') IS NULL),
  'withoutAsset',(SELECT count(*)::int FROM created t WHERE NOT EXISTS(SELECT 1 FROM "ticketAssetLinks" l JOIN "customerAssets" a ON a.id=l."assetId" AND a."ownerId"=l."ownerId" WHERE l."ownerId"=$1 AND l."ticketId"=t.id AND a."companyId"=$2))
 ) AS summary,
 COALESCE((SELECT json_agg(json_build_object('label',label,'count',count) ORDER BY count DESC,label) FROM type_rows),'[]'::json) AS "byType",
 COALESCE((SELECT json_agg(json_build_object('label',label,'count',count) ORDER BY count DESC,label) FROM asset_rows),'[]'::json) AS "byAsset",
 COALESCE((SELECT json_agg(json_build_object('label',label,'count',count) ORDER BY label) FROM daily),'[]'::json) AS "byDay"`;
 const values=[access.ownerId,current.id,period.fromInstant,period.untilInstant,period.includeTests===true,now.toISOString()],row=(await tx.query(query,values)).rows[0];
 return companyReportSchema.parse({companyId:current.id,companyName:current.name,period:{...period,timeZone:'America/Santiago'},generatedAt:now.toISOString(),...row,coverageNotes:[
  'La carga abierta, pendiente y vencida es actual; las entradas y respuestas corresponden al período seleccionado.',
  'El SLA usa exclusivamente resoluciones registradas con su plazo congelado. No se han reconstruido mediciones históricas.',
  'Los tipos usan el nombre guardado en el ticket. Los equipos reflejan los vínculos actuales; un ticket puede relacionarse con varios equipos.',
  'Las tablas muestran hasta 50 tipos o equipos y agrupan el resto. No incluyen conversaciones, solicitantes, notas ni documentos.',
 ]});
}
export async function getCompanyOperationalReport(access:AccessContext,period:MetricsQuery,now=new Date(),database:Database=db()) {
 return database.transaction(async tx=>aggregate(tx,requireStaff(await lockAccess(tx,access)),period,now));
}
export async function createMonthlyReport(access:AccessContext,input:z.output<typeof monthlyReportCreateSchema>,now=new Date(),database:Database=db()) {
 let period:MetricsQuery;try{period=monthlyReportPeriod(input.companyId,input.month,input.includeTests,now);}catch{throw new ApiError(400,'Selecciona un mes válido, sin meses futuros.');}
 return runKnowledgeOperation(access,input.operationId,'company_report_create',input,false,async(tx,fresh)=>{
  const report=await aggregate(tx,fresh,period,now),id=randomUUID(),payloadJson=JSON.stringify(report),createdAt=now.toISOString();
  await tx.query('INSERT INTO "companyMonthlyReports" (id,"ownerId","companyId",month,"payloadJson","payloadHash","createdByMemberId","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[id,fresh.ownerId,input.companyId,input.month,payloadJson,hash(payloadJson),fresh.member.id,createdAt]);
  return {id,companyId:input.companyId,month:input.month,createdAt,createdByMemberId:fresh.member.id,report} as CompanyMonthlyReport;
 },database);
}
export async function listMonthlyReports(access:AccessContext,companyId:string,cursor:string|null=null,database:Database=db()) {
 if(cursor)z.string().uuid().parse(cursor);
 return database.transaction(async tx=>{
  const fresh=requireStaff(await lockAccess(tx,access));await company(tx,fresh,companyId);
  const rows=(await tx.query('SELECT id,"companyId",month,"createdAt","createdByMemberId" FROM "companyMonthlyReports" r WHERE "ownerId"=$1 AND "companyId"=$2 AND ($3::text IS NULL OR (r."createdAt",r.id)<(SELECT c."createdAt",c.id FROM "companyMonthlyReports" c WHERE c.id=$3 AND c."ownerId"=$1 AND c."companyId"=$2)) ORDER BY r."createdAt" DESC,r.id DESC LIMIT 21',[fresh.ownerId,companyId,cursor])).rows;
  return {items:rows.slice(0,20),nextCursor:rows.length>20?rows[19].id:null};
 });
}
export async function getMonthlyReport(access:AccessContext,id:string,database:Database=db()):Promise<CompanyMonthlyReport> {
 z.string().uuid().parse(id);
 return database.transaction(async tx=>{
  const fresh=requireStaff(await lockAccess(tx,access)),row=(await tx.query('SELECT * FROM "companyMonthlyReports" WHERE id=$1 AND "ownerId"=$2',[id,fresh.ownerId])).rows[0];
  if(!row)throw new ApiError(404,'El informe no existe o ya no tienes acceso.');await company(tx,fresh,row.companyId);
  if(hash(row.payloadJson)!==row.payloadHash)throw new ApiError(503,'No se pudo verificar el informe guardado.');
  const report=companyReportSchema.parse(JSON.parse(row.payloadJson));if(report.companyId!==row.companyId||report.period.companyId!==row.companyId||report.period.from.slice(0,7)!==row.month)throw new ApiError(503,'El informe no corresponde a su empresa y período.');
  return {id:row.id,companyId:row.companyId,month:row.month,createdAt:row.createdAt,createdByMemberId:row.createdByMemberId,report};
 });
}
