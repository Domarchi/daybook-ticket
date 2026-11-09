import { z } from 'zod';
import {requireStaff} from '@/lib/access';
import {requireKnowledgeAccess} from '@/lib/knowledge-access';
import { ApiError,handle,json,parseBody } from '@/lib/server';
import { createMonthlyReport,listMonthlyReports } from '@/lib/company-reports';
import { monthlyReportCreateSchema } from '@/lib/knowledge-model';
import { consumeRateLimit,RATE_RULES } from '@/lib/rate-limit';
export async function GET(request:Request){return handle(async()=>{const access=requireStaff(await requireKnowledgeAccess(request)),params=new URL(request.url).searchParams;for(const key of params.keys())if(!['companyId','cursor'].includes(key)||params.getAll(key).length!==1)throw new ApiError(400,'Los filtros no son válidos.');return json(await listMonthlyReports(access,z.string().uuid().parse(params.get('companyId')),params.get('cursor')));});}
export async function POST(request:Request){return handle(async()=>{const access=requireStaff(await requireKnowledgeAccess(request));await consumeRateLimit(access,RATE_RULES.report);return json(await createMonthlyReport(access,await parseBody(request,monthlyReportCreateSchema)),201);});}
