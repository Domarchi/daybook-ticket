import {requireStaff} from '@/lib/access';
import {requireKnowledgeAccess} from '@/lib/knowledge-access';
import { handle,json } from '@/lib/server';
import { getMonthlyReport } from '@/lib/company-reports';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){return handle(async()=>json(await getMonthlyReport(requireStaff(await requireKnowledgeAccess(request)),(await context.params).id)));}
