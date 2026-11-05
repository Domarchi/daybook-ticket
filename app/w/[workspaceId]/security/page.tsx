import { getDaybookUser } from '@/lib/daybook-auth';
import { workspaceHome,workspaceIdSchema } from '@/lib/workspace-model';
import { SecurityCenter } from '../../../security-center';
import { redirect } from 'next/navigation';
export const dynamic='force-dynamic';
export const metadata={robots:{index:false,follow:false},referrer:'no-referrer'};
export default async function WorkspaceSecurity({params}:{params:Promise<{workspaceId:string}>}){const id=workspaceIdSchema.parse((await params).workspaceId);if(id==='daybook')redirect('/security');if(!await getDaybookUser())redirect(`/login?return_to=${encodeURIComponent(workspaceHome(id))}`);return <main className="security-page"><h1>Seguridad del espacio</h1><SecurityCenter key={id} returnTo={workspaceHome(id)}/></main>;}
