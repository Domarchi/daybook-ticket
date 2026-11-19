'use client';
import { currentWorkspaceId } from '@/lib/workspace-client';
import { workspaceHome } from '@/lib/workspace-model';
import { LifeBuoy, LogOut } from 'lucide-react';
import { type Workspace } from '../../lib/types';
import { ROLE_LABELS } from '../access-panel';
import { ThemeChoice, type ThemePreference } from '../evolution-controls';
import { SecurityCenter, SecurityHealthPanel } from '../security-center';
import { PageTitle, View } from './shared';

/**
 * Configuración de la persona, como la de Parte Diario: Apariencia, Cuenta, Sesión y Ayuda. Es para todos los
 * roles del equipo y no decide nada por su cuenta: el tema lo guarda el escritorio (el mismo que cambia el botón
 * del riel), la seguridad son los mismos paneles que antes estaban en «Seguridad» y «Cerrar sesión» abre la
 * confirmación de siempre. Los ajustes del espacio (solo administradores) son otra vista: ?view=settings.
 */
export function AccountView({
  data,
  viewerName,
  isAdmin,
  theme,
  themeError,
  onChooseTheme,
  onSignOut,
  go,
}: {
  data: Workspace;
  viewerName: string;
  isAdmin: boolean;
  theme: ThemePreference;
  themeError: string;
  onChooseTheme: (theme: ThemePreference) => void;
  onSignOut: () => void;
  go: (view: View) => void;
}) {
  const viewer = data.viewer!;
  return (
    <div className="account-view">
      <PageTitle title="Configuración" />
      <section className="panel settings-card" aria-labelledby="configuracion-apariencia">
        <div className="settings-card-head">
          <span className="settings-kicker">Apariencia</span>
          <h2 id="configuracion-apariencia">Cómo se ve la aplicación</h2>
        </div>
        <ThemeChoice theme={theme} onChoose={onChooseTheme} />
        <p className="settings-note">
          «Según el sistema» sigue el modo claro u oscuro del dispositivo, también cuando cambia. La elección queda
          guardada en tu cuenta.
        </p>
        {themeError && (
          <p className="settings-note settings-note--error" role="status">
            {themeError}
          </p>
        )}
      </section>
      <section className="panel settings-card" aria-labelledby="configuracion-cuenta">
        <div className="settings-card-head">
          <span className="settings-kicker">Cuenta</span>
          <h2 id="configuracion-cuenta">{viewerName}</h2>
        </div>
        <dl className="settings-facts">
          <div>
            <dt>Correo</dt>
            <dd>{viewer.email}</dd>
          </div>
          <div>
            <dt>Rol</dt>
            <dd>{ROLE_LABELS[viewer.role]}</dd>
          </div>
        </dl>
      </section>
      {/* La seguridad de la cuenta, tal como estaba en la vista «Seguridad». */}
      <SecurityCenter
        key={`security:${viewer.id}`}
        memberId={viewer.id}
        returnTo={workspaceHome(currentWorkspaceId())}
      />
      {isAdmin &&
        (data.evolution?.features.security ? (
          <SecurityHealthPanel key={`health:${viewer.id}`} memberId={viewer.id} />
        ) : (
          <p className="info-note">
            El panel de salud y auditoría está preparado. Activa Seguridad en las funciones del espacio para revisarlo.
            El acceso y la política de doble factor se siguen aplicando.
          </p>
        ))}
      <section className="panel settings-card" aria-labelledby="configuracion-sesion">
        <div className="settings-card-head">
          <span className="settings-kicker">Sesión</span>
          <h2 id="configuracion-sesion">Salir de este dispositivo</h2>
        </div>
        <p className="settings-note">Tendrás que ingresar de nuevo para seguir.</p>
        <div className="settings-actions">
          <button type="button" className="danger-button" onClick={onSignOut}>
            <LogOut size={17} aria-hidden="true" />
            Cerrar sesión
          </button>
        </div>
      </section>
      <section className="panel settings-card" aria-labelledby="configuracion-ayuda">
        <div className="settings-card-head">
          <span className="settings-kicker">Ayuda</span>
          <h2 id="configuracion-ayuda">Centro de ayuda</h2>
        </div>
        <p className="settings-note">
          Los artículos que consultan los clientes, con las versiones aprobadas para cada empresa.
        </p>
        <div className="settings-actions">
          <button type="button" className="secondary" onClick={() => go('portal')}>
            <LifeBuoy size={17} aria-hidden="true" />
            Abrir el centro de ayuda
          </button>
        </div>
      </section>
    </div>
  );
}
