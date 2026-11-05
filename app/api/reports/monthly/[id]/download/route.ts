import { requireAccess,requireStaff } from '@/lib/access';
import { ApiError,handle } from '@/lib/server';
import { getMonthlyReport } from '@/lib/company-reports';
import { companyReportCsv,companyReportPdf } from '@/lib/company-report-export';
export const runtime='nodejs';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){return handle(async()=>{
 const access=requireStaff(await requireAccess(request)),id=(await context.params).id,params=new URL(request.url).searchParams,format=params.get('format')||'pdf';
 if(!['pdf','csv'].includes(format)||[...params.keys()].some(key=>key!=='format'||params.getAll(key).length!==1))throw new ApiError(400,'Selecciona PDF o CSV.');
 const snapshot=await getMonthlyReport(access,id),bytes=format==='pdf'?await companyReportPdf(snapshot):companyReportCsv(snapshot);
 // Recheck the live role after rendering and before returning private bytes.
 await getMonthlyReport(access,id);
 return new Response(typeof bytes==='string'?bytes:new Uint8Array(bytes),{headers:{'Content-Type':format==='pdf'?'application/pdf':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="daybook-informe-${snapshot.month}.${format}"`,'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Referrer-Policy':'no-referrer'}});
});}
