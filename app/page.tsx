import Desk from './desk';
import { getDaybookUser } from '../lib/daybook-auth';
import { redirect } from 'next/navigation';
import { requireAccess } from '@/lib/access';
import { ApiError } from '@/lib/server';
import { ticketLoginPath, ticketReturnPath } from '../lib/return-path';
export const dynamic = 'force-dynamic';
export default async function Home({ searchParams }: { searchParams: Promise<{ ticket?: string | string[] }> }) {
  const user = await getDaybookUser();
  if (!user) redirect(ticketLoginPath(ticketReturnPath((await searchParams).ticket)));
  try { await requireAccess(); } catch(error) { if(error instanceof ApiError && error.status===428) redirect(`/security?return_to=${encodeURIComponent(ticketReturnPath((await searchParams).ticket))}`); if(!(error instanceof ApiError) || ![401,403].includes(error.status))throw error; }
  return <Desk displayName={user.fullName || 'Mi espacio'} email={user.email} />;
}
