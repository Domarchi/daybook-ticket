import { redirect } from 'next/navigation';
import { getDaybookUser } from '@/lib/daybook-auth';
import { SecurityCenter } from '../../security-center';
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function AccountSecurity() {
  if (!(await getDaybookUser())) redirect('/login');
  return (
    <main className="security-page">
      <h1>Seguridad de mi identidad</h1>
      <SecurityCenter identityOnly returnTo="/workspaces" />
    </main>
  );
}
