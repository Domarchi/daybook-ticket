import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireAccess } from '@/lib/access';
import { getDaybookUser } from '@/lib/daybook-auth';
import { ApiError } from '@/lib/server';
import { workspaceIdSchema } from '@/lib/workspace-model';
import {portalReturnPath,ticketLoginPath} from '@/lib/return-path';
import Desk from '../../desk';
export const dynamic='force-dynamic';
export default async function WorkspacePage({params,searchParams}:{params:Promise<{workspaceId:string}>;searchParams:Promise<{ticket?:string|string[];serviceContext?:string|string[];company?:string|string[]}>}){const id=workspaceIdSchema.parse((await params).workspaceId),destination=portalReturnPath(id,await searchParams),user=await getDaybookUser();if(id==='daybook')redirect(destination);if(!user)redirect(ticketLoginPath(destination));try{await requireAccess(new Request(`${process.env.DAYBOOK_SITE_URL}/api/workspaces/${id}/workspace`,{headers:await headers()}));}catch(error){if(error instanceof ApiError&&error.status===428)redirect(`/w/${id}/security?return_to=${encodeURIComponent(destination)}`);if(error instanceof ApiError&&error.status===423)redirect(`/w/${id}/onboarding`);throw error;}return <Desk key={id} displayName={user.fullName||'Mi espacio'} email={user.email}/>;}
