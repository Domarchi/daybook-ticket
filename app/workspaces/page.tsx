import '../workspaces.css';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ChevronRight, Headphones } from 'lucide-react';
import { getDaybookUser } from '@/lib/daybook-auth';
import { listIdentityWorkspaces } from '@/lib/workspaces';
import { workspaceHome } from '@/lib/workspace-model';
import { workspaceRoleLabel, workspaceStateLabel } from '@/lib/workspace-administration-ui';
import Brand from '../brand';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mis espacios — Daybook Ticket', robots: { index: false, follow: false } };
export default async function Workspaces({ searchParams }: { searchParams: Promise<{ from?: string | string[] }> }) {
  if (!(await getDaybookUser())) redirect('/login');
  const data = await listIdentityWorkspaces(
    new Request(`${process.env.DAYBOOK_SITE_URL}/api/workspaces`, { headers: await headers() }),
  );
  const spaces = data.workspaces.map(item => ({
    id: String(item.id),
    name: String(item.brandName),
    role: workspaceRoleLabel(item.role),
    state: String(item.state),
  }));
  // El menú del escritorio dice desde qué espacio vienes. Solo se ofrece volver si ese espacio es uno de los tuyos:
  // el parámetro nunca arma un enlace por sí solo.
  const from = (await searchParams).from,
    origin = typeof from === 'string' ? spaces.find(space => space.id === from) : undefined;
  return (
    <main className="security-page commercial-page workspaces-page">
      <header>
        <Brand />
        {origin && (
          <Link className="workspaces-back" href={workspaceHome(origin.id)}>
            <ArrowLeft size={16} aria-hidden="true" />
            <span>Volver a {origin.name}</span>
          </Link>
        )}
      </header>
      <h1>Mis espacios</h1>
      {spaces.length ? (
        <>
          <p>Tu rol puede ser distinto en cada espacio.</p>
          <ul className="workspaces-list">
            {spaces.map(space => (
              <li key={space.id}>
                <Link href={workspaceHome(space.id)}>
                  <span className="workspaces-icon">
                    <Headphones size={18} aria-hidden="true" />
                  </span>
                  <span className="workspaces-name">
                    {space.name}
                    <small>{space.role}</small>
                  </span>
                  <span className="commercial-state" data-state={space.state}>
                    {workspaceStateLabel(space.state)}
                  </span>
                  <ChevronRight className="workspaces-chevron" size={18} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>No tienes espacios activos. Para entrar a uno, abre el enlace de invitación que recibiste.</p>
      )}
      {data.operator && (
        <p className="workspaces-operator">
          <Link href="/operator">Consola de operador</Link>
        </p>
      )}
    </main>
  );
}
