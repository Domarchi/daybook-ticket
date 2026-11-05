import { safeTicketReturnPath } from './return-path';
/** Only known local verification pages may be followed from an API response. */
export function safeSecurityRedirect(value:unknown):string|null{
 if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||/[\u0000-\u0020\u007f\\]/.test(value))return null;
 try{
  const url=new URL(value,'https://daybook.invalid');
  if(url.origin!=='https://daybook.invalid'||!['/security','/account/security'].includes(url.pathname)||url.hash||[...url.searchParams.keys()].some(key=>key!=='return_to')||url.searchParams.getAll('return_to').length>1)return null;
  const raw=url.searchParams.get('return_to');
  if(raw!==null){const target=safeTicketReturnPath(raw);if(target==='/'&&raw!=='/')return null;url.searchParams.set('return_to',target);}
  return url.pathname+url.search;
 }catch{return null;}
}
export async function followSecurityResponse(response:Response,input:RequestInfo|URL){
 if(response.status!==428||typeof window==='undefined')return response;
 try{
  const requested=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,window.location.href);
  if(requested.origin!==window.location.origin||!requested.pathname.startsWith('/api/'))return response;
  const result=await response.clone().json().catch(()=>null),path=safeSecurityRedirect(result?.redirectTo);
  if(!path)return response;
  const target=new URL(path,window.location.origin),returnTo=safeTicketReturnPath(window.location.pathname+window.location.search);
  if(!target.searchParams.has('return_to')&&returnTo!=='/')target.searchParams.set('return_to',returnTo);
  window.location.replace(target.href);
 }catch{/* An invalid hint never overrides the API's error or retries its request. */}
 return response;
}
