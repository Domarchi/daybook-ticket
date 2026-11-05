import '../workspaces.css';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getDaybookUser } from '@/lib/daybook-auth';
import { listIdentityWorkspaces } from '@/lib/workspaces';
import { workspaceHome } from '@/lib/workspace-model';
export const dynamic='force-dynamic';
export default async function Workspaces(){if(!await getDaybookUser())redirect('/login');const data=await listIdentityWorkspaces(new Request(`${process.env.DAYBOOK_SITE_URL}/api/workspaces`,{headers:await headers()}));return <main className="security-page commercial-page"><h1>Mis espacios</h1><p>Tu cuenta puede tener un rol diferente en cada negocio. Abre cada espacio en su propia pestaña.</p><ul>{data.workspaces.map(item=><li key={String(item.id)}><Link href={workspaceHome(String(item.id))}>{String(item.brandName)} · {String(item.role)} · {String(item.state)}</Link></li>)}</ul>{!data.workspaces.length&&<p>No tienes una membresía activa. Abre la invitación concreta que te envió el equipo.</p>}{data.operator&&<p><Link href="/operator">Consola de operador</Link></p>}</main>;}
