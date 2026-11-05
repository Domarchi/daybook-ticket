import { WORKSPACE_ROUTE_REGISTRY } from '@/lib/workspace-route-registry';
import { handle,json } from '@/lib/server';
import { requireAccess } from '@/lib/access';
export const dynamic='force-dynamic';
export const maxDuration=300;
type Context={params:Promise<{workspaceId:string;path:string[]}>};
async function dispatch(request:Request,context:Context){return handle(async()=>{
 const {path}=await context.params,part=path.join('/');
 const route=WORKSPACE_ROUTE_REGISTRY.find(item=>item.pattern.test(part));
 if(!route)return json({error:'Ruta no disponible en este espacio.'},404);
 // Delegates retain the ORIGINAL URL, body, CSRF origin and account header.
 await requireAccess(request,{allowSecuritySetup:/^security(?:\/|$)/.test(part)});
 const handler=(route.handlers as Record<string,unknown>)[request.method];
 if(typeof handler!=='function')return json({error:'Método no disponible.'},405);
 const match=route.pattern.exec(part)!;
 const params=Object.fromEntries(route.names.map((name,index)=>[name,match[index+1]]));
 return (handler as (req:Request,ctx:{params:Promise<Record<string,string>>})=>Promise<Response>)(request,{params:Promise.resolve(params)});
});}
export const GET=dispatch;export const POST=dispatch;export const PATCH=dispatch;export const DELETE=dispatch;export const PUT=dispatch;
