'use client';
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  Clock3,
  Headphones,
  Inbox,
  Layers3,
  Laptop,
  PackageCheck,
  LayoutDashboard,
  LifeBuoy,
  Settings,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import { type Workspace } from '../../lib/types';
import { ROLE_LABELS } from '../access-panel';
import Brand from '../brand';
import Link from 'next/link';
import { cloneElement, useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { initials, View } from './shared';
import { ThemeCycleButton, type ThemePreference } from '../evolution-controls';

/**
 * El riel, igual que el de Parte Diario (@daybook/design riel.css y marca.css): marca, el espacio, la lista que se
 * desplaza sola y el pie con la persona y el tema. Salir y la cuenta viven en Configuración, una fila más.
 * En el teléfono el riel es el cajón del ☰ (`.db-rail-drawer`): entra desde la izquierda, se cierra con la ✕,
 * con Escape o tocando el velo, y devuelve el foco al ☰.
 */
export function Sidebar({
  view,
  narrow,
  open,
  onClose,
  go,
  counts,
  setQueue,
  isAdmin,
  data,
  viewerName,
  theme,
  themeError,
  onChooseTheme,
}: {
  view: View;
  /** El riel es cajón (ancho de teléfono). */
  narrow: boolean;
  /** El cajón está abierto. */
  open: boolean;
  onClose: () => void;
  go: (view: View) => void;
  counts: Record<string, number>;
  setQueue: (value: string) => void;
  isAdmin: boolean;
  data: Workspace;
  viewerName: string;
  theme: ThemePreference;
  themeError: string;
  onChooseTheme: (theme: ThemePreference) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  // Abierto el cajón: el foco entra al primer destino un cuadro después (ya visible), Tab queda dentro,
  // Escape lo cierra, la página de atrás no se desplaza y al cerrar el foco vuelve al botón que lo abrió.
  useEffect(() => {
    if (!open) return;
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
    const frame = requestAnimationFrame(() => drawer.querySelector<HTMLElement>('.db-rail-nav .db-rail-link')?.focus());
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
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus();
    };
  }, [open, onClose]);
  const overdue = counts.overdue ?? 0;
  return (
    <aside
      ref={ref}
      id="daybook-navigation"
      className={`sidebar${narrow ? ' db-rail-drawer' : ''}`}
      data-open={narrow ? String(open) : undefined}
      {...(open ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Menú de navegación' } : {})}
    >
      {/* En el teléfono esta ✕ cierra el cajón; en escritorio el CSS la oculta. */}
      <button type="button" className="db-rail-icon-button sidebar-close" aria-label="Cerrar menú" onClick={onClose}>
        <X aria-hidden="true" />
      </button>
      <div className="db-brand-block db-on-dark">
        <button className="brand" onClick={() => go('inbox')}>
          <Brand dark />
        </button>
      </div>
      {/* El espacio actual, una sola vez: tocarlo abre «Mis espacios» para cambiar a otro. Antes había además un
          selector y un enlace de 18 px más abajo que repetían lo mismo. */}
      <Link
        href="/workspaces"
        className="workspace"
        aria-label={`${data.workspaceName || data.settings.brandName}. Cambiar de espacio`}
      >
        <span className="workspace-icon">
          <Headphones size={18} aria-hidden="true" />
        </span>
        <div>
          {data.workspaceName || data.settings.brandName}
          <small>Centro de soporte compartido</small>
        </div>
        <ChevronRight size={16} aria-hidden="true" />
      </Link>
      {/* La lista común de la familia; se desplaza ella sola (con sombra cuando hay más filas) y el pie queda
          siempre a la vista. */}
      <div className="db-rail-scroll">
        <nav className="db-rail-nav" aria-label="Navegación principal">
          <p className="db-rail-section">Espacio de trabajo</p>
          <RailLink view="overview" current={view} go={go} icon={<LayoutDashboard />} label="Resumen" />
          <RailLink
            view="inbox"
            current={view}
            go={go}
            icon={<Inbox />}
            // «Bandeja de entrada» no cabe junto al número en 232 px; el título de la vista la nombra entera.
            label="Bandeja"
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
              {/* Solo el SLA vencido pide atención: en dorado, y con un pulso cuando cambia (key = número). */}
              {queue === 'overdue' && overdue > 0 ? (
                <span key={overdue} className="db-rail-count db-rail-count--alert">
                  {overdue}
                </span>
              ) : (
                <span className="db-rail-count">{counts[queue]}</span>
              )}
            </button>
          ))}
        </nav>
        <nav className="db-rail-nav" aria-label="Cuenta y ayuda">
          <hr className="db-rail-divider" />
          <RailLink view="account" current={view} go={go} icon={<Settings />} label="Configuración" />
          {isAdmin && (
            <RailLink view="settings" current={view} go={go} icon={<SlidersHorizontal />} label="Ajustes del espacio" />
          )}
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
      {/* El pie común: quién está y el tema, en una fila. */}
      <div className="db-rail-footer">
        {themeError && (
          <p className="sidebar-theme-error" role="status">
            {themeError}
          </p>
        )}
        <div className="db-rail-account">
          <span className="db-rail-avatar" aria-hidden="true">
            {initials(viewerName) || '?'}
          </span>
          <span className="db-rail-account__text">
            <strong className="db-rail-account__name">{viewerName}</strong>
            <small className="db-rail-account__role">
              {data.viewer ? ROLE_LABELS[data.viewer.role] : 'Preparando acceso'}
            </small>
          </span>
          {data.viewer && <ThemeCycleButton theme={theme} onChoose={onChooseTheme} />}
        </div>
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
