'use client';
import Brand from './brand';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, CheckCheck, CheckCircle2, ChevronDown, ChevronRight, Circle, Clock3, Ellipsis, Filter, Headphones, Inbox, Layers3, LayoutDashboard, LifeBuoy, LoaderCircle, Menu, MessageSquare, Plus, Search, Send, Settings2, ShieldCheck, Sparkles, Ticket as TicketIcon, Users, X, Zap } from 'lucide-react';
import { type Article, type Member, type Settings, type Ticket, type TicketPriority, type TicketStatus, type Workspace } from '../lib/types';
import ClientPortal from './client-portal';
import { AccessPanel, MailPanel, ROLE_LABELS } from './access-panel';
import { useWorkspace } from '@/hooks/use-workspace';
import { LiveStatus } from './live-status';
import { useTicketAlerts } from '@/hooks/use-ticket-alerts';
import { TicketAlerts } from './ticket-alerts';
import { disconnectPushOnSignOut } from '@/lib/push-client';
const STATUS: Record<TicketStatus, string> = { open: 'Abierto', pending: 'En espera', resolved: 'Resuelto' };
const PRIORITY: Record<TicketPriority, string> = { urgent: 'Urgente', high: 'Alta', normal: 'Normal', low: 'Baja' };
type View = 'inbox' | 'overview' | 'contacts' | 'knowledge' | 'team' | 'settings' | 'portal';
const views: Record<View, string> = { inbox: 'Bandeja de entrada', overview: 'Resumen', contacts: 'Contactos', knowledge: 'Conocimiento', team: 'Equipo y clientes', settings: 'Configuración', portal: 'Centro de ayuda' };
function initials(name: string) { return name.split(' ').filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase(); }
function fmtDate(s: string) { return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(s)); }
function since(s: string) { const n = Math.max(0, (Date.now() - Date.parse(s)) / 60000); return n < 1 ? 'Ahora' : n < 60 ? `${Math.floor(n)} min` : n < 1440 ? `${Math.floor(n / 60)} h` : `${Math.floor(n / 1440)} d`; }
function sla(t: Ticket) { const mins = Math.round((Date.parse(t.dueAt) - Date.now()) / 60000); return t.status === 'resolved' ? 'Completado' : mins < 0 ? 'Vencido' : mins < 60 ? `${mins} min restantes` : `${Math.floor(mins / 60)} h restantes`; }
function Avatar({ name, small = false }: {
    name: string;
    small?: boolean;
}) { return <span className={`avatar ${small ? 'small' : ''}`} style={{ background: ['#e5e8fa', '#e4eee5', '#f7e8dc', '#e7edf2'][name.length % 4] }}>{initials(name) || '?'}</span>; }
function Status({ status }: {
    status: TicketStatus;
}) { return <span className={`status ${status}`}><span />{STATUS[status]}</span>; }
function Priority({ priority }: {
    priority: TicketPriority;
}) { return <span className={`priority ${priority}`}><span className="bars"><i /><i /><i /></span>{PRIORITY[priority]}</span>; }
async function request(path: string, method = 'GET', body?: unknown) { const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); let j: any = {}; try {
    j = await r.json();
}
catch { } if (!r.ok)
    throw new Error(typeof j.error === 'string' ? j.error : 'No se pudo completar la operación. Intenta nuevamente.'); return j; }
function Modal({ title, children, onClose, wide = false, error }: {
    title: string;
    children: ReactNode;
    onClose: () => void;
    wide?: boolean;
    error?: string;
}) { const ref = useRef<HTMLDialogElement>(null); useEffect(() => { ref.current?.showModal(); }, []); return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget)
    onClose(); }}><div className="modal-head"><div><span className="eyebrow">TU CENTRO DE SOPORTE</span><h2>{title}</h2></div><button aria-label="Cerrar" className="icon-button" onClick={onClose}><X size={20}/></button></div>{error && <div className="modal-error" role="alert">{error}</div>}{children}</dialog>; }
function Empty({ title, children, action }: {
    title: string;
    children: ReactNode;
    action?: ReactNode;
}) { return <div className="empty"><span className="empty-icon"><Inbox size={27}/></span><h3>{title}</h3><p>{children}</p>{action}</div>; }
export default function Desk({ displayName, email }: {
    displayName: string;
    email: string;
}) {
    const alerts = useTicketAlerts();
    const { data, loading, loadError, connection, refresh } = useWorkspace(alerts.receive);
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [toast, setToast] = useState('');
    const [view, setView] = useState<View>('inbox'), [search, setSearch] = useState(''), [queue, setQueue] = useState('all'), [priority, setPriority] = useState('all'), [department, setDepartment] = useState('all'), [showFilters, setShowFilters] = useState(false), [mobile, setMobile] = useState(false);
    const [ticketId, setTicketId] = useState<number | null>(null), [create, setCreate] = useState(false), [article, setArticle] = useState<Article | null>(null), [articleEdit, setArticleEdit] = useState<Article | 'new' | null>(null), [selected, setSelected] = useState<number[]>([]), [reply, setReply] = useState(''), [replyKind, setReplyKind] = useState<'reply' | 'note'>('reply');
    const searchRef = useRef<HTMLInputElement>(null);
    const isAdmin = data.viewer?.role === 'owner' || data.viewer?.role === 'admin';
    const viewerName = data.viewer?.name || displayName;
    const staffMembers = data.members.filter(member => member.role !== 'client' && member.status === 'active');
    const clientMembers = data.members.filter(member => member.role === 'client' && member.status !== 'revoked');
    useEffect(() => { const id = Number(new URLSearchParams(window.location.search).get('ticket')); if (Number.isSafeInteger(id) && id > 0) setTicketId(id); }, []);
    useEffect(() => { if (data.viewer && !isAdmin && (view === 'team' || view === 'settings')) setView('inbox'); }, [data.viewer?.role, isAdmin, view]);
    useEffect(() => { if (toast) {
        const t = setTimeout(() => setToast(''), 4000);
        return () => clearTimeout(t);
    } }, [toast]);
    useEffect(() => { function key(e: KeyboardEvent) { if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setView('inbox');
        searchRef.current?.focus();
    } } window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, []);
    const run = async (fn: () => Promise<unknown>, message: string) => { setBusy(true); setError(''); try {
        await fn();
        try {
            await refresh();
        }
        catch {
            setError('El cambio se guardó. Reintentaremos actualizar la vista automáticamente; no necesitas reenviarlo.');
        }
        setToast(message);
        return true;
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Algo salió mal.');
        return false;
    }
    finally {
        setBusy(false);
    } };
    const go = (v: View) => { if (busy || !isAdmin && (v === 'team' || v === 'settings'))
        return; setView(v); setTicketId(null); setSearch(''); setMobile(false); setSelected([]); };
    const openTicket = (t: Ticket) => { if (busy)
        return; setTicketId(t.id); try {
        setReply(sessionStorage.getItem(`vexor.draft.v1.${email}.${t.id}`) || '');
    }
    catch {
        setReply('');
    } setReplyKind('reply'); };
    const tickets = data.tickets, active = tickets.filter(t => t.status !== 'resolved'), overdue = active.filter(t => Date.parse(t.dueAt) < Date.now()), resolved = tickets.filter(t => t.status === 'resolved');
    const counts: Record<string, number> = { all: tickets.length, open: tickets.filter(t => t.status === 'open').length, pending: tickets.filter(t => t.status === 'pending').length, resolved: resolved.length, mine: tickets.filter(t => t.assigneeMemberId === data.viewer?.id).length, unassigned: active.filter(t => !t.assigneeMemberId).length, overdue: overdue.length };
    const filtered = tickets.filter(t => (queue === 'all' || queue === 'mine' && t.assigneeMemberId === data.viewer?.id || queue === 'unassigned' && !t.assigneeMemberId && t.status !== 'resolved' || queue === 'overdue' && overdue.some(o => o.id === t.id) || t.status === queue) && (priority === 'all' || t.priority === priority) && (department === 'all' || t.department === department) && `${t.id} ${t.subject} ${t.requesterName} ${t.requesterEmail}`.toLowerCase().includes(search.toLowerCase()));
    const current = tickets.find(t => t.id === ticketId);
    const patch = (t: Ticket, body: Partial<Ticket>) => run(() => request(`/api/tickets/${t.id}`, 'PATCH', body), 'Ticket actualizado');
    const exportCsv = () => { const rows = [['ID', 'Asunto', 'Cliente', 'Correo', 'Estado', 'Prioridad', 'Equipo', 'Responsable', 'Creación', 'Vencimiento'], ...filtered.map(t => [t.id, t.subject, t.requesterName, t.requesterEmail, STATUS[t.status], PRIORITY[t.priority], t.department, t.assignee, t.createdAt, t.dueAt])]; const csv = rows.map(row => row.map(cell => '"' + String(cell).replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""') + '"').join(',')).join('\r\n'); const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'tickets.csv'; a.click(); URL.revokeObjectURL(url); };
    const loadDemo = () => run(() => request('/api/demo', 'POST', {}), 'Ejemplos cargados. Puedes editarlos y explorar el sistema.');
    const signOut = async () => { setBusy(true); setError(''); try { await disconnectPushOnSignOut(); await request('/api/auth/sign-out', 'POST', {}); window.location.href = '/login'; } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo cerrar sesión.'); setBusy(false); } };
    const openAlert = (id: number) => { window.open(`/?ticket=${id}`, '_blank', 'noopener,noreferrer'); };
    if (!loading && data.viewer?.role === 'client') return <ClientPortal data={data} displayName={viewerName} email={data.viewer.email} onRefresh={refresh} connection={connection} alerts={alerts} />;
    if (!loading && !data.viewer) return <main className="staff-denied"><ShieldCheck size={35} /><h1>Tu acceso a Daybook Ticket</h1><p role="alert">{loadError || error || 'Tu cuenta necesita una invitación activa para entrar a este espacio.'}</p><div><button className="secondary" onClick={() => window.location.reload()}>Volver a intentar</button><button className="primary" disabled={busy} onClick={signOut}>Cambiar de cuenta</button></div></main>;
    return <div className="app-shell">
  <aside id="daybook-navigation" className={`sidebar ${mobile ? 'is-open' : ''}`}>
   <button className="brand" onClick={() => go('inbox')} aria-label="Daybook Ticket · Ir a la bandeja"><Brand dark /></button>
   <div className="workspace"><span className="workspace-icon"><Headphones size={19}/></span><div>Servicios Daybook<small>Centro de soporte compartido</small></div><ShieldCheck size={16}/></div>
   <p className="nav-label">ESPACIO DE TRABAJO</p>
   <nav aria-label="Navegación principal">
    <button className={view === 'overview' ? 'active' : ''} onClick={() => go('overview')}><LayoutDashboard size={18}/>Resumen</button>
    <button className={view === 'inbox' ? 'active' : ''} onClick={() => go('inbox')}><Inbox size={18}/>Bandeja de entrada<span className="nav-count">{active.length}</span></button>
    <button className={view === 'contacts' ? 'active' : ''} onClick={() => go('contacts')}><Users size={18}/>Contactos</button>
    <button className={view === 'knowledge' ? 'active' : ''} onClick={() => go('knowledge')}><BookOpen size={18}/>Conocimiento</button>
    {isAdmin && <button className={view === 'team' ? 'active' : ''} onClick={() => go('team')}><Layers3 size={18}/>Equipo y clientes</button>}
   </nav>
   <p className="nav-label">VISTAS RÁPIDAS</p>
   <nav aria-label="Vistas rápidas">
    <button onClick={() => { go('inbox'); setQueue('mine'); }}><span className="nav-dot purple"/>Asignados a mí<span className="sub-count">{counts.mine}</span></button>
    <button onClick={() => { go('inbox'); setQueue('unassigned'); }}><span className="nav-dot amber"/>Sin asignar<span className="sub-count">{counts.unassigned}</span></button>
    <button onClick={() => { go('inbox'); setQueue('overdue'); }}><span className="nav-dot coral"/>SLA vencido<span className="sub-count">{overdue.length}</span></button>
   </nav>
   <div className="sidebar-bottom"><nav>{isAdmin && <button className={view === 'settings' ? 'active' : ''} onClick={() => go('settings')}><Settings2 size={18}/>Configuración</button>}<button className={view === 'portal' ? 'active' : ''} onClick={() => go('portal')}><LifeBuoy size={18}/>Centro de ayuda<ArrowUpRight size={14}/></button></nav><div className="profile"><Avatar name={viewerName} small/><div>{viewerName}<small>{data.viewer ? ROLE_LABELS[data.viewer.role] : 'Preparando acceso'}</small></div><button disabled={busy} onClick={signOut} aria-label="Cerrar sesión" title="Cerrar sesión"><ArrowRight size={16}/></button></div></div>
  </aside>
  {mobile && <button className="sidebar-scrim" aria-label="Cerrar menú" onClick={() => setMobile(false)}/>}
  <main className="main"><header className="topbar"><div className="breadcrumbs"><button className="icon-button menu-toggle" onClick={() => setMobile(!mobile)} aria-label="Abrir menú" aria-expanded={mobile} aria-controls="daybook-navigation"><Menu size={20}/></button><span>Espacio de trabajo</span><ChevronRight size={13}/><strong>{views[view]}</strong></div><div className="top-actions"><span className="live-dot"/>{busy ? 'Guardando cambios…' : error ? 'Revisa el aviso' : 'Equipo Daybook'} <span className="top-separator"/><button className="icon-button" onClick={() => { go('inbox'); searchRef.current?.focus(); }} aria-label="Buscar tickets"><Search size={18}/></button><Avatar name={viewerName} small/></div></header>
   <div className="content">
   <div className="workspace-sync"><LiveStatus connection={connection} />{data.viewer && <TicketAlerts alerts={alerts} onOpen={openAlert} />}</div>
   {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Cerrar aviso"><X size={17}/></button></div>}
   {loading ? <div className="loading"><LoaderCircle className="spin"/><p>Preparando tu espacio…</p></div> : current ? <>
    <button className="back-button" disabled={busy} onClick={() => setTicketId(null)}><ArrowLeft size={16}/>Volver a la bandeja</button>
    <div className="page-heading"><div><div className="ticket-meta"><span>#{String(current.id).padStart(4, '0')}</span><Status status={current.status}/><Priority priority={current.priority}/></div><h1 className="ticket-title">{current.subject}</h1><p>Creado el {fmtDate(current.createdAt)} · {current.department}</p></div><button className="primary" disabled={busy} onClick={() => patch(current, { status: current.status === 'resolved' ? 'open' : 'resolved' })}><CheckCheck size={17}/>{current.status === 'resolved' ? 'Reabrir ticket' : 'Marcar resuelto'}</button></div>
    <div className="detail-grid"><section className="conversation"><div className="section-head"><h2><MessageSquare size={18}/>Conversación</h2><span>{data.messages.filter(m => m.ticketId === current.id).length} mensajes</span></div><div className="message-list">{data.messages.filter(m => m.ticketId === current.id).map(m => <div key={m.id} className={`message ${m.kind}`}><Avatar name={m.author} small/><div className="message-main"><div className="message-heading"><strong>{m.author}</strong><span>{m.kind === 'note' ? 'Nota interna' : m.kind === 'reply' ? 'Respuesta registrada' : 'Solicitud'} · {fmtDate(m.createdAt)}</span></div><p>{m.body}</p></div></div>)}</div><form className={`composer ${replyKind}`} onSubmit={async (e) => { e.preventDefault(); if (await run(() => request(`/api/tickets/${current.id}/messages`, 'POST', { body: reply, kind: replyKind }), 'Mensaje guardado')) {
            setReply('');
            try {
                sessionStorage.removeItem(`vexor.draft.v1.${email}.${current.id}`);
            }
            catch { }
        } }}><div className="composer-tabs"><button type="button" className={replyKind === 'reply' ? 'chosen' : ''} disabled={busy} onClick={() => setReplyKind('reply')}><MessageSquare size={15}/>Respuesta</button><button type="button" className={replyKind === 'note' ? 'chosen' : ''} disabled={busy} onClick={() => setReplyKind('note')}><ShieldCheck size={15}/>Nota interna</button></div><textarea aria-label={replyKind === 'note' ? 'Escribir nota interna' : 'Escribir respuesta'} required maxLength={20000} value={reply} disabled={busy} onChange={e => { setReply(e.target.value); try {
            sessionStorage.setItem(`vexor.draft.v1.${email}.${current.id}`, e.target.value);
        }
        catch { } }} placeholder={replyKind === 'note' ? 'Añade contexto para el seguimiento del caso…' : 'Escribe una respuesta clara y cercana…'}/><div className="composer-footer"><small>{replyKind === 'reply' ? (current.requesterMemberId ? 'El cliente podrá verla en su portal. El aviso por correo se registra por separado.' : 'Vincula una cuenta de cliente para que pueda consultar esta respuesta en su portal.') : 'Solo visible para tu equipo. No se envía al cliente.'}</small><button className="primary" disabled={busy || !reply.trim()}><Send size={15}/>Guardar {replyKind === 'note' ? 'nota' : 'respuesta'}</button></div></form></section><aside className="detail-aside"><div className="section-head"><h2>Detalles del ticket</h2><TicketIcon size={17}/></div><div className="detail-fields"><label>Estado<select value={current.status} disabled={busy} onChange={e => patch(current, { status: e.target.value as TicketStatus })}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>Prioridad<select value={current.priority} disabled={busy} onChange={e => patch(current, { priority: e.target.value as TicketPriority })}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>Responsable<select value={current.assigneeMemberId || ''} disabled={busy} onChange={e => patch(current, { assigneeMemberId: e.target.value || null })}><option value="">Sin asignar</option>{current.assigneeMemberId && !staffMembers.some(member => member.id === current.assigneeMemberId) && <option value={current.assigneeMemberId} disabled>{current.assignee || 'Responsable'} · sin acceso activo</option>}{staffMembers.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select>{current.assignee && !current.assigneeMemberId && <small className="assignment-note">Asignación anterior: {current.assignee}. Elige una cuenta para asignar este ticket.</small>}</label><label>Cuenta del cliente<select value={current.requesterMemberId || ''} disabled={busy} onChange={e => patch(current, { requesterMemberId: e.target.value || null })}><option value="">Sin cuenta vinculada</option>{current.requesterMemberId && !clientMembers.some(member => member.id === current.requesterMemberId) && <option value={current.requesterMemberId} disabled>{current.requesterName} · sin acceso activo</option>}{clientMembers.map(member => <option key={member.id} value={member.id}>{member.name} · {member.email}</option>)}</select><small className="client-link-note">La cuenta elegida podrá consultar este ticket y las respuestas públicas.</small></label><label>Departamento<select value={current.department} disabled={busy} onChange={e => patch(current, { department: e.target.value })}>{[...new Set([...data.settings.departments, current.department])].map(a => <option key={a}>{a}</option>)}</select></label><div className={`sla-card ${sla(current) === 'Vencido' ? 'late' : ''}`}><Clock3 size={18}/><div><strong>{sla(current)}</strong><small>Plazo: {fmtDate(current.dueAt)}</small></div></div></div><div className="requester"><span className="eyebrow">SOLICITANTE</span><div><Avatar name={current.requesterName}/><strong>{current.requesterName}</strong></div><a href={`mailto:${current.requesterEmail}`}>{current.requesterEmail}</a></div></aside></div>
   </> : view === 'inbox' || view === 'overview' ? <>
    <div className="page-heading"><div><div className="eyebrow"><span className="tiny-line"/> CADA CONVERSACIÓN CUENTA</div><h1>{view === 'inbox' ? 'Bandeja de entrada' : 'Tu soporte, en perspectiva'}</h1><p>{view === 'inbox' ? 'Todo lo que tu equipo necesita para dar una gran respuesta.' : 'Una vista clara del trabajo y las conversaciones que importan.'}</p></div><div className="heading-actions"><button className="secondary" onClick={exportCsv}><ArrowDownToLine size={16}/>Exportar</button><button className="primary" disabled={busy} onClick={() => setCreate(true)}><Plus size={17}/>Nuevo ticket</button></div></div>
    <div className="stats"><Stat label="Tickets abiertos" value={counts.open} icon={<Inbox size={19}/>} detail="Listos para una respuesta" color="blue"/><Stat label="En espera" value={counts.pending} icon={<Clock3 size={19}/>} detail="A un paso de continuar" color="amber"/><Stat label="Resueltos" value={resolved.length} icon={<CheckCircle2 size={19}/>} detail="Conversaciones completadas" color="green"/><Stat label="SLA vencido" value={overdue.length} icon={<Zap size={19}/>} detail={overdue.length ? 'Necesitan tu atención' : 'Todo dentro del plazo'} color="purple"/></div>
    {view === 'overview' ? <Overview data={data} onOpen={openTicket}/> : <div className="inbox-grid"><section className="ticket-panel"><div className="queue-tabs">{[['all', 'Todos'], ['open', 'Abiertos'], ['pending', 'En espera'], ['resolved', 'Resueltos']].map(([k, v]) => <button key={k} className={queue === k ? 'active' : ''} onClick={() => { setQueue(k); setSelected([]); }}>{v}<span>{counts[k]}</span></button>)}{['mine', 'unassigned', 'overdue'].includes(queue) && <button className="active">{queue === 'mine' ? 'Mis tickets' : queue === 'unassigned' ? 'Sin asignar' : 'SLA vencido'}<span>{counts[queue]}</span></button>}</div><div className="table-tools"><label className="search-box"><Search size={17}/><input ref={searchRef} aria-label="Buscar tickets" placeholder="Buscar por asunto, cliente o número…" value={search} onChange={e => setSearch(e.target.value)}/><kbd>⌘ K</kbd></label><button className={`secondary filter-button ${showFilters ? 'selected' : ''}`} onClick={() => setShowFilters(!showFilters)}><Filter size={15}/>Filtros{(priority !== 'all' || department !== 'all') && <span className="filter-dot"/>}</button></div>{showFilters && <div className="filter-row"><select aria-label="Filtrar por prioridad" value={priority} onChange={e => setPriority(e.target.value)}><option value="all">Todas las prioridades</option>{Object.entries(PRIORITY).map(([k, v]) => <option value={k} key={k}>{v}</option>)}</select><select aria-label="Filtrar por departamento" value={department} onChange={e => setDepartment(e.target.value)}><option value="all">Todos los departamentos</option>{data.settings.departments.map(a => <option key={a}>{a}</option>)}</select><button className="text-button" onClick={() => { setPriority('all'); setDepartment('all'); setSearch(''); }}>Limpiar</button></div>}{selected.length > 0 && <div className="bulk-bar"><strong>{selected.length} seleccionados</strong><button disabled={busy} onClick={async () => { if (await run(() => Promise.all(selected.map(id => request(`/api/tickets/${id}`, 'PATCH', { status: 'resolved' }))), 'Tickets resueltos'))
                setSelected([]); }}><CheckCheck size={16}/>Resolver selección</button><button onClick={() => setSelected([])}>Cancelar</button></div>}
    {tickets.length === 0 ? <div className="welcome"><div className="welcome-art"><div className="art-halo"/><div className="art-envelope"><MessageSquare size={34} strokeWidth={1.3}/><span><Check size={13}/></span></div><span className="art-dot one"/><span className="art-dot two"/></div><span className="eyebrow">LAS BUENAS RELACIONES EMPIEZAN AQUÍ</span><h2>Un nuevo espacio.<br />Muchas conversaciones por venir.</h2><p>Crea tu primer ticket y convierte cada solicitud<br className="desktop"/> en una experiencia de atención excepcional.</p><div><button className="primary" disabled={busy} onClick={() => setCreate(true)}><Plus size={16}/>Crear mi primer ticket</button>{isAdmin && <button className="text-button" disabled={busy} onClick={loadDemo}>Explorar con ejemplos <ArrowRight size={15}/></button>}</div>{isAdmin && <small>Los ejemplos son datos ficticios y se guardarán en tu espacio.</small>}</div> : filtered.length === 0 ? <Empty title="No hay tickets en esta vista">Prueba otra búsqueda o ajusta los filtros.</Empty> : <div className="table-scroll"><table className="ticket-table"><thead><tr><th className="check-cell"><input type="checkbox" aria-label="Seleccionar tickets de esta vista" checked={filtered.length > 0 && filtered.every(t => selected.includes(t.id))} onChange={e => setSelected(e.target.checked ? filtered.map(t => t.id) : [])}/></th><th>Ticket y solicitante</th><th>Estado</th><th>Prioridad</th><th>Responsable</th><th>Actualizado</th><th /></tr></thead><tbody>{filtered.map(t => <tr key={t.id}><td className="check-cell"><input type="checkbox" aria-label={`Seleccionar ticket ${t.id}`} checked={selected.includes(t.id)} onChange={e => setSelected(e.target.checked ? [...selected, t.id] : selected.filter(id => id !== t.id))}/></td><td className="subject-cell"><button onClick={() => openTicket(t)}><span><span className="ticket-number">#{String(t.id).padStart(4, '0')}</span>{t.subject}</span><small>{t.requesterName}<i /> {t.department}</small></button></td><td><Status status={t.status}/></td><td><Priority priority={t.priority}/></td><td><div className="assignee">{t.assignee ? <><Avatar name={t.assignee} small/><span>{t.assignee.split(' ')[0]}</span></> : <span className="unassigned">Sin asignar</span>}</div></td><td className="time-cell"><span>{since(t.updatedAt)}</span>{t.status !== 'resolved' && <small className={sla(t) === 'Vencido' ? 'late-text' : ''}>{sla(t)}</small>}</td><td><button className="icon-button" onClick={() => openTicket(t)} aria-label={`Abrir ticket ${t.id}`}><ChevronRight size={16}/></button></td></tr>)}</tbody></table></div>}
    <div className="table-footer"><span>{filtered.length} {filtered.length === 1 ? 'ticket' : 'tickets'}{queue === 'all' ? ' en total' : ' en esta vista'}</span><span><ShieldCheck size={13}/>Acceso según tu rol</span></div></section><aside className="focus-panel"><div className="focus-heading"><span className="focus-icon"><Activity size={18}/></span><h2>En foco</h2><span className="tiny-live"/></div><p>Las pequeñas acciones<br />hacen la diferencia.</p><div className="focus-divider"/><div className="focus-count"><span>{overdue.length}</span><div>tickets fuera de plazo<small>Prioriza las conversaciones pendientes.</small></div></div><button className="focus-link" onClick={() => setQueue('overdue')}>Revisar prioridad <ArrowRight size={15}/></button><div className="focus-divider"/><span className="eyebrow">TU PRÓXIMO PASO</span><div className="next-step"><span>01</span><div><strong>{counts.unassigned ? 'Distribuye la carga' : 'Comparte lo que sabes'}</strong><p>{counts.unassigned ? `${counts.unassigned} solicitudes aún no tienen responsable.` : 'Una buena guía puede resolver la siguiente pregunta.'}</p></div></div><button className="focus-link" onClick={() => counts.unassigned ? setQueue('unassigned') : go('knowledge')}>{counts.unassigned ? 'Asignar tickets' : 'Crear un artículo'}<ArrowRight size={15}/></button><div className="focus-quote"><span>“</span>Un gran soporte empieza<br />por escuchar.<div className="quote-line"/></div></aside></div>}
   </> : view === 'contacts' ? <><PageTitle title="Personas, no solo tickets" subtitle="El contexto de cada cliente, siempre a mano."/><div className="panel"><div className="section-head"><h2>Directorio de contactos</h2><span>{new Set(tickets.map(t => t.requesterEmail)).size} contactos</span></div>{tickets.length === 0 ? <Empty title="Tu directorio empieza con una conversación">Los solicitantes de tus tickets aparecerán aquí automáticamente.</Empty> : <div className="contact-grid">{[...new Set(tickets.map(t => t.requesterEmail))].map(e => { const ts = tickets.filter(t => t.requesterEmail === e), t = ts[0]; return <article className="contact-card" key={e}><Avatar name={t.requesterName}/><h3>{t.requesterName}</h3><a href={`mailto:${e}`}>{e}</a><div><span>{ts.length} tickets</span><span>{ts.filter(t => t.status !== 'resolved').length} activos</span></div><button className="text-button" onClick={() => { go('inbox'); setQueue('all'); setSearch(e); }}>Ver conversaciones<ArrowRight size={15}/></button></article>; })}</div>}</div></> : view === 'knowledge' ? <><PageTitle title="Conocimiento que conecta" subtitle="Convierte las mejores respuestas en recursos reutilizables." action={isAdmin ? <button className="primary" disabled={busy} onClick={() => setArticleEdit('new')}><Plus size={16}/>Nuevo artículo</button> : undefined}/><div className="knowledge-banner"><BookOpen size={35} strokeWidth={1.3}/><div><h2>Una respuesta útil, muchas veces.</h2><p>Organiza tus guías y publica los artículos que quieres mostrar en el centro de ayuda.</p></div></div>{!isAdmin && <div className="info-note"><BookOpen size={17}/><p>Puedes consultar y compartir estas guías. Los administradores gestionan su contenido.</p></div>}<label className="search-box article-search"><Search size={17}/><input aria-label="Buscar artículos" placeholder="Buscar artículos…" value={search} onChange={e => setSearch(e.target.value)}/></label><div className="article-grid">{data.articles.filter(a => `${a.title} ${a.body} ${a.category}`.toLowerCase().includes(search.toLowerCase())).map(a => <article className="article-card" key={a.id}><div><span className="article-icon"><BookOpen size={21}/></span><span className={`status ${a.published ? 'resolved' : 'pending'}`}><span />{a.published ? 'Publicado' : 'Borrador'}</span></div><small>{a.category}</small><h3>{a.title}</h3><p>{a.body.slice(0, 150)}{a.body.length > 150 ? '…' : ''}</p><div className="article-card-bottom"><button className="text-button" onClick={() => setArticle(a)}>Leer artículo<ArrowUpRight size={14}/></button>{isAdmin && <button className="text-button muted" onClick={() => setArticleEdit(a)}>Editar</button>}</div></article>)}</div>{data.articles.length === 0 && <div className="panel"><Empty title="Tu primera guía empieza aquí" action={isAdmin ? <button className="secondary" onClick={() => setArticleEdit('new')}>Escribir un artículo</button> : undefined}>Documenta respuestas frecuentes y ayuda a resolver dudas más rápido.</Empty></div>}</> : view === 'team' && isAdmin ? <AccessPanel data={data} busy={busy} run={run} /> : view === 'settings' && isAdmin ? <><PageTitle title="Hazlo tuyo" subtitle="Tu identidad, tu organización y tus tiempos de atención."/><MailPanel status={data.mailStatus} busy={busy} run={run}/><SettingsForm settings={data.settings} busy={busy} onSave={s => run(() => request('/api/settings', 'PATCH', s), 'Configuración guardada')}/></> : <><div className="portal-note"><ShieldCheck size={16}/>Estos artículos están disponibles para tus clientes con acceso.</div><div className="portal-hero"><span className="eyebrow">CENTRO DE AYUDA · {data.settings.brandName.toUpperCase()}</span><h1>Hola. ¿Cómo podemos ayudarte?</h1><p>Encuentra una respuesta y sigue adelante.</p><label className="search-box"><Search size={20}/><input aria-label="Buscar en el centro de ayuda" placeholder="Escribe lo que necesitas resolver…" value={search} onChange={e => setSearch(e.target.value)}/></label></div><div className="article-grid">{data.articles.filter(a => a.published && `${a.title} ${a.body}`.toLowerCase().includes(search.toLowerCase())).map(a => <button className="article-card portal-article" key={a.id} onClick={() => setArticle(a)}><BookOpen size={24}/><small>{a.category}</small><h3>{a.title}</h3><p>{a.body.slice(0, 120)}…</p><span className="text-button">Ver guía<ArrowRight size={15}/></span></button>)}</div>{!data.articles.some(a => a.published) && <Empty title="Las respuestas están en camino">Publica un artículo desde Conocimiento para mostrarlo aquí.</Empty>}<div className="portal-cta"><div><h2>¿Necesitas una mano?</h2><p>Abre una solicitud y mantén toda la conversación en un lugar.</p></div><button className="primary" disabled={busy} onClick={() => setCreate(true)}><MessageSquare size={17}/>Crear solicitud</button></div></>}
   <footer className="page-footer"><span>{data.settings.brandName} <i /> {data.settings.tagline}</span><span>Parte de Servicios Daybook.</span></footer>
   </div>
  </main>
  {create && <Modal error={error} title="Una nueva conversación" onClose={() => setCreate(false)} wide><TicketForm settings={data.settings} members={data.members} busy={busy} onCancel={() => setCreate(false)} onSubmit={async (body) => { let result: any; const ok = await run(async () => { result = await request('/api/tickets', 'POST', body); }, 'Ticket creado'); if (ok) {
        setCreate(false);
        setView('inbox');
        openTicket(result.ticket);
    } }}/></Modal>}
  {articleEdit && isAdmin && <Modal error={error} title={articleEdit === 'new' ? 'Comparte una respuesta' : 'Editar artículo'} onClose={() => setArticleEdit(null)} wide><ArticleForm article={articleEdit === 'new' ? undefined : articleEdit} busy={busy} onSave={async (body) => { if (await run(() => request(articleEdit === 'new' ? '/api/articles' : `/api/articles/${articleEdit.id}`, articleEdit === 'new' ? 'POST' : 'PATCH', body), 'Artículo guardado'))
        setArticleEdit(null); }}/></Modal>}
  {article && <Modal title={article.title} onClose={() => setArticle(null)} wide><div className="article-reading"><span className="tag">{article.category}</span><div>{article.body}</div><small>Actualizado el {fmtDate(article.updatedAt)}</small></div></Modal>}
  {toast && <div className="toast" role="status"><CheckCircle2 size={18}/>{toast}</div>}
  {busy && <div className="saving" role="status"><LoaderCircle size={14} className="spin"/>Guardando…</div>}
 </div>;
}
function Stat({ label, value, icon, detail, color }: {
    label: string;
    value: number;
    icon: ReactNode;
    detail: string;
    color: string;
}) { return <article className="stat-card"><div><span>{label}</span><span className={`stat-icon ${color}`}>{icon}</span></div><strong>{value.toString().padStart(2, '0')}</strong><small>{detail}</small></article>; }
function PageTitle({ title, subtitle, action }: {
    title: string;
    subtitle: string;
    action?: ReactNode;
}) { return <div className="page-heading"><div><span className="eyebrow"><span className="tiny-line"/> TU ESPACIO, BIEN ORGANIZADO</span><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>; }
function TicketForm({ settings, members, busy, onCancel, onSubmit }: {
    settings: Settings;
    members: Member[];
    busy: boolean;
    onCancel: () => void;
    onSubmit: (body: unknown) => Promise<void>;
}) {
    const [requesterId, setRequesterId] = useState('');
    const clients = members.filter(member => member.role === 'client' && member.status !== 'revoked');
    const staff = members.filter(member => member.role !== 'client' && member.status === 'active');
    const requester = clients.find(member => member.id === requesterId);
    return <form className="form" onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); const body: Record<string, unknown> = Object.fromEntries(form.entries()); body.assigneeMemberId = body.assigneeMemberId || null; if (requesterId) body.requesterMemberId = requesterId; onSubmit(body); }}>
      <p className="form-intro">Vincula la cuenta del cliente para que pueda consultar y responder este ticket en su portal.</p>
      <div className="form-grid">
        <label className="full">Cuenta del cliente<select value={requesterId} disabled={busy} onChange={e => setRequesterId(e.target.value)}><option value="">Registrar sin cuenta vinculada</option>{clients.map(member => <option key={member.id} value={member.id}>{member.name} · {member.email}</option>)}</select></label>
        {requester ? <div className="full staff-account-preview"><strong>{requester.name}</strong>{requester.email} · {requester.status === 'invited' ? 'Podrá entrar cuando acepte su invitación.' : 'Podrá consultar la conversación desde su portal.'}</div> : <><label>Nombre del solicitante<input name="requesterName" required maxLength={120} placeholder="Ej. Andrea Molina" disabled={busy}/></label><label>Correo electrónico<input name="requesterEmail" type="email" required maxLength={254} placeholder="andrea@empresa.com" disabled={busy}/></label></>}
        <label className="full">Asunto<input name="subject" required maxLength={160} placeholder="Resume la solicitud en una frase" disabled={busy} autoFocus/></label>
        <label>Departamento<select name="department" disabled={busy}>{settings.departments.map(department => <option key={department}>{department}</option>)}</select></label>
        <label>Prioridad<select name="priority" defaultValue="normal" disabled={busy}>{Object.entries(PRIORITY).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="full">Responsable<select name="assigneeMemberId" disabled={busy}><option value="">Sin asignar</option>{staff.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
        <label className="full">Descripción<textarea name="body" required maxLength={20000} rows={5} placeholder="¿Qué está pasando? Añade el contexto necesario para ayudar." disabled={busy}/></label>
      </div>
      <div className="form-footer"><button type="button" className="secondary" onClick={onCancel} disabled={busy}>Cancelar</button><button disabled={busy} className="primary"><Plus size={16}/>Crear ticket</button></div>
    </form>;
}
function ArticleForm({ article, busy, onSave }: {
    article?: Article;
    busy: boolean;
    onSave: (body: unknown) => Promise<void>;
}) { return <form className="form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); onSave({ title: f.get('title'), category: f.get('category'), body: f.get('body'), published: f.get('published') === 'on' }); }}><label>Título<input name="title" required maxLength={160} defaultValue={article?.title} placeholder="¿Cómo podemos resolver esta pregunta?" autoFocus/></label><label>Categoría<input name="category" required maxLength={80} defaultValue={article?.category || 'Primeros pasos'}/></label><label>Contenido<textarea name="body" required maxLength={20000} rows={12} defaultValue={article?.body} placeholder="Escribe una guía clara, paso a paso…"/></label><label className="checkbox-label"><input type="checkbox" name="published" defaultChecked={article?.published}/>Publicar en el centro de ayuda</label><div className="form-footer"><button disabled={busy} className="primary"><Check size={16}/>Guardar artículo</button></div></form>; }
function SettingsForm({ settings, busy, onSave }: {
    settings: Settings;
    busy: boolean;
    onSave: (s: Settings) => Promise<boolean>;
}) { const [s, setS] = useState(settings); const [departments, setDepartments] = useState(settings.departments.join('\n')); return <form className="settings-form" onSubmit={e => { e.preventDefault(); onSave({ ...s, departments: departments.split('\n').map(a => a.trim()).filter(Boolean) }); }}><section className="panel settings-section"><div><span className="setting-icon"><Sparkles size={22}/></span><h2>Identidad de marca</h2><p>El nombre y la voz de tu producto.</p></div><div className="form"><label>Nombre del producto<input required maxLength={80} value={s.brandName} onChange={e => setS({ ...s, brandName: e.target.value })}/></label><label>Frase de marca<input required maxLength={180} value={s.tagline} onChange={e => setS({ ...s, tagline: e.target.value })}/></label></div></section><section className="panel settings-section"><div><span className="setting-icon"><Users size={22}/></span><h2>Organización</h2><p>Un departamento por línea. Gestiona las cuentas responsables desde Equipo y clientes.</p></div><div className="form form-grid"><label>Departamentos<textarea required rows={5} value={departments} onChange={e => setDepartments(e.target.value)}/></label></div></section><section className="panel settings-section"><div><span className="setting-icon"><Clock3 size={22}/></span><h2>Plazos de atención</h2><p>Horas corridas desde la creación. Se aplica a nuevos tickets y a cambios de prioridad.</p></div><div className="form form-grid">{Object.entries(PRIORITY).map(([k, v]) => <label key={k}>{v} (horas)<input required type="number" min="1" max="8760" value={s.slaHours[k as TicketPriority]} onChange={e => setS({ ...s, slaHours: { ...s.slaHours, [k]: Number(e.target.value) } })}/></label>)}</div></section><div className="form-footer"><button className="primary" disabled={busy}><Check size={17}/>Guardar configuración</button></div></form>; }
function Overview({ data, onOpen }: {
    data: Workspace;
    onOpen: (t: Ticket) => void;
}) { const total = data.tickets.length; return <div className="overview-grid"><section className="panel"><div className="section-head"><h2>Distribución por departamento</h2><span>Todos los tickets</span></div><div className="bar-chart">{[...new Set([...data.settings.departments, ...data.tickets.map(t => t.department)])].map((d, i) => { const n = data.tickets.filter(t => t.department === d).length; return <div className="bar-row" key={d}><div><span>{d}</span><strong>{n}</strong></div><div className="bar-track"><span style={{ width: `${total ? n / total * 100 : 0}%`, background: ['#6375d6', '#94afa6', '#c8d58b'][i % 3] }}/></div></div>; })}<small>Distribución calculada a partir de tus conversaciones.</small></div></section><section className="panel"><div className="section-head"><h2>Balance de atención</h2><CheckCircle2 size={18}/></div><div className="resolution"><div className="donut" style={{ background: `conic-gradient(#8daba1 ${(total ? data.tickets.filter(t => t.status === 'resolved').length / total : 0) * 360}deg,#eef0ec 0deg)` }}><div><strong>{total ? Math.round(data.tickets.filter(t => t.status === 'resolved').length / total * 100) : 0}%</strong><span>resueltos</span></div></div><p>{data.tickets.filter(t => t.status === 'resolved').length} de {total} conversaciones<br />se han completado.</p></div></section><section className="panel recent"><div className="section-head"><h2>Últimas conversaciones</h2><span>Actividad reciente</span></div>{data.tickets.length === 0 ? <Empty title="Todo listo para empezar">Aquí verás las conversaciones más recientes.</Empty> : data.tickets.slice(0, 5).map(t => <button className="recent-row" key={t.id} onClick={() => onOpen(t)}><Avatar name={t.requesterName} small/><div><strong>{t.subject}</strong><small>{t.requesterName} · {since(t.updatedAt)}</small></div><Status status={t.status}/><ChevronRight size={17}/></button>)}</section></div>; }
