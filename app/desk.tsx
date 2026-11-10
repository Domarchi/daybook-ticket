'use client';
import { useTeamFilters } from '@/hooks/use-team-filters';
import { useTicketAlerts } from '@/hooks/use-ticket-alerts';
import { type TicketFilters, useTicketConversation, useTicketSearch } from '@/hooks/use-ticket-search';
import { useWorkspace } from '@/hooks/use-workspace';
import { disconnectPushOnSignOut } from '@/lib/push-client';
import { visibleTicketSelection } from '@/lib/ticket-selection';
import { currentWorkspaceId } from '@/lib/workspace-client';
import { workspaceHome } from '@/lib/workspace-model';
import { CheckCircle2, ChevronRight, LoaderCircle, Menu, Search, ShieldCheck, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMediaQuery } from '@/hooks/use-media-query';
import { leaveTicket, navigateDesk, parseDeskLocation } from '@/lib/desk-url';
import { adoptConfirmed, applyOverlay, beginChange, canUndo, changeMessage, isSaving, previousValues, settleChange, type Overlay, type TicketPatch } from '@/lib/ticket-overlay';
import { type Ticket } from '../lib/types';
import ClientPortal from './client-portal';
import { ThemeControl } from './evolution-controls';
import { LiveStatus } from './live-status';
import { TicketAlerts } from './ticket-alerts';
import { View, request, Modal, STATUS, PRIORITY, views, Avatar, ReplyTarget } from './desk-parts/shared';
import { TicketView } from './desk-parts/ticket-view';
import { InboxView } from './desk-parts/inbox-view';
import { SectionView } from './desk-parts/section-view';
import { Sidebar } from './desk-parts/sidebar';
import { TicketForm } from './desk-parts/ticket-form';

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
    const location = useMemo(() => parseDeskLocation(searchParams), [searchParams]);
    const requestedView = location.view, ticketId = location.ticketId;
    const [search, setSearch] = useState(''), [showFilters, setShowFilters] = useState(false), [mobile, setMobile] = useState(false);
    const narrow = useMediaQuery('(max-width: 750px)');
    const drawerOpen = mobile && narrow;
    const closeMenu = useCallback(() => setMobile(false), []);
    // Leaving the narrow layout closes the drawer, so it does not reopen by itself when the window shrinks again.
    const [wasNarrow, setWasNarrow] = useState(narrow);
    if (narrow !== wasNarrow) { setWasNarrow(narrow); if (!narrow) setMobile(false); }
    const [create, setCreate] = useState(false), [selected, setSelected] = useState<number[]>([]);
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
    const [undoAction, setUndoAction] = useState<{ run: () => void } | null>(null);
    const notify = (message: string, undo: { run: () => void } | null = null) => { setUndoAction(undo); setToast(message); };
    useEffect(() => { if (toast) {
        // A toast with "Deshacer" stays long enough to reach it.
        const t = setTimeout(() => { setToast(''); setUndoAction(null); }, undoAction ? 10_000 : 4000);
        return () => clearTimeout(t);
    } }, [toast, undoAction]);
    useEffect(() => { function key(e: KeyboardEvent) { if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        navigateDesk({ view: 'inbox' });
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
        notify(message);
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
        return; navigateDesk({ view: v }); setSearch(''); setMobile(false); setSelected([]); };
    const openTicket = (ticket: Ticket) => { if (!busy) navigateDesk({ ticketId: ticket.id }); };
    const tickets = data.tickets;
    const counts: Record<string, number> = { ...(data.ticketCounts ?? { all: tickets.length, open: 0, pending: 0, resolved: 0, mine: 0, unassigned: 0, overdue: 0 }) };
    const feedKey = data.alertsPage?.snapshotAt;
    const searchResults = useTicketSearch(data.viewer?.id, { q: search, queue: queue as TicketFilters['queue'], priority: priority as TicketFilters['priority'], department, company: teamFilters.company, agent: teamFilters.agent }, feedKey, view === 'inbox' && data.viewer?.role !== 'client');
    const accessKey = `${data.viewer?.id}:${data.viewer?.role}:${data.viewer?.customerCompanyId}:${data.viewer?.companyAccess}`;
    const [replyTarget,setReplyTarget]=useState<ReplyTarget>(null);
  const conversation = useTicketConversation(data.viewer?.id, accessKey, data.viewer?.role === 'client' ? null : ticketId, feedKey);
    const filtered = searchResults.items;
    const visibleSelected = visibleTicketSelection(selected, filtered);
    const [overlays, setOverlays] = useState<Record<number, Overlay>>({});
    const changeSeq = useRef(0);
    const loadedTicket = conversation.ticket;
    const current = useMemo(() => loadedTicket ? applyOverlay(loadedTicket, overlays[loadedTicket.id]) : null, [loadedTicket, overlays]);
    const currentOverlay = current ? overlays[current.id] : undefined;
    const savingField = (key: keyof Ticket) => isSaving(currentOverlay, key);
    // Instant, per-field change: the screen updates first, the server confirms or the change is taken back.
    const changeTicket = async (ticket: Ticket, body: TicketPatch, offerUndo = true): Promise<boolean> => {
        const seq = ++changeSeq.current, keys = Object.keys(body), previous = previousValues(ticket, body);
        setError('');
        setOverlays(all => ({ ...all, [ticket.id]: beginChange(all[ticket.id], body, seq) }));
        try {
            const { ticket: saved } = await request<{ ticket: Ticket }>(`/api/tickets/${ticket.id}`, 'PATCH', body);
            setOverlays(all => ({ ...all, [ticket.id]: settleChange(all[ticket.id], keys, seq, saved) }));
            notify(changeMessage(body), offerUndo && canUndo(body, previous) ? { run: () => { void changeTicket({ ...ticket, ...saved }, previous, false); } } : null);
            refresh().catch(() => setError('El cambio se guardó. Reintentaremos actualizar la vista automáticamente; no necesitas reenviarlo.'));
            return true;
        } catch (failure) {
            setOverlays(all => ({ ...all, [ticket.id]: settleChange(all[ticket.id], keys, seq) }));
            setError(failure instanceof Error ? failure.message : 'Algo salió mal.');
            // If the answer was lost the change may still have been saved: show what the server has.
            refresh().catch(() => undefined);
            return false;
        }
    };
    const resolveSelected = async () => {
        const ids = [...visibleSelected];
        setBusy(true); setError('');
        const results = await Promise.allSettled(ids.map(id => request(`/api/tickets/${id}`, 'PATCH', { status: 'resolved' })));
        const failed = ids.filter((_, index) => results[index].status === 'rejected');
        try { await refresh(); } catch { setError('Los cambios se guardaron. Reintentaremos actualizar la vista automáticamente; no necesitas reenviarlos.'); }
        setBusy(false);
        if (failed.length === 0) { notify(ids.length === 1 ? 'Ticket resuelto' : `${ids.length} tickets resueltos`); setSelected([]); }
        else { setError(`Se resolvieron ${ids.length - failed.length} de ${ids.length}. No se pudieron resolver: ${failed.map(id => `#${String(id).padStart(4, '0')}`).join(', ')}.`); setSelected(failed); }
    };
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
    const openAlert = (id: number) => { window.open(workspaceHome(currentWorkspaceId(),id), '_blank', 'noopener,noreferrer'); };
    if (!loading && data.viewer?.role === 'client') return <ClientPortal key={`${data.viewer.id}:${data.viewer.role}`} data={data} displayName={viewerName} email={data.viewer.email} onRefresh={refresh} connection={connection} alerts={alerts} />;
    if (!loading && !data.viewer) return <main className="staff-denied"><ShieldCheck size={35} /><h1>Tu acceso a Daybook Ticket</h1><p role="alert">{loadError || error || 'Tu cuenta necesita una invitación activa para entrar a este espacio.'}</p><div><button className="secondary" onClick={() => window.location.reload()}>Volver a intentar</button><button className="primary" disabled={busy} onClick={signOut}>Cambiar de cuenta</button></div></main>;
    return <div className="app-shell">
   <Sidebar view={view} mobile={drawerOpen} onClose={closeMenu} go={go} counts={counts} setQueue={setQueue} isAdmin={isAdmin} data={data} busy={busy} signOut={signOut} viewerName={viewerName}/>
  {drawerOpen && <button className="sidebar-scrim" aria-label="Cerrar menú" tabIndex={-1} onClick={closeMenu}/>}
  <main className="main" inert={drawerOpen || undefined}><header className="topbar"><div className="breadcrumbs"><button className="icon-button menu-toggle" onClick={() => setMobile(!drawerOpen)} aria-label="Abrir menú" aria-expanded={drawerOpen} aria-controls="daybook-navigation"><Menu size={20}/></button><span>Espacio de trabajo</span><ChevronRight size={13}/><strong>{views[view]}</strong></div><div className="top-actions"><span className="live-dot"/>{busy ? 'Guardando cambios…' : error ? 'Revisa el aviso' : 'Equipo Daybook'} <span className="top-separator"/><button className="icon-button" onClick={() => { go('inbox'); searchRef.current?.focus(); }} aria-label="Buscar tickets"><Search size={18}/></button><Avatar name={viewerName} small/></div></header>
   <div className="content">
   <div className="workspace-sync">{data.viewer&&<ThemeControl key={data.viewer.id} memberId={data.viewer.id} preferred={data.preferences?.theme||'system'}/>}<LiveStatus connection={connection} />{data.viewer && <TicketAlerts alerts={alerts} onOpen={openAlert} />}</div>
   {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Cerrar aviso"><X size={17}/></button></div>}
   {loading ? <div className="loading"><LoaderCircle className="spin"/><p>Preparando tu espacio…</p></div> : ticketId && !current ? <div className="panel ticket-search-feedback" role={conversation.error ? 'alert' : 'status'}>{conversation.error || 'Cargando conversación…'}<button className="text-button" onClick={leaveTicket}>Volver a la bandeja</button></div> : current ? <TicketView data={data} current={current} conversation={conversation} busy={busy} isAdmin={isAdmin} now={now} accessKey={accessKey} email={email} clientMembers={clientMembers} replyTarget={replyTarget} setReplyTarget={setReplyTarget} run={run} refresh={refresh} change={changeTicket} savingField={savingField} onAssigned={ticket => setOverlays(all => ({ ...all, [ticket.id]: adoptConfirmed(all[ticket.id], ticket) }))} onBack={leaveTicket}/> : view === 'inbox' || view === 'overview' ? <InboxView view={view} data={data} busy={busy} isAdmin={isAdmin} now={now} counts={counts} search={search} setSearch={setSearch} teamFilters={teamFilters} updateTeamFilters={updateTeamFilters} queue={queue} priority={priority} department={department} setQueue={setQueue} setPriority={setPriority} setDepartment={setDepartment} showFilters={showFilters} setShowFilters={setShowFilters} setSelected={setSelected} visibleSelected={visibleSelected} filtered={filtered} searchResults={searchResults} searchRef={searchRef} staffMembers={staffMembers} exportCsv={exportCsv} resolveSelected={resolveSelected} loadDemo={loadDemo} setCreate={setCreate} openTicket={openTicket} go={go}/> : <SectionView view={view} data={data} isAdmin={isAdmin} accessKey={accessKey} feedKey={feedKey} busy={busy} companyParam={searchParams.get('company')} run={run} refresh={refresh} go={go} setQueue={setQueue} setSearch={setSearch}/>}
   <footer className="page-footer"><span>{data.settings.brandName} <i /> {data.settings.tagline}</span><span>Parte de Servicios Daybook.</span></footer>
   </div>
  </main>
  {create && <Modal error={error} title="Una nueva conversación" onClose={() => setCreate(false)} wide><TicketForm knowledgeEnabled={Boolean(data.evolution?.features.knowledge)} organizationEnabled={Boolean(data.evolution?.features.organization)} viewer={data.viewer!} settings={data.settings} members={data.members} busy={busy} onCancel={() => setCreate(false)} onSubmit={async (body) => { let createdId: number | null = null; const ok = await run(async () => { const result = await request<{ ticket: Ticket }>('/api/tickets', 'POST', body); createdId = result.ticket.id; }, 'Ticket creado'); if (ok && createdId !== null) {
        setCreate(false);
        navigateDesk({ ticketId: createdId });
    } return ok; }}/></Modal>}

  {toast && <div className="toast" role="status"><CheckCircle2 size={18}/>{toast}{undoAction && <button type="button" className="toast-undo" onClick={() => { const action = undoAction; setUndoAction(null); setToast(''); action.run(); }}>Deshacer</button>}</div>}
  {busy && <div className="saving" role="status"><LoaderCircle size={14} className="spin"/>Guardando…</div>}
 </div>;
}
