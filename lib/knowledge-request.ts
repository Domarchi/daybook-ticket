import {daybookFetch} from './browser-request';
import {readDaybookJson,isJsonObject} from './browser-json';
import {companyReportSchema} from './knowledge-model';

const strings=(value:Record<string,unknown>,keys:string[])=>keys.every(key=>typeof value[key]==='string');
const integer=(value:unknown,min=0)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=min;
function article(value:unknown){return isJsonObject(value)&&integer(value.id,1)&&strings(value,['title','category','body','createdAt','updatedAt'])&&integer(value.version)&&integer(value.contentRevision)&&['draft','review','approved','changes'].includes(String(value.reviewState))&&typeof value.archived==='boolean';}
const page=(value:Record<string,unknown>)=>Array.isArray(value.items)&&(value.nextCursor===null||integer(value.nextCursor,1))&&value.items.every(article);
function detail(value:Record<string,unknown>){return article(value.article)&&['staff','client'].includes(String(value.reader))&&Array.isArray(value.revisions)&&Array.isArray(value.reviews)&&Array.isArray(value.publications)&&(value.historyNextCursor===null||integer(value.historyNextCursor));}
function monthlyRow(value:unknown){return isJsonObject(value)&&strings(value,['id','companyId','month','createdAt','createdByMemberId'])&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(String(value.month));}
/** The permitted response contracts are pages, article DTOs, article details and private report DTOs.
 * Unknown success routes fail closed; MFA statuses remain BrowserJsonError values with their payload.
 */
function validPayload(path:string,method:string,value:unknown){
 if(!isJsonObject(value))return false;
 const route=path.split('?')[0].replace(/^\/api\/workspaces\/[^/]+/,'/api');
 if(method!=='GET'){
  if(/^\/api\/knowledge(?:\/|$)/.test(route))return article(value.article);
  if(route==='/api/reports/monthly')return monthlyRow(value)&&companyReportSchema.safeParse(value.report).success;
  return false;
 }
 if(['/api/knowledge','/api/knowledge/suggestions','/api/articles'].includes(route))return page(value);
 if(/^\/api\/(?:knowledge|articles)\/\d+$/.test(route))return detail(value);
 if(route==='/api/reports/company')return companyReportSchema.safeParse(value).success;
 if(route==='/api/reports/monthly')return Array.isArray(value.items)&&value.items.every(monthlyRow)&&(value.nextCursor===null||typeof value.nextCursor==='string');
 if(/^\/api\/reports\/monthly\/[0-9a-f-]+$/i.test(route))return monthlyRow(value)&&companyReportSchema.safeParse(value.report).success;
 return false;
}
export async function knowledgeRequest<T>(memberId:string,path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{
 const verb=method.toUpperCase(),response=await daybookFetch(path,{method:verb,signal,cache:'no-store',headers:{'X-Daybook-Member-Id':memberId,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})},verb==='GET'?undefined:'Se interrumpió la conexión. No se ha confirmado esta operación. Revisa el resultado y vuelve a intentarlo.');
 return readDaybookJson(response,{mutation:verb!=='GET',validate:(value):value is T=>validPayload(path,verb,value)});
}
