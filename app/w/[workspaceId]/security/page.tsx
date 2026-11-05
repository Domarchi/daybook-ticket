import { getDaybookUser } from '@/lib/daybook-auth';
import { workspaceHome,workspaceIdSchema } from '@/lib/workspace-model';
import { SecurityCenter } from '../../../security-center';
import { redirect } from 'next/navigation';
import {safeTicketReturnPath,ticketLoginPath} from '@/lib/return-path';
import {workspaceIdFromPath} from '@/lib/workspace-model';
export const dynamic='force-dynamic';
export const metadata={robots:{index:false,follow:false},referrer:'no-referrer'};
export default async function WorkspaceSecurity({params,searchParams}:{params:Promise<{workspaceId:string}>;searchParams:Promise<{return_to?:string}>}){const id=workspaceIdSchema.parse((await params).workspaceId);if(id==='daybook')redirect('/security');const requested=safeTicketReturnPath((await searchParams).return_to),returnTo=workspaceIdFromPath(requested)===id?requested:workspaceHome(id);if(!await getDaybookUser())redirect(ticketLoginPath(returnTo));return <main className="security-page"><h1>Seguridad del espacio</h1><SecurityCenter key={id} returnTo={returnTo}/></main>;}
