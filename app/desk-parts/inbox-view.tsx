'use client';
import { normalizeTeamFilters, useTeamFilters } from '@/hooks/use-team-filters';
import { FAULT_GROUPS } from '../../lib/ticket-category-model';
import { isActive } from '../../lib/ticket-status';
import { type TicketFilters, useTicketSearch } from '@/hooks/use-ticket-search';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Filter,
  Inbox,
  MessageSquare,
  Plus,
  Search,
  Zap,
} from 'lucide-react';
import { type RefObject } from 'react';
import { useMediaQuery } from '@/hooks/use-media-query';
import { type Member, type Ticket, type Workspace } from '../../lib/types';
import { MyAvailabilityPanel } from '../operations-settings';
import { TicketPagination } from '../ticket-pagination';
import { SavedViewPicker } from '../work-organization';
import { PRIORITY, since, sla, Avatar, Status, Priority, SearchShortcut, Empty, Stat, DeskLink, View } from './shared';
import { Combobox } from '../combobox';
import { Overview } from './overview';
import { TicketCards } from './ticket-cards';

export function InboxView({
  view,
  data,
  busy,
  isAdmin,
  now,
  counts,
  search,
  setSearch,
  teamFilters,
  updateTeamFilters,
  queue,
  priority,
  department,
  setQueue,
  setPriority,
  setDepartment,
  showFilters,
  setShowFilters,
  setSelected,
  visibleSelected,
  filtered,
  searchResults,
  searchRef,
  staffMembers,
  exportCsv,
  resolveSelected,
  loadDemo,
  setCreate,
  openTicket,
  go,
}: {
  view: View;
  data: Workspace;
  busy: boolean;
  isAdmin: boolean;
  now: number;
  counts: Record<string, number>;
  search: string;
  setSearch: (value: string) => void;
  teamFilters: ReturnType<typeof useTeamFilters>['filters'];
  updateTeamFilters: ReturnType<typeof useTeamFilters>['update'];
  queue: string;
  priority: string;
  department: string;
  setQueue: (value: string) => void;
  setPriority: (value: string) => void;
  setDepartment: (value: string) => void;
  showFilters: boolean;
  setShowFilters: (value: boolean) => void;
  setSelected: (ids: number[]) => void;
  visibleSelected: number[];
  filtered: Ticket[];
  searchResults: ReturnType<typeof useTicketSearch>;
  searchRef: RefObject<HTMLInputElement | null>;
  staffMembers: Member[];
  exportCsv: () => Promise<void>;
  resolveSelected: () => Promise<void>;
  loadDemo: () => Promise<boolean>;
  setCreate: (value: boolean) => void;
  openTicket: (ticket: Ticket) => void;
  go: (view: View) => void;
}) {
  const narrow = useMediaQuery('(max-width: 750px)');
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="tiny-line" /> CADA CONVERSACIÓN CUENTA
          </div>
          <h1>{view === 'inbox' ? 'Bandeja de entrada' : 'Tu soporte, en perspectiva'}</h1>
          <p>
            {view === 'inbox'
              ? 'Todo lo que tu equipo necesita para dar una gran respuesta.'
              : 'Una vista clara del trabajo y las conversaciones que importan.'}
          </p>
        </div>
        <div className="heading-actions">
          <button className="secondary" disabled={busy} onClick={exportCsv}>
            <ArrowDownToLine size={16} />
            Exportar
          </button>
          <button className="primary" disabled={busy} onClick={() => setCreate(true)}>
            <Plus size={17} />
            Nuevo ticket
          </button>
        </div>
      </div>
      <div className="stats">
        <Stat
          label="Sin asignar"
          value={counts.unassigned}
          icon={<Clock3 size={19} />}
          detail={counts.unassigned ? 'Esperan un responsable' : 'Todo tiene responsable'}
          color="amber"
        />
        <Stat
          label="En proceso"
          value={counts.inProgress}
          icon={<Inbox size={19} />}
          detail="Con alguien trabajando en ellos"
          color="blue"
        />
        <Stat
          label="Solucionados"
          value={counts.resolved}
          icon={<CheckCircle2 size={19} />}
          detail="Conversaciones completadas"
          color="green"
        />
        <Stat
          label="SLA vencido"
          value={counts.overdue}
          icon={<Zap size={19} />}
          detail={counts.overdue ? 'Necesitan tu atención' : 'Todo dentro del plazo'}
          color="purple"
        />
      </div>
      {view === 'overview' ? (
        <>
          <MyAvailabilityPanel key={data.viewer!.id} memberId={data.viewer!.id} />
          <Overview data={data} now={now} onOpen={openTicket} />
        </>
      ) : (
        <div className="inbox-grid">
          <section className="ticket-panel">
            {data.evolution?.features.organization && (
              <SavedViewPicker
                key={data.viewer!.id}
                memberId={data.viewer!.id}
                filters={{
                  q: search,
                  queue: queue as TicketFilters['queue'],
                  priority: priority as TicketFilters['priority'],
                  department,
                  category: teamFilters.category,
                  company: teamFilters.company,
                  agent: teamFilters.agent,
                }}
                onApply={filters => {
                  setSearch(filters.q || '');
                  updateTeamFilters(normalizeTeamFilters(filters));
                  setSelected([]);
                }}
              />
            )}
            <div className="queue-tabs">
              {(
                [
                  ['all', 'Todos', counts.all],
                  ['unassigned', 'Sin asignar', counts.unassigned],
                  ['inprogress', 'En proceso', counts.inProgress],
                  ['resolved', 'Solucionados', counts.resolved],
                  ['closed', 'Cerrados', counts.closed],
                ] as [string, string, number][]
              ).map(([k, v, count]) => (
                <button
                  key={k}
                  className={queue === k ? 'active' : ''}
                  aria-pressed={queue === k}
                  onClick={() => {
                    setQueue(k);
                    setSelected([]);
                  }}
                >
                  {v}
                  <span>{count}</span>
                </button>
              ))}
              {['mine', 'overdue'].includes(queue) && (
                <button className="active" aria-pressed="true">
                  {queue === 'mine' ? 'Mis tickets' : 'SLA vencido'}
                  <span>{counts[queue as 'mine' | 'overdue']}</span>
                </button>
              )}
            </div>
            <div className="table-tools">
              <label className="search-box">
                <Search size={17} />
                <input
                  ref={searchRef}
                  aria-label="Buscar tickets"
                  placeholder="Buscar en tickets y conversaciones…"
                  value={search}
                  onChange={e => {
                    setSearch(e.target.value);
                    setSelected([]);
                  }}
                />
                <SearchShortcut />
              </label>
              <button
                className={`secondary filter-button ${showFilters ? 'selected' : ''}`}
                onClick={() => setShowFilters(!showFilters)}
              >
                <Filter size={15} />
                Filtros
                {(priority !== 'all' ||
                  department !== 'all' ||
                  teamFilters.category !== 'all' ||
                  teamFilters.company !== 'all' ||
                  teamFilters.agent !== 'all') && <span className="filter-dot" />}
              </button>
            </div>
            {(showFilters ||
              priority !== 'all' ||
              department !== 'all' ||
              teamFilters.category !== 'all' ||
              teamFilters.company !== 'all' ||
              teamFilters.agent !== 'all') && (
              <div className="filter-row">
                <select
                  aria-label="Filtrar por prioridad"
                  value={priority}
                  onChange={e => {
                    setPriority(e.target.value);
                    setSelected([]);
                  }}
                >
                  <option value="all">Todas las prioridades</option>
                  {Object.entries(PRIORITY).map(([k, v]) => (
                    <option value={k} key={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filtrar por departamento"
                  value={department}
                  onChange={e => {
                    setDepartment(e.target.value);
                    setSelected([]);
                  }}
                >
                  <option value="all">Todos los departamentos</option>
                  {data.settings.departments.map(a => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
                <select
                  aria-label="Filtrar por categoría"
                  value={teamFilters.category}
                  onChange={e => {
                    updateTeamFilters({ ...teamFilters, category: e.target.value });
                    setSelected([]);
                  }}
                >
                  <option value="all">Todas las categorías</option>
                  {FAULT_GROUPS.map(group => (
                    <option key={group.id} value={group.id}>
                      {group.label}
                    </option>
                  ))}
                  <option value="requests">Solo requerimientos</option>
                  <option value="unclassified">Sin clasificar</option>
                </select>
                <Combobox
                  compact
                  ariaLabel="Filtrar por empresa"
                  value={teamFilters.company}
                  onChange={value => {
                    updateTeamFilters({ ...teamFilters, company: value });
                    setSelected([]);
                  }}
                  options={[
                    { value: 'all', label: 'Todas las empresas' },
                    { value: 'none', label: 'Sin empresa' },
                    ...(data.companies ?? []).map(company => ({ value: company.id, label: company.name })),
                  ]}
                />
                <Combobox
                  compact
                  ariaLabel="Filtrar por agente"
                  value={teamFilters.agent}
                  onChange={value => {
                    updateTeamFilters({ ...teamFilters, agent: value });
                    setSelected([]);
                  }}
                  options={[
                    { value: 'all', label: 'Todos los agentes' },
                    { value: 'none', label: 'Sin asignar' },
                    ...staffMembers.map(member => ({ value: member.id, label: member.name, hint: member.email })),
                  ]}
                />
                <button
                  className="text-button"
                  onClick={() => {
                    setSearch('');
                    updateTeamFilters({
                      ...teamFilters,
                      company: 'all',
                      agent: 'all',
                      priority: 'all',
                      department: 'all',
                      category: 'all',
                    });
                    setSelected([]);
                  }}
                >
                  Limpiar
                </button>
              </div>
            )}
            {visibleSelected.length > 0 && (
              <div className="bulk-bar">
                <strong>{visibleSelected.length} seleccionados</strong>
                <button
                  disabled={busy}
                  onClick={() => {
                    void resolveSelected();
                  }}
                >
                  <CheckCheck size={16} />
                  Marcar como solucionados
                </button>
                <button onClick={() => setSelected([])}>Cancelar</button>
              </div>
            )}
            {counts.all === 0 ? (
              <div className="welcome">
                <div className="welcome-art">
                  <div className="art-halo" />
                  <div className="art-envelope">
                    <MessageSquare size={34} strokeWidth={1.3} />
                    <span>
                      <Check size={13} />
                    </span>
                  </div>
                  <span className="art-dot one" />
                  <span className="art-dot two" />
                </div>
                <span className="eyebrow">LAS BUENAS RELACIONES EMPIEZAN AQUÍ</span>
                <h2>
                  Un nuevo espacio.
                  <br />
                  Muchas conversaciones por venir.
                </h2>
                <p>
                  Crea tu primer ticket y convierte cada solicitud
                  <br className="desktop" /> en una experiencia de atención excepcional.
                </p>
                <div>
                  <button className="primary" disabled={busy} onClick={() => setCreate(true)}>
                    <Plus size={16} />
                    Crear mi primer ticket
                  </button>
                  {isAdmin && (
                    <button className="text-button" disabled={busy} onClick={loadDemo}>
                      Explorar con ejemplos <ArrowRight size={15} />
                    </button>
                  )}
                </div>
                {isAdmin && <small>Los ejemplos son datos ficticios y se guardarán en tu espacio.</small>}
              </div>
            ) : searchResults.error ? (
              <p className="ticket-search-feedback" role="alert">
                {searchResults.error}
              </p>
            ) : searchResults.loading && filtered.length === 0 ? (
              <p className="ticket-search-feedback" role="status">
                Buscando tickets y conversaciones…
              </p>
            ) : filtered.length === 0 ? (
              <Empty title="No hay tickets en esta vista">Prueba otra búsqueda o ajusta los filtros.</Empty>
            ) : narrow ? (
              <TicketCards
                tickets={filtered}
                selected={visibleSelected}
                setSelected={setSelected}
                now={now}
                onOpen={openTicket}
              />
            ) : (
              <div className="table-scroll">
                <table className="ticket-table">
                  <thead>
                    <tr>
                      <th className="check-cell">
                        <input
                          type="checkbox"
                          aria-label="Seleccionar tickets de esta vista"
                          checked={filtered.length > 0 && filtered.every(t => visibleSelected.includes(t.id))}
                          onChange={e => setSelected(e.target.checked ? filtered.map(t => t.id) : [])}
                        />
                      </th>
                      <th>Ticket y solicitante</th>
                      <th>Estado</th>
                      <th>Prioridad</th>
                      <th>Responsable</th>
                      <th>Actualizado</th>
                      <th>
                        <span className="sr-only">Abrir ticket</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(t => (
                      <tr key={t.id}>
                        <td className="check-cell">
                          <input
                            type="checkbox"
                            aria-label={`Seleccionar ticket ${t.id}`}
                            checked={visibleSelected.includes(t.id)}
                            onChange={e =>
                              setSelected(
                                e.target.checked
                                  ? [...visibleSelected, t.id]
                                  : visibleSelected.filter(id => id !== t.id),
                              )
                            }
                          />
                        </td>
                        <td className="subject-cell">
                          <DeskLink to={{ ticketId: t.id }} onNavigate={() => openTicket(t)}>
                            <span>
                              <span className="ticket-number">#{String(t.id).padStart(4, '0')}</span>
                              {t.subject}
                            </span>
                            <small>
                              {t.requesterName}
                              <i /> {t.department}
                            </small>
                          </DeskLink>
                        </td>
                        <td>
                          <Status ticket={t} />
                        </td>
                        <td>
                          <Priority priority={t.priority} />
                        </td>
                        <td>
                          <div className="assignee">
                            {t.assignee ? (
                              <>
                                <Avatar name={t.assignee} small />
                                <span>{t.assignee.split(' ')[0]}</span>
                              </>
                            ) : (
                              <span className="unassigned">Sin asignar</span>
                            )}
                          </div>
                        </td>
                        <td className="time-cell">
                          <span>{since(t.updatedAt, now)}</span>
                          {isActive(t.status) && (
                            <small className={sla(t, now) === 'Vencido' ? 'late-text' : ''}>{sla(t, now)}</small>
                          )}
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            onClick={() => openTicket(t)}
                            aria-label={`Abrir ticket ${t.id}`}
                            tabIndex={-1}
                          >
                            <ChevronRight size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <TicketPagination
              index={searchResults.index}
              shown={filtered.length}
              total={searchResults.total}
              nextCursor={searchResults.nextCursor}
              previous={() => {
                setSelected([]);
                searchResults.previous();
              }}
              next={() => {
                setSelected([]);
                searchResults.next();
              }}
              loading={searchResults.loading}
            />
          </section>
          <aside className="focus-panel">
            <div className="focus-heading">
              <span className="focus-icon">
                <Activity size={18} />
              </span>
              <h2>En foco</h2>
              <span className="tiny-live" />
            </div>
            <p>
              Las pequeñas acciones
              <br />
              hacen la diferencia.
            </p>
            <div className="focus-divider" />
            <div className="focus-count">
              <span>{counts.overdue}</span>
              <div>
                tickets fuera de plazo<small>Prioriza las conversaciones pendientes.</small>
              </div>
            </div>
            <button className="focus-link" onClick={() => setQueue('overdue')}>
              Revisar prioridad <ArrowRight size={15} />
            </button>
            <div className="focus-divider" />
            <span className="eyebrow">TU PRÓXIMO PASO</span>
            <div className="next-step">
              <span>01</span>
              <div>
                <strong>{counts.unassigned ? 'Distribuye la carga' : 'Comparte lo que sabes'}</strong>
                <p>
                  {counts.unassigned
                    ? `${counts.unassigned} solicitudes aún no tienen responsable.`
                    : 'Una buena guía puede resolver la siguiente pregunta.'}
                </p>
              </div>
            </div>
            <button
              className="focus-link"
              onClick={() => (counts.unassigned ? setQueue('unassigned') : go('knowledge'))}
            >
              {counts.unassigned ? 'Asignar tickets' : 'Crear un artículo'}
              <ArrowRight size={15} />
            </button>
            <div className="focus-quote">
              <span>“</span>Un gran soporte empieza
              <br />
              por escuchar.
              <div className="quote-line" />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
