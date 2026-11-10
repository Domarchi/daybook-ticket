import { headers } from 'next/headers';
import { notFound,redirect } from 'next/navigation';
import Link from 'next/link';
import { requireAccess } from '@/lib/access';
import { getDaybookUser } from '@/lib/daybook-auth';
import { ApiError } from '@/lib/server';
import { workspaceIdSchema } from '@/lib/workspace-model';
import {portalReturnPath,ticketLoginPath} from '@/lib/return-path';
import {workspacePageAccessDecision,type WorkspacePageAccessDecision} from '@/lib/workspace-page-access';
import Desk from '../../desk';
import Brand from '../../brand';
import '../../workspaces.css';
export const dynamic='force-dynamic';
export const metadata={title:'Daybook Ticket',robots:{index:false,follow:false},referrer:'no-referrer'};
export default async function WorkspacePage({params,searchParams}:{params:Promise<{workspaceId:string}>;searchParams:Promise<{ticket?:string|string[];serviceContext?:string|string[];company?:string|string[];view?:string|string[];section?:string|string[]}>}){
 const parsed=workspaceIdSchema.safeParse((await params).workspaceId);
 if(!parsed.success)notFound();
 const id=parsed.data,destination=portalReturnPath(id,await searchParams);
 if(id==='daybook')redirect(destination);
 const user=await getDaybookUser();
 if(!user)redirect(ticketLoginPath(destination));
 let decision:WorkspacePageAccessDecision=null;
 try{await requireAccess(new Request(`${process.env.DAYBOOK_SITE_URL}/api/workspaces/${id}/workspace`,{headers:await headers()}));}
 catch(error){
  if(!(error instanceof ApiError))throw error;
  decision=workspacePageAccessDecision(error.status,id,destination);
  if(!decision)throw error;
 }
 // Next's navigation interrupts stay outside the try/catch that handles API errors.
 if(decision?.kind==='redirect')redirect(decision.href);
 if(decision?.kind==='denied')return <main className="security-page commercial-page"><header><Link href="/workspaces" aria-label="Daybook Ticket · Mis espacios"><Brand/></Link><span>Acceso privado</span></header><section className="panel commercial-panel"><div className="commercial-body"><h1>No tienes acceso a este espacio</h1><p>Tu cuenta actual no tiene una membresía activa para abrirlo. Revisa tus espacios o inicia sesión con otra cuenta invitada.</p><nav aria-label="Opciones de acceso" className="security-actions"><Link className="secondary" href="/workspaces">Ver mis espacios</Link><Link className="primary" href={decision.loginHref}>Iniciar sesión con otra cuenta</Link></nav></div></section></main>;
 return <Desk key={id} displayName={user.fullName||'Mi espacio'} email={user.email}/>;
}
