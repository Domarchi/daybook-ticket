import Desk from './desk';
import { getDatabase } from '@/db';
import { workspaceHome } from '@/lib/workspace-model';
import { getDaybookUser } from '../lib/daybook-auth';
import { redirect } from 'next/navigation';
import { requireAccess } from '@/lib/access';
import { ApiError } from '@/lib/server';
import { ticketLoginPath, portalReturnPath } from '../lib/return-path';
export const dynamic = 'force-dynamic';
export default async function Home({ searchParams }: { searchParams: Promise<{ ticket?: string | string[];serviceContext?:string|string[];company?:string|string[];view?:string|string[];section?:string|string[] }> }) {
  const destination=portalReturnPath('daybook',await searchParams);
  const user = await getDaybookUser();
  if (!user) redirect(ticketLoginPath(destination));
  const spaces=(await getDatabase().prepare('SELECT \"organizationId\" FROM members WHERE \"userId\"=$1 AND status=\'active\' ORDER BY \"organizationId\"').bind(user.userId).all<{organizationId:string}>()).results;
  if(!spaces.some(item=>item.organizationId==='daybook'))redirect(spaces.length?workspaceHome(spaces[0].organizationId):'/workspaces');
  try { await requireAccess(); } catch(error) { if(error instanceof ApiError && error.status===428) redirect(`/security?return_to=${encodeURIComponent(destination)}`); if(!(error instanceof ApiError) || ![401,403].includes(error.status))throw error; }
  return <Desk displayName={user.fullName || 'Mi espacio'} email={user.email} />;
}
