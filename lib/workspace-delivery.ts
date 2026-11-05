import type { Database } from '../db/database';
import { verifiedWorkspaceSender,workspaceHome } from './workspace-model';
/** Shared infrastructure credentials are server-only; tenant senders never inherit another business's sender. */
export async function workspaceDeliveryContext(database:Database,ownerId:string){
  if(!ownerId)return {workspaceId:'daybook',home:'/',brandName:'Daybook Ticket',operational:true,enabled:true,inbound:true,sender:null as string|null};
  const row=await database.prepare(`SELECT o.id,p.state,p."brandName",p."mailFrom",p."mailEnabled",p."inboundEnabled" FROM organizations o LEFT JOIN "workspaceProfiles" p ON p."workspaceId"=o.id AND p."ownerId"=o."ownerId" WHERE o."ownerId"=$1`).bind(ownerId).first<{id:string;state:string|null;brandName:string|null;mailFrom:string|null;mailEnabled:boolean|null;inboundEnabled:boolean|null}>();
  if(row?.id==='daybook')return {workspaceId:'daybook',home:'/',brandName:'Daybook Ticket',operational:true,enabled:true,inbound:true,sender:null as string|null};
  const verified=Boolean(row&&verifiedWorkspaceSender(row.id,row.mailFrom));
  return {workspaceId:row?.id||'',home:row?workspaceHome(row.id):'/',brandName:row?.brandName||'Daybook Ticket',operational:Boolean(row?.state==='active'),enabled:Boolean(row?.state==='active'&&row.mailEnabled&&verified),inbound:Boolean(row?.state==='active'&&row.inboundEnabled&&verified),sender:verified?row!.mailFrom:null};
}
