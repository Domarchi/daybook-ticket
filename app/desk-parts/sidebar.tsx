'use client';
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  Clock3,
  Headphones,
  Inbox,
  Layers3,
  Laptop,
  PackageCheck,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Settings2,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { type Workspace } from '../../lib/types';
import { ROLE_LABELS } from '../access-panel';
import Brand from '../brand';
import { WorkspaceSwitcher } from '../workspace-navigation';
import { cloneElement, useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { Avatar, View } from './shared';
import { ThemeControl } from '../evolution-controls';

export function Sidebar({
  view,
  mobile,
  onClose,
  go,
  counts,
  setQueue,
  isAdmin,
  data,
  busy,
  signOut,
  viewerName,
}: {
  view: View;
  mobile: boolean;
  onClose: () => void;
  go: (view: View) => void;
  counts: Record<string, number>;
  setQueue: (value: string) => void;
  isAdmin: boolean;
  data: Workspace;
  busy: boolean;
  signOut: () => void;
  viewerName: string;
}) {
  const ref = useRef<HTMLElement>(null);
  // The menu is a drawer on narrow screens: take focus when it opens, keep Tab inside it,
  // close on Escape, lock the page scroll and give focus back to the button that opened it.
  useEffect(() => {
    if (!mobile) return;
    const drawer = ref.current;
    if (!drawer) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () =>
      [
        ...drawer.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter(element => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus();
    };
  }, [mobile, onClose]);
  return (
    <aside
      ref={ref}
      id="daybook-navigation"
      className={`sidebar ${mobile ? 'is-open' : ''}`}
      {...(mobile ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Menú de navegación' } : {})}
    >
      <div className="db-brand-block db-on-dark">
        <button className="brand" onClick={() => go('inbox')}>
          <Brand dark />
        </button>
      </div>
      <div className="workspace">
        <span className="workspace-icon">
          <Headphones size={19} />
        </span>
        <div>
          {data.workspaceName || data.settings.brandName}
          <small>Centro de soporte compartido</small>
        </div>
        <ShieldCheck size={16} />
      </div>
      {/* La lista es la común de la familia (@daybook/design/riel.css), igual que en Parte Diario.
          Se desplaza ella sola: la persona, salir y el tema quedan siempre a la vista abajo. */}
      <div className="sidebar-scroll">
        <nav className="db-rail-nav" aria-label="Navegación principal">
          <p className="db-rail-section">Espacio de trabajo</p>
          <RailLink view="overview" current={view} go={go} icon={<LayoutDashboard />} label="Resumen" />
          <RailLink
            view="inbox"
            current={view}
            go={go}
            icon={<Inbox />}
            label="Bandeja de entrada"
            count={counts.active}
          />
          <RailLink view="contacts" current={view} go={go} icon={<Users />} label="Contactos" />
          <RailLink view="equipment" current={view} go={go} icon={<Laptop />} label="Equipos" />
          <RailLink view="requirements" current={view} go={go} icon={<PackageCheck />} label="Requerimientos" />
          {data.evolution?.features.serviceContext && (
            <RailLink view="service" current={view} go={go} icon={<Headphones />} label="Empresas y servicios" />
          )}
          <RailLink view="knowledge" current={view} go={go} icon={<BookOpen />} label="Conocimiento" />
          {data.evolution?.features.knowledge && (
            <RailLink view="reports" current={view} go={go} icon={<Activity />} label="Informes por empresa" />
          )}
          {isAdmin && <RailLink view="team" current={view} go={go} icon={<Layers3 />} label="Equipo y clientes" />}
          {isAdmin && (
            <RailLink view="operations" current={view} go={go} icon={<Clock3 />} label="Atención y reparto" />
          )}
          {isAdmin && (
            <RailLink view="metrics" current={view} go={go} icon={<Activity />} label="Métricas del equipo" />
          )}
        </nav>
        <nav className="db-rail-nav" aria-label="Vistas rápidas">
          <p className="db-rail-section">Vistas rápidas</p>
          {(
            [
              ['mine', 'Asignados a mí', 'purple'],
              ['unassigned', 'Sin asignar', 'amber'],
              ['overdue', 'SLA vencido', 'coral'],
            ] as const
          ).map(([queue, label, tone]) => (
            <button
              key={queue}
              className="db-rail-link"
              onClick={() => {
                go('inbox');
                setQueue(queue);
              }}
            >
              <span className={`nav-dot ${tone}`} />
              <span className="db-rail-link__label">{label}</span>
              <span className="db-rail-count">{counts[queue]}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-workspaces">
          <WorkspaceSwitcher />
        </div>
        <nav className="db-rail-nav" aria-label="Cuenta y ayuda">
          <hr className="db-rail-divider" />
          <RailLink view="security" current={view} go={go} icon={<ShieldCheck />} label="Seguridad" />
          {isAdmin && <RailLink view="settings" current={view} go={go} icon={<Settings2 />} label="Configuración" />}
          <RailLink
            view="portal"
            current={view}
            go={go}
            icon={<LifeBuoy />}
            label="Centro de ayuda"
            trailing={<ArrowUpRight size={14} aria-hidden="true" />}
          />
        </nav>
      </div>
      <div className="sidebar-bottom">
        <div className="profile">
          <Avatar name={viewerName} small />
          <button
            className="profile-security"
            type="button"
            onClick={() => go('security')}
            title="Gestionar seguridad de mi cuenta"
          >
            {viewerName}
            <small>{data.viewer ? ROLE_LABELS[data.viewer.role] : 'Preparando acceso'}</small>
          </button>
          <button disabled={busy} onClick={signOut} aria-label="Cerrar sesión" title="Cerrar sesión">
            <LogOut size={16} aria-hidden="true" />
          </button>
        </div>
        {/* El tema, en el pie del riel junto a la persona, como en Parte Diario y
            Daybook Travel. En el teléfono el riel es el menú, así que también está. */}
        {data.viewer && (
          <ThemeControl
            key={data.viewer.id}
            memberId={data.viewer.id}
            preferred={data.preferences?.theme || 'system'}
          />
        )}
      </div>
    </aside>
  );
}

/** A row of the rail: the shared look (riel.css) and the place where the person is (aria-current). */
function RailLink({
  view,
  current,
  go,
  icon,
  label,
  count,
  trailing,
}: {
  view: View;
  current: View;
  go: (view: View) => void;
  icon: ReactElement<{ size?: number }>;
  label: string;
  count?: number;
  trailing?: ReactNode;
}) {
  const here = current === view;
  return (
    <button
      className={`db-rail-link${here ? ' active' : ''}`}
      aria-current={here ? 'page' : undefined}
      onClick={() => go(view)}
    >
      {cloneElement(icon, { size: 18 })}
      <span className="db-rail-link__label">{label}</span>
      {count !== undefined && <span className="db-rail-count">{count}</span>}
      {trailing}
    </button>
  );
}
