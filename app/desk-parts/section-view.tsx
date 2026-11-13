'use client';
import { type SettingsSection } from '@/lib/desk-url';
import { currentWorkspaceId } from '@/lib/workspace-client';
import { workspaceHome } from '@/lib/workspace-model';
import { type Workspace } from '../../lib/types';
import { AccessPanel } from '../access-panel';
import { AgentMetricsPanel } from '../agent-metrics';
import { AutomationPanel } from '../automation';
import { CompanyReportsPanel } from '../company-reports';
import { EscalationSettingsPanel } from '../escalation-settings';
import { KnowledgePanel, LegacyKnowledgePanel } from '../knowledge';
import { OperationsSettingsPanel } from '../operations-settings';
import { SatisfactionReportPanel } from '../satisfaction-report';
import { SavedRepliesManager } from '../saved-replies';
import { SecurityCenter, SecurityHealthPanel } from '../security-center';
import { ServiceContextPanel } from '../service-context';
import { ContactDirectory } from '../ticket-pagination';
import { EquipmentPanel } from '../equipment-panel';
import { RequirementsPanel } from '../requirements-panel';
import { PageTitle, DeskRun, View } from './shared';
import { SettingsView } from './settings-view';

export function SectionView({
  view,
  section,
  data,
  isAdmin,
  accessKey,
  feedKey,
  busy,
  companyParam,
  run,
  refresh,
  go,
  setQueue,
  setSearch,
}: {
  view: View;
  section: SettingsSection;
  data: Workspace;
  isAdmin: boolean;
  accessKey: string;
  feedKey: string | undefined;
  busy: boolean;
  companyParam: string | null;
  run: DeskRun;
  refresh: () => Promise<unknown>;
  go: (view: View) => void;
  setQueue: (value: string) => void;
  setSearch: (value: string) => void;
}) {
  return (
    <>
      {view === 'security' ? (
        <>
          <PageTitle title="Seguridad de mi cuenta" subtitle="Autenticador, recuperación y dispositivos con acceso." />
          <SecurityCenter
            key={`security:${data.viewer!.id}`}
            memberId={data.viewer!.id}
            returnTo={workspaceHome(currentWorkspaceId())}
          />
          {isAdmin &&
            (data.evolution?.features.security ? (
              <SecurityHealthPanel key={`health:${data.viewer!.id}`} memberId={data.viewer!.id} />
            ) : (
              <p className="info-note">
                El panel de salud y auditoría está preparado. Activa Seguridad en las funciones del espacio para
                revisarlo. El acceso y la política de doble factor se siguen aplicando.
              </p>
            ))}
        </>
      ) : view === 'service' ? (
        <>
          <PageTitle
            title="Empresas y servicios"
            subtitle="Equipos, sedes, contratos e incidencias con acceso interno."
          />
          {data.evolution?.features.serviceContext ? (
            <ServiceContextPanel
              key={`${data.viewer!.id}:${companyParam || 'all'}`}
              memberId={data.viewer!.id}
              companies={data.companies || []}
              members={data.members}
              administrator={isAdmin}
              initialCompanyId={companyParam}
            />
          ) : (
            <p className="info-note">Esta función está en pausa. Sus datos y documentos se conservan.</p>
          )}
        </>
      ) : view === 'contacts' ? (
        <>
          <PageTitle title="Personas, no solo tickets" subtitle="El contexto de cada cliente, siempre a mano." />
          <ContactDirectory
            key={data.viewer!.id}
            memberId={data.viewer!.id}
            refreshKey={feedKey}
            onSearch={email => {
              go('inbox');
              setQueue('all');
              setSearch(email);
            }}
          />
        </>
      ) : view === 'equipment' ? (
        <>
          <PageTitle title="Equipos" subtitle="Cada equipo por su ID de inventario y quién lo tiene." />
          <EquipmentPanel
            key={`${accessKey}:equipment`}
            memberId={data.viewer!.id}
            companies={data.companies || []}
            busy={busy}
            run={run}
          />
        </>
      ) : view === 'requirements' ? (
        <>
          <PageTitle
            title="Requerimientos"
            subtitle="Lo que piden los clientes, etapa por etapa, con su fecha comprometida."
          />
          <RequirementsPanel key={`${accessKey}:requirements`} memberId={data.viewer!.id} refreshKey={feedKey} />
        </>
      ) : view === 'knowledge' ? (
        <>
          <PageTitle
            title="Conocimiento que conecta"
            subtitle="Guías revisadas y versiones compartidas con cada empresa."
          />
          {isAdmin && <SavedRepliesManager replies={data.savedReplies || []} busy={busy} run={run} />}
          <div>
            {data.evolution?.features.knowledge ? (
              <KnowledgePanel
                key={`${accessKey}:knowledge`}
                memberId={data.viewer!.id}
                companies={data.companies || []}
                staff
                administrator={isAdmin}
              />
            ) : (
              <LegacyKnowledgePanel key={`${accessKey}:knowledge-paused`} memberId={data.viewer!.id} />
            )}
          </div>
        </>
      ) : view === 'reports' ? (
        <>
          <PageTitle title="Informes por empresa" subtitle="Servicio, cobertura y capturas mensuales privadas." />
          {data.evolution?.features.knowledge ? (
            <CompanyReportsPanel
              key={`${accessKey}:reports`}
              memberId={data.viewer!.id}
              companies={data.companies || []}
            />
          ) : (
            <p className="info-note">Los informes están en pausa. Sus capturas se conservan.</p>
          )}
        </>
      ) : view === 'operations' && isAdmin ? (
        <>
          <PageTitle
            title="Atención y reparto"
            subtitle="Los plazos de cada empresa y la disponibilidad de tu equipo, en un lugar."
          />
          <OperationsSettingsPanel
            key={data.viewer!.id}
            memberId={data.viewer!.id}
            companies={data.companies}
            members={data.members}
            departments={data.settings.departments}
            onSaved={refresh}
          />
          <EscalationSettingsPanel
            key={`escalation:${data.viewer!.id}`}
            memberId={data.viewer!.id}
            members={data.members}
          />
          {data.evolution?.features.automation ? (
            <AutomationPanel
              key={`automation:${data.viewer!.id}`}
              memberId={data.viewer!.id}
              companies={data.companies || []}
              members={data.members}
              departments={data.settings.departments}
            />
          ) : (
            <p className="info-note">
              Las automatizaciones internas están en pausa. Sus reglas e historial se conservan.
            </p>
          )}
        </>
      ) : view === 'metrics' && isAdmin ? (
        <>
          <AgentMetricsPanel key={data.viewer!.id} memberId={data.viewer!.id} companies={data.companies} />
          <SatisfactionReportPanel
            key={`satisfaction:${data.viewer!.id}`}
            memberId={data.viewer!.id}
            companies={data.companies}
            members={data.members}
          />
        </>
      ) : view === 'team' && isAdmin ? (
        <AccessPanel data={data} busy={busy} run={run} />
      ) : view === 'settings' && isAdmin ? (
        <SettingsView data={data} section={section} busy={busy} run={run} refresh={refresh} />
      ) : (
        <>
          <PageTitle
            title="Centro de ayuda"
            subtitle="Cada cliente consulta únicamente las versiones aprobadas para su empresa."
          />
          {data.evolution?.features.knowledge ? (
            <KnowledgePanel
              key={`${accessKey}:help-staff`}
              memberId={data.viewer!.id}
              companies={data.companies || []}
              staff
              administrator={isAdmin}
            />
          ) : (
            <LegacyKnowledgePanel key={`${accessKey}:help-paused`} memberId={data.viewer!.id} />
          )}
        </>
      )}
    </>
  );
}
