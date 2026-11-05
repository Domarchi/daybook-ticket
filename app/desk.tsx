'use client';
import {KnowledgePanel,KnowledgeSuggestions,LegacyKnowledgePanel} from './knowledge';
import {CompanyReportsPanel} from './company-reports';
import {OrganizationManager,RequestOrganizationFields,TicketOrganizationPanel,SavedViewPicker,type OrganizationRequestValue} from './work-organization';
import {normalizeTeamFilters} from '@/hooks/use-team-filters';
import {daybookFetch,UNCERTAIN_SEND_MESSAGE} from '@/lib/browser-request';
import {AutomationPanel,TicketRelationsPanel} from './automation';
import Brand from './brand';
import {SecurityCenter,SecurityHealthPanel} from './security-center';
import {ServiceContextPanel,TicketServiceContextPanel} from './service-context';
import {ThemeControl,EvolutionFeaturesPanel} from './evolution-controls';
import { MessageEditor } from './message-content';
import { TicketChat } from './ticket-chat';
import {TicketDetails} from './ticket-details';
import { EscalationSettingsPanel } from './escalation-settings';
import { SatisfactionReportPanel } from './satisfaction-report';
import { EmailInboundPanel } from './email-inbound';
import { BackupPanel } from './backup-panel';
import { AutomaticBackupPanel } from './automatic-backup-panel';
import { TicketPresence } from './ticket-presence';
import { notifyTicketPresenceActivity } from '@/lib/ticket-presence-client';
import { isTestTicket } from '@/lib/test-data';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Activity, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, Bell, BookOpen, Check, CheckCheck, CheckCircle2, ChevronRight, Clock3, Filter, Headphones, Inbox, Layers3, LayoutDashboard, LifeBuoy, LoaderCircle, Menu, MessageSquare, Plus, Search, Send, Settings2, ShieldCheck, Sparkles, Users, X, Zap } from 'lucide-react';
import { type Message, type Member, type Settings, type Ticket, type TicketPriority, type TicketStatus, type Workspace } from '../lib/types';
import ClientPortal from './client-portal';
import { AccessPanel, MailPanel, ROLE_LABELS } from './access-panel';
import { NotificationSettingsPanel } from './notification-settings';
import { OperationsSettingsPanel, MyAvailabilityPanel } from './operations-settings';
import { AgentMetricsPanel } from './agent-metrics';
import { MailTracking } from './mail-tracking';
import { useWorkspace } from '@/hooks/use-workspace';
import { LiveStatus } from './live-status';
import { useTicketAlerts } from '@/hooks/use-ticket-alerts';
import { TicketAlerts } from './ticket-alerts';
import { disconnectPushOnSignOut } from '@/lib/push-client';
import { useDraftQuote } from '@/hooks/use-draft-quote';
import { useTicketDraft } from '@/hooks/use-ticket-draft';
import { ticketDraftKey, type DraftKind } from '@/lib/ticket-drafts';
import { visibleTicketSelection } from '@/lib/ticket-selection';
import { useTeamFilters } from '@/hooks/use-team-filters';
import { useDraftAttachments } from '@/hooks/use-draft-attachments';
import { getDraftOperations } from '@/lib/draft-operations';
import { readNewTicketDraft, writeNewTicketDraft, clearNewTicketDraft,readNewTicketOrganization,writeNewTicketOrganization } from '@/lib/new-ticket-draft';
import { AttachmentComposer } from './attachments';
import { AssignmentControls, TicketCompanyLink, TicketActivity } from './team-tools';
import { SavedRepliesManager, SavedReplyPicker, type SavedReplyItem } from './saved-replies';
import { useTicketSearch, useTicketConversation, type TicketFilters } from '@/hooks/use-ticket-search';
import { TicketPagination, ContactDirectory } from './ticket-pagination';
const STATUS: Record<TicketStatus, string> = { open: 'Abierto', pending: 'En espera', resolved: 'Resuelto' };
const PRIORITY: Record<TicketPriority, string> = { urgent: 'Urgente', high: 'Alta', normal: 'Normal', low: 'Baja' };
type View = 'inbox' | 'overview' | 'contacts' | 'knowledge' | 'team' | 'settings' | 'portal' | 'operations' | 'metrics' | 'service' | 'reports' | 'security';
const views: Record<View, string> = { inbox: 'Bandeja de entrada', overview: 'Resumen', contacts: 'Contactos', knowledge: 'Conocimiento', team: 'Equipo y clientes', settings: 'Configuración', portal: 'Centro de ayuda', operations: 'Atención y reparto', metrics: 'Métricas del equipo', service:'Empresas y servicios',reports:'Informes por empresa',security:'Seguridad de mi cuenta' };
function initials(name: string) { return name.split(' ').filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase(); }
function fmtDate(s: string) { return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(s)); }
function since(s: string, now: number) { const n = Math.max(0, (now - Date.parse(s)) / 60000); return n < 1 ? 'Ahora' : n < 60 ? `${Math.floor(n)} min` : n < 1440 ? `${Math.floor(n / 60)} h` : `${Math.floor(n / 1440)} d`; }
function sla(t: Ticket, now: number) { const mins = Math.round((Date.parse(t.dueAt) - now) / 60000); return t.status === 'resolved' ? 'Completado' : mins < 0 ? 'Vencido' : mins < 60 ? `${mins} min restantes` : `${Math.floor(mins / 60)} h restantes`; }
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
async function request<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await daybookFetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined },method==='GET'?undefined:UNCERTAIN_SEND_MESSAGE);
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) {
        const message = result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' ? result.error : 'No se pudo completar la operación. Intenta nuevamente.';
        throw new Error(message);
    }
    return result as T;
}
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
    const router = useRouter();
    const searchParams = useSearchParams();
    const alerts = useTicketAlerts();
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
    const { data, loading, loadError, connection, refresh } = useWorkspace(alerts.receive);
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [toast, setToast] = useState('');
    const [requestedView, setView] = useState<View>(()=>searchParams.get('serviceContext')==='1'?'service':'inbox'), [search, setSearch] = useState(''), [showFilters, setShowFilters] = useState(false), [mobile, setMobile] = useState(false);
    const [ticketId, setTicketId] = useState<number | null>(() => { const id = Number(searchParams.get('ticket')); return Number.isSafeInteger(id) && id > 0 ? id : null; }), [create, setCreate] = useState(false), [selected, setSelected] = useState<number[]>([]);
    const searchRef = useRef<HTMLInputElement>(null);
    const isAdmin = data.viewer?.role === 'owner' || data.viewer?.role === 'admin';
    const { filters: teamFilters, update: updateTeamFilters } = useTeamFilters(data.viewer?.id);
    const { queue, priority, department } = teamFilters;
    const setQueue = (queue: string) => { updateTeamFilters({ ...teamFilters, queue }); setSelected([]); };
    const setPriority = (priority: string) => updateTeamFilters({ ...teamFilters, priority });
    const setDepartment = (department: string) => updateTeamFilters({ ...teamFilters, department });
    const view = !isAdmin && (['team', 'settings', 'operations', 'metrics'].includes(requestedView)) ? 'inbox' : requestedView;
    const viewerName = data.viewer?.name || displayName;
    const staffMembers = data.members.filter(member => member.role !== 'client' && member.status === 'active');
    const clientMembers = data.members.filter(member => member.role === 'client' && member.status !== 'revoked');
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
    const go = (v: View) => { if (busy || !isAdmin && (['team', 'settings', 'operations', 'metrics'].includes(v)))
        return; setView(v); setTicketId(null); setSearch(''); setMobile(false); setSelected([]); };
    const openTicket = (ticket: Ticket) => { if (!busy) setTicketId(ticket.id); };
    const tickets = data.tickets;
    const counts: Record<string, number> = { ...(data.ticketCounts ?? { all: tickets.length, open: 0, pending: 0, resolved: 0, mine: 0, unassigned: 0, overdue: 0 }) };
    const feedKey = data.alertsPage?.snapshotAt;
    const searchResults = useTicketSearch(data.viewer?.id, { q: search, queue: queue as TicketFilters['queue'], priority: priority as TicketFilters['priority'], department, company: teamFilters.company, agent: teamFilters.agent }, feedKey, view === 'inbox' && data.viewer?.role !== 'client');
    const accessKey = `${data.viewer?.id}:${data.viewer?.role}:${data.viewer?.customerCompanyId}:${data.viewer?.companyAccess}`;
    const [replyTarget,setReplyTarget]=useState<{memberId:string;ticketId:number;message:Message}|null>(null);
  const conversation = useTicketConversation(data.viewer?.id, accessKey, data.viewer?.role === 'client' ? null : ticketId, feedKey);
    const filtered = searchResults.items;
    const visibleSelected = visibleTicketSelection(selected, filtered);
    const current = conversation.ticket;
    const patch = (t: Ticket, body: Partial<Ticket>) => run(() => request(`/api/tickets/${t.id}`, 'PATCH', body), 'Ticket actualizado');
    const exportCsv = async () => {
        setBusy(true); setError('');
        try {
            const results = await searchResults.exportAll();
            const rows = [['ID', 'Asunto', 'Cliente', 'Correo', 'Estado', 'Prioridad', 'Equipo', 'Responsable', 'Creación', 'Vencimiento'], ...results.map(t => [t.id, t.subject, t.requesterName, t.requesterEmail, STATUS[t.status], PRIORITY[t.priority], t.department, t.assignee, t.createdAt, t.dueAt])];
            const csv = rows.map(row => row.map(cell => '"' + String(cell).replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""') + '"').join(',')).join('\r\n');
            const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
            const a = document.createElement('a'); a.href = url; a.download = 'tickets.csv'; a.click(); URL.revokeObjectURL(url);
        } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo exportar.'); }
        finally { setBusy(false); }
    };
    const loadDemo = () => run(() => request('/api/demo', 'POST', {}), 'Ejemplos cargados. Puedes editarlos y explorar el sistema.');
    const signOut = async () => { setBusy(true); setError(''); try { await disconnectPushOnSignOut(); await request('/api/auth/sign-out', 'POST', {}); router.replace('/login'); router.refresh(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo cerrar sesión.'); setBusy(false); } };
    const openAlert = (id: number) => { window.open(`/?ticket=${id}`, '_blank', 'noopener,noreferrer'); };
    if (!loading && data.viewer?.role === 'client') return <ClientPortal key={`${data.viewer.id}:${data.viewer.role}`} data={data} displayName={viewerName} email={data.viewer.email} onRefresh={refresh} connection={connection} alerts={alerts} />;
    if (!loading && !data.viewer) return <main className="staff-denied"><ShieldCheck size={35} /><h1>Tu acceso a Daybook Ticket</h1><p role="alert">{loadError || error || 'Tu cuenta necesita una invitación activa para entrar a este espacio.'}</p><div><button className="secondary" onClick={() => window.location.reload()}>Volver a intentar</button><button className="primary" disabled={busy} onClick={signOut}>Cambiar de cuenta</button></div></main>;
    return <div className="app-shell">
  <aside id="daybook-navigation" className={`sidebar ${mobile ? 'is-open' : ''}`}>
   <button className="brand" onClick={() => go('inbox')} aria-label="Daybook Ticket · Ir a la bandeja"><Brand dark /></button>
   <div className="workspace"><span className="workspace-icon"><Headphones size={19}/></span><div>Servicios Daybook<small>Centro de soporte compartido</small></div><ShieldCheck size={16}/></div>
   <p className="nav-label">ESPACIO DE TRABAJO</p>
   <nav aria-label="Navegación principal">
    <button className={view === 'overview' ? 'active' : ''} onClick={() => go('overview')}><LayoutDashboard size={18}/>Resumen</button>
    <button className={view === 'inbox' ? 'active' : ''} onClick={() => go('inbox')}><Inbox size={18}/>Bandeja de entrada<span className="nav-count">{counts.open + counts.pending}</span></button>
    <button className={view === 'contacts' ? 'active' : ''} onClick={() => go('contacts')}><Users size={18}/>Contactos</button>
    {data.evolution?.features.serviceContext&&<button className={view==='service'?'active':''} onClick={()=>go('service')}><Headphones size={18}/>Empresas y servicios</button>}
    <button className={view === 'knowledge' ? 'active' : ''} onClick={() => go('knowledge')}><BookOpen size={18}/>Conocimiento</button>
    {data.evolution?.features.knowledge&&<button className={view==='reports'?'active':''} onClick={()=>go('reports')}><Activity size={18}/>Informes por empresa</button>}
    {isAdmin && <button className={view === 'team' ? 'active' : ''} onClick={() => go('team')}><Layers3 size={18}/>Equipo y clientes</button>}
    {isAdmin && <button className={view === 'operations' ? 'active' : ''} onClick={() => go('operations')}><Clock3 size={18}/>Atención y reparto</button>}
    {isAdmin && <button className={view === 'metrics' ? 'active' : ''} onClick={() => go('metrics')}><Activity size={18}/>Métricas del equipo</button>}
   </nav>
   <p className="nav-label">VISTAS RÁPIDAS</p>
   <nav aria-label="Vistas rápidas">
    <button onClick={() => { go('inbox'); setQueue('mine'); }}><span className="nav-dot purple"/>Asignados a mí<span className="sub-count">{counts.mine}</span></button>
    <button onClick={() => { go('inbox'); setQueue('unassigned'); }}><span className="nav-dot amber"/>Sin asignar<span className="sub-count">{counts.unassigned}</span></button>
    <button onClick={() => { go('inbox'); setQueue('overdue'); }}><span className="nav-dot coral"/>SLA vencido<span className="sub-count">{counts.overdue}</span></button>
   </nav>
   <div className="sidebar-bottom"><nav><button className={view==='security'?'active':''} onClick={()=>go('security')}><ShieldCheck size={18}/>Seguridad</button>{isAdmin && <button className={view === 'settings' ? 'active' : ''} onClick={() => go('settings')}><Settings2 size={18}/>Configuración</button>}<button className={view === 'portal' ? 'active' : ''} onClick={() => go('portal')}><LifeBuoy size={18}/>Centro de ayuda<ArrowUpRight size={14}/></button></nav><div className="profile"><Avatar name={viewerName} small/><button className="profile-security" type="button" onClick={()=>go('security')} title="Gestionar seguridad de mi cuenta">{viewerName}<small>{data.viewer ? ROLE_LABELS[data.viewer.role] : 'Preparando acceso'}</small></button><button disabled={busy} onClick={signOut} aria-label="Cerrar sesión" title="Cerrar sesión"><ArrowRight size={16}/></button></div></div>
  </aside>
  {mobile && <button className="sidebar-scrim" aria-label="Cerrar menú" onClick={() => setMobile(false)}/>}
  <main className="main"><header className="topbar"><div className="breadcrumbs"><button className="icon-button menu-toggle" onClick={() => setMobile(!mobile)} aria-label="Abrir menú" aria-expanded={mobile} aria-controls="daybook-navigation"><Menu size={20}/></button><span>Espacio de trabajo</span><ChevronRight size={13}/><strong>{views[view]}</strong></div><div className="top-actions"><span className="live-dot"/>{busy ? 'Guardando cambios…' : error ? 'Revisa el aviso' : 'Equipo Daybook'} <span className="top-separator"/><button className="icon-button" onClick={() => { go('inbox'); searchRef.current?.focus(); }} aria-label="Buscar tickets"><Search size={18}/></button><Avatar name={viewerName} small/></div></header>
   <div className="content">
   <div className="workspace-sync">{data.viewer&&<ThemeControl key={data.viewer.id} memberId={data.viewer.id} preferred={data.preferences?.theme||'system'}/>}<LiveStatus connection={connection} />{data.viewer && <TicketAlerts alerts={alerts} onOpen={openAlert} />}</div>
   {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Cerrar aviso"><X size={17}/></button></div>}
   {loading ? <div className="loading"><LoaderCircle className="spin"/><p>Preparando tu espacio…</p></div> : ticketId && !current ? <div className="panel ticket-search-feedback" role={conversation.error ? 'alert' : 'status'}>{conversation.error || 'Cargando conversación…'}<button className="text-button" onClick={() => setTicketId(null)}>Volver a la bandeja</button></div> : current ? <>
    <button className="back-button" disabled={busy} onClick={() => setTicketId(null)}><ArrowLeft size={16}/>Volver a la bandeja</button>
    <div className="page-heading"><div><div className="ticket-meta"><span>#{String(current.id).padStart(4, '0')}</span><Status status={current.status}/><Priority priority={current.priority}/></div><h1 className="ticket-title">{current.subject}</h1><p>Creado el {fmtDate(current.createdAt)} · {current.department}</p></div><button className="primary" disabled={busy} onClick={() => patch(current, { status: current.status === 'resolved' ? 'open' : 'resolved' })}><CheckCheck size={17}/>{current.status === 'resolved' ? 'Reabrir ticket' : 'Marcar resuelto'}</button></div>
    {data.viewer && <TicketPresence key={`${data.viewer.id}:${current.id}`} ticketId={current.id} memberId={data.viewer.id}/>}
    {isAdmin && <div className="info-note test-ticket-control"><label><input type="checkbox" checked={Boolean(current.isTest)} disabled={busy} onChange={event => { void run(() => request(`/api/tickets/${current.id}`, 'PATCH', { isTest: event.target.checked, expectedVersion: current.version }), 'Marca de prueba actualizada'); }}/> Ticket de prueba</label><small>{isTestTicket(current, data.members) ? 'Excluido de métricas por defecto. El contenido se conserva.' : 'Incluido en métricas.'}{!current.isTest && isTestTicket(current,data.members) ? ' La cuenta solicitante está marcada como prueba.' : ''}</small></div>}
    <div className="detail-grid"><section className="conversation ticket-chat-panel" aria-label="Conversación del ticket"><TicketChat key={`${data.viewer!.id}:${current.id}`} ticketId={current.id} collaboration={Boolean(data.evolution?.features.collaboration)} onReplyTo={message=>setReplyTarget({memberId:data.viewer!.id,ticketId:current.id,message})} messages={conversation.messages} viewerId={data.viewer!.id} staff hasOlder={conversation.hasOlder} loadingOlder={conversation.loadingOlder} onLoadOlder={conversation.loadOlder} loading={conversation.loading} error={conversation.error} title="Conversación del ticket">{data.viewer && <StaffComposer key={ticketDraftKey({ memberId: data.viewer.id, role: data.viewer.role, ticketId: current.id })} ticket={current} viewer={data.viewer} replyTarget={replyTarget?.memberId===data.viewer.id&&replyTarget.ticketId===current.id?replyTarget.message:null} onClearReply={()=>setReplyTarget(null)} collaboration={Boolean(data.evolution?.features.collaboration)} members={data.members} savedReplies={data.savedReplies || []} legacyEmail={email} busy={busy} onSave={message => run(() => request(`/api/tickets/${current.id}/messages`, 'POST', message), 'Mensaje guardado')}/>}</TicketChat></section><TicketDetails><div className="detail-fields"><label>Estado<select value={current.status} disabled={busy} onChange={e => patch(current, { status: e.target.value as TicketStatus })}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>Prioridad<select value={current.priority} disabled={busy} onChange={e => patch(current, { priority: e.target.value as TicketPriority })}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>{data.viewer && <AssignmentControls key={`${current.id}:${current.version}`} ticket={current} members={data.members} viewerId={data.viewer.id} busy={busy} run={run} refresh={refresh}/>}<label>Cuenta del cliente<select value={current.requesterMemberId || ''} disabled={busy} onChange={e => patch(current, { requesterMemberId: e.target.value || null })}><option value="">Sin cuenta vinculada</option>{current.requesterMemberId && !clientMembers.some(member => member.id === current.requesterMemberId) && <option value={current.requesterMemberId} disabled>{current.requesterName} · sin acceso activo</option>}{clientMembers.map(member => <option key={member.id} value={member.id}>{member.name} · {member.email}</option>)}</select><small className="client-link-note">La cuenta elegida podrá consultar este ticket y las respuestas públicas.</small></label>{isAdmin ? <TicketCompanyLink key={`${current.id}:${current.customerCompanyId}`} ticket={current} companies={data.companies || []} busy={busy} run={run}/> : <p className="assignment-note">Empresa: {data.companies?.find(company => company.id === current.customerCompanyId)?.name || 'Sin empresa'}</p>}<label>Departamento<select value={current.department} disabled={busy} onChange={e => patch(current, { department: e.target.value })}>{[...new Set([...data.settings.departments, current.department])].map(a => <option key={a}>{a}</option>)}</select></label><div className={`sla-card ${sla(current, now) === 'Vencido' ? 'late' : ''}`}><Clock3 size={18}/><div><strong>{sla(current, now)}</strong><small>Plazo: {fmtDate(current.dueAt)}</small></div></div></div><div className="requester"><span className="eyebrow">SOLICITANTE</span><div><Avatar name={current.requesterName}/><strong>{current.requesterName}</strong></div><a href={`mailto:${current.requesterEmail}`}>{current.requesterEmail}</a></div></TicketDetails></div>{data.evolution?.features.organization&&<TicketOrganizationPanel key={`${accessKey}:${current.id}`} ticketId={current.id} memberId={data.viewer!.id} staff members={data.members} refreshKey={current.version} onChanged={()=>{void refresh();}}/>}{data.evolution?.features.serviceContext&&<TicketServiceContextPanel key={`${accessKey}:${current.id}:${current.customerCompanyId}`} memberId={data.viewer!.id} ticketId={current.id} companyId={current.customerCompanyId}/>}{data.evolution?.features.automation&&<TicketRelationsPanel key={`${accessKey}:${current.id}`} memberId={data.viewer!.id} ticketId={current.id} refreshKey={current.version} onChanged={()=>{void refresh();}}/>}<TicketActivity key={`${current.id}:${current.version}`} ticketId={current.id} members={data.members} companies={data.companies || []}/><MailTracking key={current.id} ticketId={current.id} refreshKey={current.version}/>
   </> : view === 'inbox' || view === 'overview' ? <>
    <div className="page-heading"><div><div className="eyebrow"><span className="tiny-line"/> CADA CONVERSACIÓN CUENTA</div><h1>{view === 'inbox' ? 'Bandeja de entrada' : 'Tu soporte, en perspectiva'}</h1><p>{view === 'inbox' ? 'Todo lo que tu equipo necesita para dar una gran respuesta.' : 'Una vista clara del trabajo y las conversaciones que importan.'}</p></div><div className="heading-actions"><button className="secondary" disabled={busy} onClick={exportCsv}><ArrowDownToLine size={16}/>Exportar</button><button className="primary" disabled={busy} onClick={() => setCreate(true)}><Plus size={17}/>Nuevo ticket</button></div></div>
    <div className="stats"><Stat label="Tickets abiertos" value={counts.open} icon={<Inbox size={19}/>} detail="Listos para una respuesta" color="blue"/><Stat label="En espera" value={counts.pending} icon={<Clock3 size={19}/>} detail="A un paso de continuar" color="amber"/><Stat label="Resueltos" value={counts.resolved} icon={<CheckCircle2 size={19}/>} detail="Conversaciones completadas" color="green"/><Stat label="SLA vencido" value={counts.overdue} icon={<Zap size={19}/>} detail={counts.overdue ? 'Necesitan tu atención' : 'Todo dentro del plazo'} color="purple"/></div>
    {view === 'overview' ? <><MyAvailabilityPanel key={data.viewer!.id} memberId={data.viewer!.id}/><Overview data={data} now={now} onOpen={openTicket}/></> : <div className="inbox-grid"><section className="ticket-panel">{data.evolution?.features.organization&&<SavedViewPicker key={data.viewer!.id} memberId={data.viewer!.id} filters={{q:search,queue:queue as TicketFilters['queue'],priority:priority as TicketFilters['priority'],department,company:teamFilters.company,agent:teamFilters.agent}} onApply={filters=>{setSearch(filters.q||'');updateTeamFilters(normalizeTeamFilters(filters));setSelected([]);}}/>}<div className="queue-tabs">{[['all', 'Todos'], ['open', 'Abiertos'], ['pending', 'En espera'], ['resolved', 'Resueltos']].map(([k, v]) => <button key={k} className={queue === k ? 'active' : ''} onClick={() => { setQueue(k); setSelected([]); }}>{v}<span>{counts[k]}</span></button>)}{['mine', 'unassigned', 'overdue'].includes(queue) && <button className="active">{queue === 'mine' ? 'Mis tickets' : queue === 'unassigned' ? 'Sin asignar' : 'SLA vencido'}<span>{counts[queue]}</span></button>}</div><div className="table-tools"><label className="search-box"><Search size={17}/><input ref={searchRef} aria-label="Buscar tickets" placeholder="Buscar en tickets y conversaciones…" value={search} onChange={e => { setSearch(e.target.value); setSelected([]); }}/><kbd>⌘ K</kbd></label><button className={`secondary filter-button ${showFilters ? 'selected' : ''}`} onClick={() => setShowFilters(!showFilters)}><Filter size={15}/>Filtros{(priority !== 'all' || department !== 'all' || teamFilters.company !== 'all' || teamFilters.agent !== 'all') && <span className="filter-dot"/>}</button></div>{(showFilters || priority !== 'all' || department !== 'all' || teamFilters.company !== 'all' || teamFilters.agent !== 'all') && <div className="filter-row"><select aria-label="Filtrar por prioridad" value={priority} onChange={e => { setPriority(e.target.value); setSelected([]); }}><option value="all">Todas las prioridades</option>{Object.entries(PRIORITY).map(([k, v]) => <option value={k} key={k}>{v}</option>)}</select><select aria-label="Filtrar por departamento" value={department} onChange={e => { setDepartment(e.target.value); setSelected([]); }}><option value="all">Todos los departamentos</option>{data.settings.departments.map(a => <option key={a}>{a}</option>)}</select><select aria-label="Filtrar por empresa" value={teamFilters.company} onChange={event => { updateTeamFilters({ ...teamFilters, company: event.target.value }); setSelected([]); }}><option value="all">Todas las empresas</option><option value="none">Sin empresa</option>{data.companies?.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select><select aria-label="Filtrar por agente" value={teamFilters.agent} onChange={event => { updateTeamFilters({ ...teamFilters, agent: event.target.value }); setSelected([]); }}><option value="all">Todos los agentes</option><option value="none">Sin asignar</option>{staffMembers.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select><button className="text-button" onClick={() => { setSearch(''); updateTeamFilters({ ...teamFilters, company: 'all', agent: 'all', priority: 'all', department: 'all' }); setSelected([]); }}>Limpiar</button></div>}{visibleSelected.length > 0 && <div className="bulk-bar"><strong>{visibleSelected.length} seleccionados</strong><button disabled={busy} onClick={async () => { if (await run(() => Promise.all(visibleTicketSelection(selected, filtered).map(id => request(`/api/tickets/${id}`, 'PATCH', { status: 'resolved' }))), 'Tickets resueltos'))
                setSelected([]); }}><CheckCheck size={16}/>Resolver selección</button><button onClick={() => setSelected([])}>Cancelar</button></div>}
    {counts.all === 0 ? <div className="welcome"><div className="welcome-art"><div className="art-halo"/><div className="art-envelope"><MessageSquare size={34} strokeWidth={1.3}/><span><Check size={13}/></span></div><span className="art-dot one"/><span className="art-dot two"/></div><span className="eyebrow">LAS BUENAS RELACIONES EMPIEZAN AQUÍ</span><h2>Un nuevo espacio.<br />Muchas conversaciones por venir.</h2><p>Crea tu primer ticket y convierte cada solicitud<br className="desktop"/> en una experiencia de atención excepcional.</p><div><button className="primary" disabled={busy} onClick={() => setCreate(true)}><Plus size={16}/>Crear mi primer ticket</button>{isAdmin && <button className="text-button" disabled={busy} onClick={loadDemo}>Explorar con ejemplos <ArrowRight size={15}/></button>}</div>{isAdmin && <small>Los ejemplos son datos ficticios y se guardarán en tu espacio.</small>}</div> : searchResults.error ? <p className="ticket-search-feedback" role="alert">{searchResults.error}</p> : searchResults.loading && filtered.length === 0 ? <p className="ticket-search-feedback" role="status">Buscando tickets y conversaciones…</p> : filtered.length === 0 ? <Empty title="No hay tickets en esta vista">Prueba otra búsqueda o ajusta los filtros.</Empty> : <div className="table-scroll"><table className="ticket-table"><thead><tr><th className="check-cell"><input type="checkbox" aria-label="Seleccionar tickets de esta vista" checked={filtered.length > 0 && filtered.every(t => visibleSelected.includes(t.id))} onChange={e => setSelected(e.target.checked ? filtered.map(t => t.id) : [])}/></th><th>Ticket y solicitante</th><th>Estado</th><th>Prioridad</th><th>Responsable</th><th>Actualizado</th><th /></tr></thead><tbody>{filtered.map(t => <tr key={t.id}><td className="check-cell"><input type="checkbox" aria-label={`Seleccionar ticket ${t.id}`} checked={visibleSelected.includes(t.id)} onChange={e => setSelected(e.target.checked ? [...visibleSelected, t.id] : visibleSelected.filter(id => id !== t.id))}/></td><td className="subject-cell"><button onClick={() => openTicket(t)}><span><span className="ticket-number">#{String(t.id).padStart(4, '0')}</span>{t.subject}</span><small>{t.requesterName}<i /> {t.department}</small></button></td><td><Status status={t.status}/></td><td><Priority priority={t.priority}/></td><td><div className="assignee">{t.assignee ? <><Avatar name={t.assignee} small/><span>{t.assignee.split(' ')[0]}</span></> : <span className="unassigned">Sin asignar</span>}</div></td><td className="time-cell"><span>{since(t.updatedAt, now)}</span>{t.status !== 'resolved' && <small className={sla(t, now) === 'Vencido' ? 'late-text' : ''}>{sla(t, now)}</small>}</td><td><button className="icon-button" onClick={() => openTicket(t)} aria-label={`Abrir ticket ${t.id}`}><ChevronRight size={16}/></button></td></tr>)}</tbody></table></div>}
    <TicketPagination index={searchResults.index} shown={filtered.length} total={searchResults.total} nextCursor={searchResults.nextCursor} previous={() => { setSelected([]); searchResults.previous(); }} next={() => { setSelected([]); searchResults.next(); }} loading={searchResults.loading}/></section><aside className="focus-panel"><div className="focus-heading"><span className="focus-icon"><Activity size={18}/></span><h2>En foco</h2><span className="tiny-live"/></div><p>Las pequeñas acciones<br />hacen la diferencia.</p><div className="focus-divider"/><div className="focus-count"><span>{counts.overdue}</span><div>tickets fuera de plazo<small>Prioriza las conversaciones pendientes.</small></div></div><button className="focus-link" onClick={() => setQueue('overdue')}>Revisar prioridad <ArrowRight size={15}/></button><div className="focus-divider"/><span className="eyebrow">TU PRÓXIMO PASO</span><div className="next-step"><span>01</span><div><strong>{counts.unassigned ? 'Distribuye la carga' : 'Comparte lo que sabes'}</strong><p>{counts.unassigned ? `${counts.unassigned} solicitudes aún no tienen responsable.` : 'Una buena guía puede resolver la siguiente pregunta.'}</p></div></div><button className="focus-link" onClick={() => counts.unassigned ? setQueue('unassigned') : go('knowledge')}>{counts.unassigned ? 'Asignar tickets' : 'Crear un artículo'}<ArrowRight size={15}/></button><div className="focus-quote"><span>“</span>Un gran soporte empieza<br />por escuchar.<div className="quote-line"/></div></aside></div>}

   </> : view === 'security' ? <><PageTitle title="Seguridad de mi cuenta" subtitle="Autenticador, recuperación y dispositivos con acceso."/><SecurityCenter key={`security:${data.viewer!.id}`} memberId={data.viewer!.id}/>{isAdmin&&(data.evolution?.features.security?<SecurityHealthPanel key={`health:${data.viewer!.id}`} memberId={data.viewer!.id}/>:<p className="info-note">El panel de salud y auditoría está preparado. Activa Seguridad en las funciones del espacio para revisarlo. El acceso y la política de doble factor se siguen aplicando.</p>)}</> : view === 'service' ? <><PageTitle title="Empresas y servicios" subtitle="Equipos, sedes, contratos e incidencias con acceso interno."/>{data.evolution?.features.serviceContext?<ServiceContextPanel key={`${data.viewer!.id}:${searchParams.get('company')||'all'}`} memberId={data.viewer!.id} companies={data.companies||[]} members={data.members} administrator={isAdmin} initialCompanyId={searchParams.get('company')}/>:<p className="info-note">Esta función está en pausa. Sus datos y documentos se conservan.</p>}</> : view === 'contacts' ? <><PageTitle title="Personas, no solo tickets" subtitle="El contexto de cada cliente, siempre a mano."/><ContactDirectory key={data.viewer!.id} memberId={data.viewer!.id} refreshKey={feedKey} onSearch={email => { go('inbox'); setQueue('all'); setSearch(email); }}/></> : view === 'knowledge' ? <><PageTitle title="Conocimiento que conecta" subtitle="Guías revisadas y versiones compartidas con cada empresa."/>{isAdmin&&<SavedRepliesManager replies={data.savedReplies||[]} busy={busy} run={run}/>}<div>{data.evolution?.features.knowledge?<KnowledgePanel key={`${accessKey}:knowledge`} memberId={data.viewer!.id} companies={data.companies||[]} staff administrator={isAdmin}/>:<LegacyKnowledgePanel key={`${accessKey}:knowledge-paused`} memberId={data.viewer!.id}/>}</div></> : view==='reports'?<><PageTitle title="Informes por empresa" subtitle="Servicio, cobertura y capturas mensuales privadas."/>{data.evolution?.features.knowledge?<CompanyReportsPanel key={`${accessKey}:reports`} memberId={data.viewer!.id} companies={data.companies||[]}/>:<p className="info-note">Los informes están en pausa. Sus capturas se conservan.</p>}</> : view === 'operations' && isAdmin ? <><PageTitle title="Atención y reparto" subtitle="Los plazos de cada empresa y la disponibilidad de tu equipo, en un lugar."/><OperationsSettingsPanel key={data.viewer!.id} memberId={data.viewer!.id} companies={data.companies} members={data.members} departments={data.settings.departments} onSaved={refresh}/><EscalationSettingsPanel key={`escalation:${data.viewer!.id}`} memberId={data.viewer!.id} members={data.members}/>{data.evolution?.features.automation?<AutomationPanel key={`automation:${data.viewer!.id}`} memberId={data.viewer!.id} companies={data.companies||[]} members={data.members} departments={data.settings.departments}/>:<p className="info-note">Las automatizaciones internas están en pausa. Sus reglas e historial se conservan.</p>}</> : view === 'metrics' && isAdmin ? <><AgentMetricsPanel key={data.viewer!.id} memberId={data.viewer!.id} companies={data.companies}/><SatisfactionReportPanel key={`satisfaction:${data.viewer!.id}`} memberId={data.viewer!.id} companies={data.companies} members={data.members}/></> : view === 'team' && isAdmin ? <AccessPanel data={data} busy={busy} run={run} /> : view === 'settings' && isAdmin ? <><PageTitle title="Hazlo tuyo" subtitle="Identidad, organización y avisos del espacio."/><MailPanel status={data.mailStatus} busy={busy} run={run}/><NotificationSettingsPanel/><EmailInboundPanel key={`inbound:${data.viewer!.id}`} memberId={data.viewer!.id} administrator/>{data.viewer!.role === 'owner' && <><BackupPanel key={`backup:${data.viewer!.id}`} memberId={data.viewer!.id}/><AutomaticBackupPanel key={`automatic-backup:${data.viewer!.id}`} memberId={data.viewer!.id}/></>}{data.evolution?.features.organization&&<OrganizationManager key={`organization:${data.viewer!.id}`} memberId={data.viewer!.id} companies={data.companies||[]}/>}<EvolutionFeaturesPanel key={`evolution:${data.viewer!.id}`} memberId={data.viewer!.id} onChanged={refresh}/><SettingsForm settings={data.settings} members={data.members} busy={busy} onSave={s => run(() => request('/api/settings', 'PATCH', s), 'Configuración guardada')}/></> : <><PageTitle title="Centro de ayuda" subtitle="Cada cliente consulta únicamente las versiones aprobadas para su empresa."/>{data.evolution?.features.knowledge?<KnowledgePanel key={`${accessKey}:help-staff`} memberId={data.viewer!.id} companies={data.companies||[]} staff administrator={isAdmin}/>:<LegacyKnowledgePanel key={`${accessKey}:help-paused`} memberId={data.viewer!.id}/>}</>}
   <footer className="page-footer"><span>{data.settings.brandName} <i /> {data.settings.tagline}</span><span>Parte de Servicios Daybook.</span></footer>
   </div>
  </main>
  {create && <Modal error={error} title="Una nueva conversación" onClose={() => setCreate(false)} wide><TicketForm knowledgeEnabled={Boolean(data.evolution?.features.knowledge)} organizationEnabled={Boolean(data.evolution?.features.organization)} viewer={data.viewer!} settings={data.settings} members={data.members} busy={busy} onCancel={() => setCreate(false)} onSubmit={async (body) => { let createdId: number | null = null; const ok = await run(async () => { const result = await request<{ ticket: Ticket }>('/api/tickets', 'POST', body); createdId = result.ticket.id; }, 'Ticket creado'); if (ok && createdId !== null) {
        setCreate(false);
        setView('inbox');
        setTicketId(createdId);
    } return ok; }}/></Modal>}

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
function StaffComposer({ ticket, viewer, savedReplies, legacyEmail, busy, onSave, replyTarget, onClearReply, collaboration, members }: {
    ticket: Ticket;
    viewer: Member;
    legacyEmail: string;
    replyTarget:Message|null;onClearReply:()=>void;collaboration:boolean;members:Member[];
    savedReplies: SavedReplyItem[];
    busy: boolean;
    onSave: (message: { body: string; bodyFormat?: 'plain' | 'markdown'; kind: DraftKind; replyToMessageId?:number|null;mentionMemberIds?:string[];draftId: string; attachmentIds: string[]; operationId: string }) => Promise<boolean>;
}) {
    const { draft, message, persistent, selectKind, edit, complete, setReferences } = useTicketDraft({ memberId: viewer.id, role: viewer.role, ticketId: ticket.id }, legacyEmail);
    const scope = `${ticketDraftKey({ memberId: viewer.id, role: viewer.role, ticketId: ticket.id })}.${message.kind}`;
    const attachments = useDraftAttachments(scope, message.kind, ticket.id);
    const saving = useRef(false);
    const mentionIds=message.mentionMemberIds??[];
    const setMentionIds=(ids:string[])=>setReferences(message.kind,{...(message.replyToMessageId?{replyToMessageId:message.replyToMessageId}:{}),...(ids.length?{mentionMemberIds:ids}:{})});
    const resolvedQuote=useDraftQuote({memberId:viewer.id,role:viewer.role,ticketId:ticket.id},message.kind,message.replyToMessageId);
    const quote=resolvedQuote.quote;
    useEffect(()=>{if(!replyTarget)return;const kind=replyTarget.kind==='note'?'note':message.kind;setReferences(kind,{...draft.references?.[kind],replyToMessageId:replyTarget.id});if(kind!==message.kind)selectKind(kind);onClearReply();},[replyTarget,message.kind,draft.references,setReferences,selectKind,onClearReply]);
    return <form className={`composer ticket-chat-composer ${message.kind}`} onSubmit={async event => {
        event.preventDefault();
        if (busy || saving.current || !message.body.trim() || !attachments.canSubmit || resolvedQuote.loading || resolvedQuote.error) return;
        saving.current = true;
        try {
            const payload = { ...message, ...attachments.payload(), bodyFormat: 'markdown' as const };
            const operations = getDraftOperations();
            if (await onSave({ ...payload, operationId: operations.forPayload(scope, payload) })) { complete(message); attachments.complete(); operations.clear(scope); }
        }
        finally { saving.current = false; }
    }}>
        <div className="composer-tabs">
            <button type="button" className={message.kind === 'reply' ? 'chosen' : ''} disabled={busy || attachments.busy} aria-pressed={message.kind === 'reply'} onClick={() => selectKind('reply')}><MessageSquare size={15}/>Respuesta</button>
            <button type="button" className={message.kind === 'note' ? 'chosen' : ''} disabled={busy || attachments.busy} aria-pressed={message.kind === 'note'} onClick={() => selectKind('note')}><ShieldCheck size={15}/>Nota interna</button>
        </div>
        <details className="ticket-chat-saved-replies"><summary><Sparkles size={15}/>Respuestas guardadas</summary><SavedReplyPicker replies={savedReplies} busy={busy} onInsert={body => edit(message.body ? `${message.body}\n\n${body}` : body)}/></details>
        {draft.recoveredLegacy && <p className="draft-notice" role="status">Recuperamos un borrador anterior como nota interna para mantenerlo privado. Revísalo antes de guardarlo.</p>}
        {!persistent && <p className="draft-notice" role="status">Tu navegador no permite guardar este borrador al recargar. Conservaremos el texto mientras esta página siga abierta.</p>}
        {message.replyToMessageId&&<div className="ticket-reply-banner"><span><strong>{quote?`Respondiendo a ${quote.author}${quote.kind==='note'?' · Nota interna':''}`:resolvedQuote.loading?'Comprobando cita…':'Cita pendiente de comprobar'}</strong>{quote&&<small>{quote.body.slice(0,180)}</small>}{resolvedQuote.error&&<><small role="alert">{resolvedQuote.error}</small><button type="button" className="text-button" onClick={resolvedQuote.retry}>Reintentar cita</button></>}</span><button type="button" className="icon-button" aria-label="Quitar cita" onClick={()=>setReferences(message.kind,mentionIds.length?{mentionMemberIds:mentionIds}:{})}><X size={16}/></button></div>}
        {collaboration&&message.kind==='note'&&<div className="ticket-mention-picker"><label>Mencionar a<select aria-label="Mencionar a un compañero" value="" disabled={busy||mentionIds.length>=10} onChange={event=>{const person=members.find(member=>member.id===event.target.value);if(person&&mentionIds.length<10&&!mentionIds.includes(person.id)){setMentionIds([...mentionIds,person.id]);edit(`${message.body}${message.body?' ':''}@${person.name} `);}}}><option value="">Seleccionar compañero…</option>{members.filter(person=>person.status==='active'&&person.hasAccount&&person.role!=='client'&&person.id!==viewer.id&&!mentionIds.includes(person.id)).map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>{mentionIds.map(id=><button type="button" key={id} onClick={()=>setMentionIds(mentionIds.filter(item=>item!==id))} aria-label={`Quitar mención a ${members.find(person=>person.id===id)?.name||'compañero'}`}>@{members.find(person=>person.id===id)?.name||'Compañero anterior'}<X size={12}/></button>)}</div>}
        <MessageEditor compact label={message.kind === 'note' ? 'Escribir nota interna' : 'Escribir respuesta'} value={message.body} disabled={busy} onChange={value => { edit(value); notifyTicketPresenceActivity(ticket.id, message.kind); }} placeholder={message.kind === 'note' ? 'Añade contexto para el seguimiento del caso…' : 'Escribe una respuesta clara y cercana…'}/>
        <AttachmentComposer controls={attachments} disabled={busy}/>
        <div className="composer-footer"><small>{message.kind === 'reply' ? (ticket.requesterMemberId ? 'El cliente podrá verla en su portal. El aviso por correo se registra por separado.' : 'Vincula una cuenta de cliente para que pueda consultar esta respuesta en su portal.') : 'Solo visible para tu equipo. No se envía al cliente.'}</small><button className="primary" disabled={busy || !message.body.trim() || !attachments.canSubmit || resolvedQuote.loading || Boolean(resolvedQuote.error)}>{busy ? <LoaderCircle className="spin" size={15}/> : <Send size={15}/>} {busy ? 'Guardando…' : message.kind === 'note' ? 'Guardar nota' : 'Enviar respuesta'}</button></div>
    </form>;
}

function TicketForm({ viewer, settings, members, busy, onCancel, onSubmit, organizationEnabled,knowledgeEnabled }: {
    knowledgeEnabled:boolean;
    organizationEnabled: boolean;
    viewer: Member;
    settings: Settings;
    members: Member[];
    busy: boolean;
    onCancel: () => void;
    onSubmit: (body: unknown) => Promise<boolean>;
}) {
    const scope = `${viewer.id}:${viewer.role}:new-ticket`;
    const [initialDraft] = useState(() => readNewTicketDraft(scope));
    const [requesterId, setRequesterId] = useState(initialDraft.requesterMemberId || '');
    const[knowledgeQuery,setKnowledgeQuery]=useState(initialDraft.subject||'');
    const [organizationRequest,setOrganizationRequest]=useState<OrganizationRequestValue>(()=>readNewTicketOrganization(scope));
    const changeOrganizationRequest=(value:OrganizationRequestValue)=>{setOrganizationRequest(value);writeNewTicketOrganization(scope,value);};
    const attachments = useDraftAttachments(scope, 'request');
    const clients = members.filter(member => member.role === 'client' && member.status !== 'revoked');
    const staff = members.filter(member => member.role !== 'client' && member.status === 'active');
    const requester = clients.find(member => member.id === requesterId);
    return <form className="form" onChange={event => { const values = Object.fromEntries(new FormData(event.currentTarget).entries()); writeNewTicketDraft(scope, Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))); }} onSubmit={e => { e.preventDefault(); if (!attachments.canSubmit) return; const form = new FormData(e.currentTarget); const body: Record<string, unknown> = Object.fromEntries(form.entries()); if (body.assigneeMemberId === '__auto__') delete body.assigneeMemberId; else body.assigneeMemberId = body.assigneeMemberId || null; if (requesterId) body.requesterMemberId = requesterId; else delete body.requesterMemberId; Object.assign(body, attachments.payload()); if(organizationRequest.requestTypeId||Object.keys(organizationRequest.fieldValues||{}).length)Object.assign(body,organizationRequest); const operationId = getDraftOperations().forPayload(scope, body); void onSubmit({ ...body, operationId }).then(ok => { if (ok) { attachments.complete(); clearNewTicketDraft(scope); getDraftOperations().clear(scope); } }); }}>
      <p className="form-intro">Vincula la cuenta del cliente para que pueda consultar y responder este ticket en su portal.</p>
      <div className="form-grid">
        <label className="full">Cuenta del cliente<select name="requesterMemberId" value={requesterId} disabled={busy} onChange={e => {setRequesterId(e.target.value);changeOrganizationRequest({});}}><option value="">Registrar sin cuenta vinculada</option>{clients.map(member => <option key={member.id} value={member.id}>{member.name} · {member.email}</option>)}</select></label>
        {requester ? <div className="full staff-account-preview"><strong>{requester.name}</strong>{requester.email} · {requester.status === 'invited' ? 'Podrá entrar cuando acepte su invitación.' : 'Podrá consultar la conversación desde su portal.'}</div> : <><label>Nombre del solicitante<input name="requesterName" defaultValue={initialDraft.requesterName} required maxLength={120} placeholder="Ej. Andrea Molina" disabled={busy}/></label><label>Correo electrónico<input name="requesterEmail" defaultValue={initialDraft.requesterEmail} type="email" required maxLength={254} placeholder="andrea@empresa.com" disabled={busy}/></label></>}
        <label className="full">Asunto<input name="subject" defaultValue={initialDraft.subject} onChange={event=>setKnowledgeQuery(event.target.value)} required maxLength={160} placeholder="Resume la solicitud en una frase" disabled={busy} autoFocus/></label>
        <label>Departamento<select name="department" defaultValue={initialDraft.department} disabled={busy}>{settings.departments.map(department => <option key={department}>{department}</option>)}</select></label>
        <label>Prioridad<select name="priority" defaultValue={initialDraft.priority || 'normal'} disabled={busy}>{Object.entries(PRIORITY).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="full">Responsable<select name="assigneeMemberId" defaultValue={initialDraft.assigneeMemberId ?? '__auto__'} disabled={busy}><option value="__auto__">Automático según reglas</option><option value="">Sin asignar (manual)</option>{staff.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
        <label className="full">Descripción<textarea name="body" defaultValue={initialDraft.body} required maxLength={20000} rows={5} placeholder="¿Qué está pasando? Añade el contexto necesario para ayudar." disabled={busy}/></label>
      </div>
      {knowledgeEnabled&&<KnowledgeSuggestions key={`${viewer.id}:${viewer.role}`} memberId={viewer.id} query={knowledgeQuery}/>}
      {organizationEnabled&&<RequestOrganizationFields key={`${viewer.id}:${requester?.customerCompanyId||'none'}`} memberId={viewer.id} companyId={requester?.customerCompanyId} staff value={organizationRequest} onChange={changeOrganizationRequest} disabled={busy}/>}
      <AttachmentComposer controls={attachments} disabled={busy}/>
      <div className="form-footer"><button type="button" className="secondary" onClick={onCancel} disabled={busy}>Cancelar</button><button disabled={busy || !attachments.canSubmit} className="primary"><Plus size={16}/>Crear ticket</button></div>
    </form>;
}

function SettingsForm({ settings, members, busy, onSave }: {
    settings: Settings;
    members: Member[];
    busy: boolean;
    onSave: (s: Partial<Settings>) => Promise<boolean>;
}) {
    const [s, setS] = useState(settings);
    const [departments, setDepartments] = useState(settings.departments.join('\n'));
    const notificationMembers = members.filter(member => ['owner', 'admin', 'agent'].includes(member.role) && ['active', 'invited'].includes(member.status));
    const eligibleIds = new Set(notificationMembers.map(member => member.id));
    const selectedIds = s.notificationMemberIds || [];
    const selectedEligibleIds = selectedIds.filter(id => eligibleIds.has(id));
    const toggleRecipient = (id: string, selected: boolean) => setS(previous => ({
        ...previous,
        notificationMemberIds: selected
            ? [...new Set([...(previous.notificationMemberIds || []), id])]
            : (previous.notificationMemberIds || []).filter(current => current !== id),
    }));
    return <form className="settings-form" onSubmit={event => {
        event.preventDefault();
        onSave({ brandName: s.brandName, tagline: s.tagline, agents: s.agents, notificationMemberIds: selectedEligibleIds, departments: departments.split('\n').map(value => value.trim()).filter(Boolean) });
    }}>
        <section className="panel settings-section">
            <div><span className="setting-icon"><Sparkles size={22}/></span><h2>Identidad de marca</h2><p>El nombre y la voz de tu producto.</p></div>
            <div className="form"><label>Nombre del producto<input required maxLength={80} value={s.brandName} onChange={event => setS({ ...s, brandName: event.target.value })}/></label><label>Frase de marca<input required maxLength={180} value={s.tagline} onChange={event => setS({ ...s, tagline: event.target.value })}/></label></div>
        </section>
        <section className="panel settings-section">
            <div><span className="setting-icon"><Users size={22}/></span><h2>Organización</h2><p>Un departamento por línea. Gestiona las cuentas responsables desde Equipo y clientes.</p></div>
            <div className="form form-grid"><label>Departamentos<textarea required rows={5} value={departments} onChange={event => setDepartments(event.target.value)}/></label></div>
        </section>
        <section className="panel settings-section">
            <div><span className="setting-icon"><Bell size={22}/></span><h2>Notificaciones</h2><p>Comparte el seguimiento de las solicitudes con las personas de tu equipo.</p></div>
            <div className="form">
                <fieldset className="notification-recipients" disabled={busy} aria-describedby="notification-responsibles-help">
                    <legend>Responsables de los avisos</legend>
                    <p id="notification-responsibles-help">Recibirán avisos de tickets nuevos y respuestas de clientes, aunque el ticket esté asignado a otra persona.</p>
                    <div className="notification-recipient-list">{notificationMembers.map(member => <label className="notification-recipient" key={member.id}>
                        <input type="checkbox" checked={selectedIds.includes(member.id)} onChange={event => toggleRecipient(member.id, event.target.checked)}/>
                        <span><strong>{member.name}</strong><small>{member.email} · {ROLE_LABELS[member.role]}</small>{member.status === 'invited' && <small className="notification-recipient-pending">Invitación pendiente: recibirá avisos cuando active su cuenta.</small>}</span>
                    </label>)}</div>
                    {selectedEligibleIds.length === 0 && <p className="notification-recipient-note">Sin selección se avisa al responsable asignado o al equipo disponible.</p>}
                    {selectedEligibleIds.length !== selectedIds.length && <p className="notification-recipient-note">Las cuentas que ya no tienen acceso se quitarán de la selección al guardar.</p>}
                </fieldset>
            </div>
        </section>

        <div className="form-footer"><button className="primary" disabled={busy}><Check size={17}/>Guardar configuración</button></div>
    </form>;
}

function Overview({ data, now, onOpen }: {
    data: Workspace;
    now: number;
    onOpen: (t: Ticket) => void;
}) { const total = data.ticketCounts?.all ?? data.tickets.length; const resolved = data.ticketCounts?.resolved ?? 0; return <div className="overview-grid"><section className="panel"><div className="section-head"><h2>Distribución por departamento</h2><span>Todos los tickets</span></div><div className="bar-chart">{[...new Set([...data.settings.departments, ...(data.ticketDepartments ?? []).map(item => item.department)])].map((d, i) => { const n = data.ticketDepartments?.find(item => item.department === d)?.total ?? 0; return <div className="bar-row" key={d}><div><span>{d}</span><strong>{n}</strong></div><div className="bar-track"><span style={{ width: `${total ? n / total * 100 : 0}%`, background: ['#6375d6', '#94afa6', '#c8d58b'][i % 3] }}/></div></div>; })}<small>Distribución calculada a partir de tus conversaciones.</small></div></section><section className="panel"><div className="section-head"><h2>Balance de atención</h2><CheckCircle2 size={18}/></div><div className="resolution"><div className="donut" style={{ background: `conic-gradient(#8daba1 ${(total ? resolved / total : 0) * 360}deg,#eef0ec 0deg)` }}><div><strong>{total ? Math.round(resolved / total * 100) : 0}%</strong><span>resueltos</span></div></div><p>{resolved} de {total} conversaciones<br />se han completado.</p></div></section><section className="panel recent"><div className="section-head"><h2>Últimas conversaciones</h2><span>Actividad reciente</span></div>{data.tickets.length === 0 ? <Empty title="Todo listo para empezar">Aquí verás las conversaciones más recientes.</Empty> : data.tickets.slice(0, 5).map(t => <button className="recent-row" key={t.id} onClick={() => onOpen(t)}><Avatar name={t.requesterName} small/><div><strong>{t.subject}</strong><small>{t.requesterName} · {since(t.updatedAt, now)}</small></div><Status status={t.status}/><ChevronRight size={17}/></button>)}</section></div>; }
