import { getDaybookUser } from '@/lib/daybook-auth';
import { workspaceHome, workspaceIdSchema } from '@/lib/workspace-model';
import { WorkspaceAdministrationPanel } from '../../../workspace-administration';
import { redirect } from 'next/navigation';
export const dynamic = 'force-dynamic';
export default async function Onboarding({ params }: { params: Promise<{ workspaceId: string }> }) {
  const id = workspaceIdSchema.parse((await params).workspaceId);
  if (!(await getDaybookUser())) redirect(`/login?return_to=${encodeURIComponent(workspaceHome(id))}`);
  return (
    <main className="security-page commercial-page">
      <h1>Prepara tu espacio</h1>
      <WorkspaceAdministrationPanel key={id} workspaceId={id} />
    </main>
  );
}
