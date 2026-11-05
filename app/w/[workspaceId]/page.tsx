import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireAccess } from '@/lib/access';
import { getDaybookUser } from '@/lib/daybook-auth';
import { ApiError } from '@/lib/server';
import { workspaceHome,workspaceIdSchema } from '@/lib/workspace-model';
import Desk from '../../desk';
export const dynamic='force-dynamic';
export default async function WorkspacePage({params}:{params:Promise<{workspaceId:string}>}){const id=workspaceIdSchema.parse((await params).workspaceId),destination=workspaceHome(id),user=await getDaybookUser();if(id==='daybook')redirect('/');if(!user)redirect(`/login?return_to=${encodeURIComponent(destination)}`);try{await requireAccess(new Request(`${process.env.DAYBOOK_SITE_URL}/api/workspaces/${id}/workspace`,{headers:await headers()}));}catch(error){if(error instanceof ApiError&&error.status===428)redirect(error.redirectTo||`/w/${id}/security`);if(error instanceof ApiError&&error.status===423)redirect(`/w/${id}/onboarding`);throw error;}return <Desk key={id} displayName={user.fullName||'Mi espacio'} email={user.email}/>;}
