import type { SettingsSection } from './desk-url';

export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  general: 'General',
  mail: 'Correo y avisos',
  organization: 'Organización',
  backups: 'Copias de seguridad',
  features: 'Funciones',
  workspace: 'Negocio',
};

/** Which sections of Configuración this workspace has: some exist only when a feature or the platform allows them. */
export function availableSettingsSections(context: { organization: boolean; backups: boolean; businessWorkspace: boolean }): SettingsSection[] {
  const sections: SettingsSection[] = ['general', 'mail'];
  if (context.organization) sections.push('organization');
  if (context.backups) sections.push('backups');
  sections.push('features');
  if (context.businessWorkspace) sections.push('workspace');
  return sections;
}

/** A link to a section this workspace does not have (shared from another one, or after a feature was paused) opens General. */
export function resolveSettingsSection(requested: SettingsSection, available: readonly SettingsSection[]): SettingsSection {
  return available.includes(requested) ? requested : 'general';
}
