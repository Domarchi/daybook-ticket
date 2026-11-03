import Desk from './desk';
import { getDaybookUser } from '../lib/daybook-auth';
import { redirect } from 'next/navigation';
import { ticketLoginPath, ticketReturnPath } from '../lib/return-path';
export const dynamic = 'force-dynamic';
export default async function Home({ searchParams }: { searchParams: Promise<{ ticket?: string | string[] }> }) {
  const user = await getDaybookUser();
  if (!user) redirect(ticketLoginPath(ticketReturnPath((await searchParams).ticket)));
  return <Desk displayName={user.fullName || 'Mi espacio'} email={user.email} />;
}
