'use client';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Clock3,
  Headphones,
  Inbox,
  Layers3,
  LayoutDashboard,
  LifeBuoy,
  Settings2,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { type Workspace } from '../../lib/types';
import { ROLE_LABELS } from '../access-panel';
import Brand from '../brand';
import { WorkspaceSwitcher } from '../workspace-navigation';
import { useEffect, useRef } from 'react';
import { Avatar, View } from './shared';

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
      <button className="brand" onClick={() => go('inbox')}>
        <Brand dark />
      </button>
      <div className="workspace">
        <span className="workspace-icon">
          <Headphones size={19} />
        </span>
        <div>
          Servicios Daybook<small>Centro de soporte compartido</small>
        </div>
        <ShieldCheck size={16} />
      </div>
      <p className="nav-label">ESPACIO DE TRABAJO</p>
      <nav aria-label="Navegación principal">
        <button
          className={view === 'overview' ? 'active' : ''}
          aria-current={view === 'overview' ? 'page' : undefined}
          onClick={() => go('overview')}
        >
          <LayoutDashboard size={18} />
          Resumen
        </button>
        <button
          className={view === 'inbox' ? 'active' : ''}
          aria-current={view === 'inbox' ? 'page' : undefined}
          onClick={() => go('inbox')}
        >
          <Inbox size={18} />
          Bandeja de entrada<span className="nav-count">{counts.active}</span>
        </button>
        <button
          className={view === 'contacts' ? 'active' : ''}
          aria-current={view === 'contacts' ? 'page' : undefined}
          onClick={() => go('contacts')}
        >
          <Users size={18} />
          Contactos
        </button>
        {data.evolution?.features.serviceContext && (
          <button
            className={view === 'service' ? 'active' : ''}
            aria-current={view === 'service' ? 'page' : undefined}
            onClick={() => go('service')}
          >
            <Headphones size={18} />
            Empresas y servicios
          </button>
        )}
        <button
          className={view === 'knowledge' ? 'active' : ''}
          aria-current={view === 'knowledge' ? 'page' : undefined}
          onClick={() => go('knowledge')}
        >
          <BookOpen size={18} />
          Conocimiento
        </button>
        {data.evolution?.features.knowledge && (
          <button
            className={view === 'reports' ? 'active' : ''}
            aria-current={view === 'reports' ? 'page' : undefined}
            onClick={() => go('reports')}
          >
            <Activity size={18} />
            Informes por empresa
          </button>
        )}
        {isAdmin && (
          <button
            className={view === 'team' ? 'active' : ''}
            aria-current={view === 'team' ? 'page' : undefined}
            onClick={() => go('team')}
          >
            <Layers3 size={18} />
            Equipo y clientes
          </button>
        )}
        {isAdmin && (
          <button
            className={view === 'operations' ? 'active' : ''}
            aria-current={view === 'operations' ? 'page' : undefined}
            onClick={() => go('operations')}
          >
            <Clock3 size={18} />
            Atención y reparto
          </button>
        )}
        {isAdmin && (
          <button
            className={view === 'metrics' ? 'active' : ''}
            aria-current={view === 'metrics' ? 'page' : undefined}
            onClick={() => go('metrics')}
          >
            <Activity size={18} />
            Métricas del equipo
          </button>
        )}
      </nav>
      <p className="nav-label">VISTAS RÁPIDAS</p>
      <nav aria-label="Vistas rápidas">
        <button
          onClick={() => {
            go('inbox');
            setQueue('mine');
          }}
        >
          <span className="nav-dot purple" />
          Asignados a mí<span className="sub-count">{counts.mine}</span>
        </button>
        <button
          onClick={() => {
            go('inbox');
            setQueue('unassigned');
          }}
        >
          <span className="nav-dot amber" />
          Sin asignar<span className="sub-count">{counts.unassigned}</span>
        </button>
        <button
          onClick={() => {
            go('inbox');
            setQueue('overdue');
          }}
        >
          <span className="nav-dot coral" />
          SLA vencido<span className="sub-count">{counts.overdue}</span>
        </button>
      </nav>
      <div className="sidebar-bottom">
        <WorkspaceSwitcher />
        <nav>
          <button className={view === 'security' ? 'active' : ''} onClick={() => go('security')}>
            <ShieldCheck size={18} />
            Seguridad
          </button>
          {isAdmin && (
            <button className={view === 'settings' ? 'active' : ''} onClick={() => go('settings')}>
              <Settings2 size={18} />
              Configuración
            </button>
          )}
          <button className={view === 'portal' ? 'active' : ''} onClick={() => go('portal')}>
            <LifeBuoy size={18} />
            Centro de ayuda
            <ArrowUpRight size={14} />
          </button>
        </nav>
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
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
