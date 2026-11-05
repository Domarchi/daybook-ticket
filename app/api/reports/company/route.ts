import { requireAccess,requireStaff } from '@/lib/access';
import { ApiError,handle,json } from '@/lib/server';
import { parseMetricsQuery,MetricsQueryError } from '@/lib/agent-metrics-model';
import { getCompanyOperationalReport } from '@/lib/company-reports';
export async function GET(request:Request){return handle(async()=>{const access=requireStaff(await requireAccess(request));let period;try{period=parseMetricsQuery(new URL(request.url).searchParams);}catch(error){if(error instanceof MetricsQueryError)throw new ApiError(400,error.message);throw error;}return json(await getCompanyOperationalReport(access,period));});}
