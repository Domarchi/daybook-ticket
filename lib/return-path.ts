import {workspaceHome} from './workspace-model';
/** Only known portal destinations may survive sign-in; never arbitrary URLs. */
export function ticketReturnPath(value: unknown): string {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return '/';
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? `/?ticket=${id}` : '/';
}

export function safeTicketReturnPath(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if(value==='/workspaces')return value;
  if(value.length>1024||!value.startsWith('/')||value.startsWith('//')||/[\u0000-\u0020\u007f\\]/.test(value))return '/';
  try{
    const url=new URL(value,'https://daybook.invalid'),workspace=/^\/w\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})$/.exec(url.pathname);
    if(url.origin!=='https://daybook.invalid'||url.pathname!==value.split('?')[0]||url.hash||url.pathname!=='/'&&!workspace)return '/';
    const keys=[...url.searchParams.keys()];
    if(keys.some(key=>!['ticket','serviceContext','company'].includes(key)||url.searchParams.getAll(key).length!==1))return '/';
    if(url.searchParams.has('ticket')&&(keys.length!==1||!/^\d+$/.test(url.searchParams.get('ticket')!)))return '/';
    if(!url.searchParams.has('ticket')&&keys.length&&(url.searchParams.get('serviceContext')!=='1'||url.searchParams.has('company')&&!companyId.test(url.searchParams.get('company')!)))return '/';
    return portalReturnPath(workspace?.[1]??'daybook',Object.fromEntries(url.searchParams));
  }catch{return '/';}
}

const companyId=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function portalReturnPath(workspaceId:string,query:{ticket?:unknown;serviceContext?:unknown;company?:unknown}):string{
  const base=workspaceHome(workspaceId);
  if(query.ticket!==undefined){const ticket=ticketReturnPath(query.ticket);return ticket==='/'?base:workspaceHome(workspaceId,Number(new URL(ticket,'https://daybook.invalid').searchParams.get('ticket')));}
  if(query.serviceContext==='1'){
    if(query.company!==undefined&&(typeof query.company!=='string'||!companyId.test(query.company)))return base;
    const params=new URLSearchParams({serviceContext:'1'});if(typeof query.company==='string')params.set('company',query.company.toLowerCase());
    return `${base}?${params}`;
  }
  return base;
}

export function ticketLoginPath(returnTo: unknown): string {
  const safe = safeTicketReturnPath(returnTo);
  return safe === '/' ? '/login' : `/login?return_to=${encodeURIComponent(safe)}`;
}
