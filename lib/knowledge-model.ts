import { z } from 'zod';
import { metricsDate, parseMetricsQuery, shiftMetricsDate, type MetricsQuery } from './agent-metrics-model';

const text=(max:number)=>z.string().trim().max(max);
export const knowledgeContentSchema=z.object({title:text(180).min(1),category:text(100).min(1),body:text(40000).min(1),changeNote:text(1000).default('')}).strict();
export const knowledgeCreateSchema=knowledgeContentSchema.extend({operationId:z.string().uuid()}).strict();
export const knowledgePatchSchema=knowledgeContentSchema.extend({expectedVersion:z.number().int().nonnegative(),archived:z.boolean().optional()}).strict();
export const knowledgeReviewSchema=z.object({operationId:z.string().uuid(),expectedVersion:z.number().int().nonnegative(),action:z.enum(['request','approve','changes']),note:text(2000).default('')}).strict();
export const knowledgePublicationSchema=z.object({operationId:z.string().uuid(),expectedVersion:z.number().int().nonnegative(),revisionId:z.string().uuid(),companyIds:z.array(z.string().uuid()).max(100).refine(ids=>new Set(ids).size===ids.length,'No repitas empresas.')}).strict();
export interface KnowledgeArticle {id:number;title:string;category:string;body:string;version:number;contentRevision:number;reviewState:'draft'|'review'|'approved'|'changes';archived:boolean;createdAt:string;updatedAt:string;published?:boolean}
export interface KnowledgeRevision {id:string;articleId:number;revision:number;title:string;category:string;body:string;changeNote:string;origin:'legacy'|'edit';createdByMemberId:string|null;createdAt:string;approved:boolean}
export interface KnowledgeReview {id:string;revisionId:string;status:'pending'|'approved'|'changes'|'superseded';note:string;requestedByMemberId:string;reviewerMemberId:string|null;requestedAt:string;decidedAt:string|null}
export interface KnowledgePublication {id:string;companyId:string;companyName:string;revisionId:string;revision:number;active:boolean;createdAt:string;revokedAt:string|null}
export interface KnowledgeDetail {article:KnowledgeArticle;revisions:KnowledgeRevision[];reviews:KnowledgeReview[];publications:KnowledgePublication[];reader:'staff'|'client';historyNextCursor:number|null}
export interface KnowledgePage {items:KnowledgeArticle[];nextCursor:number|null}
export const knowledgeSearchSchema=z.object({q:text(160).default(''),category:text(100).default(''),state:z.enum(['all','draft','review','approved','changes']).default('all'),includeArchived:z.boolean().default(false),cursor:z.number().int().positive().nullable().default(null),limit:z.number().int().min(1).max(50).default(20)}).strict();
export function knowledgeSearchTokens(q:string):string[]{return [...new Set(q.toLocaleLowerCase('es').match(/[\p{L}\p{N}]{3,40}/gu)||[])].filter(token=>!['para','como','con','del','las','los','una','unos','unas','que','por','desde','este','esta','tengo'].includes(token)).slice(0,8);}

export interface CompanyReportSummary {created:number;currentOpen:number;currentPending:number;currentOverdue:number;resolutions:number;slaMet:number;slaBreached:number;slaCompliancePercent:number|null;publicReplies:number;unknownResolved:number;untyped:number;withoutAsset:number}
export interface CompanyTrend {label:string;count:number}
export interface CompanyOperationalReport {classificationBasis?:'verified-period-cutoff';companyId:string;companyName:string;period:MetricsQuery & {timeZone:string};generatedAt:string;summary:CompanyReportSummary;byType:CompanyTrend[];byAsset:CompanyTrend[];byDay:CompanyTrend[];coverageNotes:string[]}
const count=z.number().int().nonnegative();
const trend=z.object({label:z.string().max(220),count}).strict();
export const companyReportSchema=z.object({classificationBasis:z.literal('verified-period-cutoff').optional(),companyId:z.string().uuid(),companyName:z.string().max(300),period:z.object({from:z.string(),to:z.string(),fromInstant:z.string(),untilInstant:z.string(),companyId:z.string().uuid().nullable(),includeTests:z.boolean().optional(),timeZone:z.literal('America/Santiago')}).strict(),generatedAt:z.string(),summary:z.object({created:count,currentOpen:count,currentPending:count,currentOverdue:count,resolutions:count,slaMet:count,slaBreached:count,slaCompliancePercent:z.number().min(0).max(100).nullable(),publicReplies:count,unknownResolved:count,untyped:count,withoutAsset:count}).strict(),byType:z.array(trend).max(51),byAsset:z.array(trend).max(51),byDay:z.array(trend).max(366),coverageNotes:z.array(z.string().max(1000)).max(10)}).strict();
export interface CompanyMonthlyReport {id:string;companyId:string;month:string;createdAt:string;createdByMemberId:string;report:CompanyOperationalReport}
export const monthlyReportCreateSchema=z.object({operationId:z.string().uuid(),companyId:z.string().uuid(),month:z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),includeTests:z.boolean().default(false)}).strict();
export function monthlyReportPeriod(companyId:string,month:string,includeTests=false,now=new Date()):MetricsQuery {
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))throw new Error('Selecciona un mes válido.');
 const from=`${month}-01`,next=new Date(`${from}T12:00:00Z`);next.setUTCMonth(next.getUTCMonth()+1);const last=shiftMetricsDate(next.toISOString().slice(0,10),-1),today=metricsDate(now);
 if(from>today)throw new Error('No se pueden generar informes de meses futuros.');
 return parseMetricsQuery(new URLSearchParams({companyId,from,to:last>today?today:last,includeTests:String(includeTests)}),now);
}

/** Recovery pauses publication access without changing security/MFA gates or editorial history. */
export function pauseKnowledgeFeaturesJson(raw:string){let features:Record<string,unknown>={};try{const parsed=JSON.parse(raw);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))features=parsed;}catch{/* A corrupt feature map already denies access; keep recovery paused. */}return JSON.stringify({...features,knowledge:false});}
