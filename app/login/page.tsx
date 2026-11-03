import { getDatabase } from '../../db';
import { readInvitation } from '../../lib/invitations';
import LoginForm from './login-form';
import { safeTicketReturnPath } from '../../lib/return-path';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Accede a Daybook Ticket', referrer: 'no-referrer', robots: { index: false, follow: false } };
export default async function Login({ searchParams }: { searchParams: Promise<{ invite?: string; token?: string; reset?: string; return_to?: string }> }) {
  const query = await searchParams;
  const invitation = query.invite ? await readInvitation(getDatabase(), query.invite) : null;
  return <LoginForm invite={invitation ? { token: query.invite!, name: invitation.name, email: invitation.email } : undefined} invalidInvite={Boolean(query.invite && !invitation)} resetToken={query.reset === '1' ? query.token : undefined} returnTo={safeTicketReturnPath(query.return_to)} />;
}
