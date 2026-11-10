'use client';
import { type SettingsSection } from '@/lib/desk-url';
import { availableSettingsSections, resolveSettingsSection, SETTINGS_SECTION_LABELS } from '@/lib/settings-sections';
import { currentWorkspaceId } from '@/lib/workspace-client';
import { type Workspace } from '../../lib/types';
import { MailPanel } from '../access-panel';
import { AutomaticBackupPanel } from '../automatic-backup-panel';
import { BackupPanel } from '../backup-panel';
import { EmailInboundPanel } from '../email-inbound';
import { EvolutionFeaturesPanel } from '../evolution-controls';
import { NotificationSettingsPanel } from '../notification-settings';
import { OrganizationManager } from '../work-organization';
import { WorkspaceAdministrationPanel } from '../workspace-administration';
import { DeskLink, DeskRun, PageTitle, request } from './shared';
import { SettingsForm } from './settings-form';
import { navigateDesk } from '@/lib/desk-url';

/**
 * Configuración, one section at a time. The section lives in the URL (?view=settings&section=mail),
 * so Back, reload and shared links land on it; General is the bare /?view=settings.
 */
export function SettingsView({
  data,
  section: requested,
  busy,
  run,
  refresh,
}: {
  data: Workspace;
  section: SettingsSection;
  busy: boolean;
  run: DeskRun;
  refresh: () => Promise<unknown>;
}) {
  const workspaceId = currentWorkspaceId(),
    memberId = data.viewer!.id;
  const available = availableSettingsSections({
    organization: Boolean(data.evolution?.features.organization),
    backups: Boolean(data.platformBackupAllowed),
    businessWorkspace: workspaceId !== 'daybook',
  });
  const section = resolveSettingsSection(requested, available);
  return (
    <>
      <PageTitle title="Configuración" subtitle="Marca, correo, avisos y funciones del espacio." />
      <nav className="settings-nav" aria-label="Secciones de configuración">
        {available.map(item => (
          <DeskLink
            key={item}
            to={{ view: 'settings', section: item }}
            onNavigate={() => navigateDesk({ view: 'settings', section: item })}
            aria-current={item === section ? 'page' : undefined}
            className={item === section ? 'is-current' : undefined}
          >
            {SETTINGS_SECTION_LABELS[item]}
          </DeskLink>
        ))}
      </nav>
      <div className="settings-section-body" key={section}>
        {section === 'general' && (
          <SettingsForm
            settings={data.settings}
            members={data.members}
            busy={busy}
            onSave={s => run(() => request('/api/settings', 'PATCH', s), 'Configuración guardada')}
          />
        )}
        {section === 'mail' && (
          <>
            <MailPanel status={data.mailStatus} busy={busy} run={run} />
            <NotificationSettingsPanel />
            <EmailInboundPanel key={`inbound:${memberId}`} memberId={memberId} administrator />
          </>
        )}
        {section === 'organization' && (
          <OrganizationManager key={`organization:${memberId}`} memberId={memberId} companies={data.companies || []} />
        )}
        {section === 'backups' && (
          <>
            <BackupPanel key={`backup:${memberId}`} memberId={memberId} />
            <AutomaticBackupPanel key={`automatic-backup:${memberId}`} memberId={memberId} />
          </>
        )}
        {section === 'features' && (
          <EvolutionFeaturesPanel key={`evolution:${memberId}`} memberId={memberId} onChanged={refresh} />
        )}
        {section === 'workspace' && (
          <WorkspaceAdministrationPanel key={workspaceId} workspaceId={workspaceId} onChanged={refresh} />
        )}
      </div>
    </>
  );
}
