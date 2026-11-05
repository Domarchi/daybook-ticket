'use client';
import {KnowledgePanel,KnowledgeSuggestions} from './knowledge';
import {RequestOrganizationFields,TicketOrganizationPanel,SavedViewPicker,type OrganizationRequestValue} from './work-organization';
import {daybookFetch,UNCERTAIN_SEND_MESSAGE} from '@/lib/browser-request';
import { MessageEditor } from './message-content';
import { TicketChat } from './ticket-chat';
import { TicketSatisfactionPanel } from './satisfaction';
import { EmailInboundPanel } from './email-inbound';
import { PublicTicketProgress } from './public-ticket-progress';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, ChevronRight, CircleHelp, Clock3, Headphones, LoaderCircle, LogOut, MessageSquare, Plus, RefreshCw, Search, Send, ShieldCheck, Ticket as TicketIcon, X } from 'lucide-react';
import type { Message, Ticket, TicketPriority, TicketStatus, Workspace } from '../lib/types';
import Brand from './brand';
import {ThemeControl} from './evolution-controls';
import { LiveStatus } from './live-status';
import type { ConnectionStatus } from '@/hooks/use-workspace';
import type { AlertControls } from '@/hooks/use-ticket-alerts';
import { TicketAlerts } from './ticket-alerts';
import { disconnectPushOnSignOut } from '@/lib/push-client';
import { useDraftQuote } from '@/hooks/use-draft-quote';
import { useTicketDraft } from '@/hooks/use-ticket-draft';
import { ticketDraftKey } from '@/lib/ticket-drafts';
import { getDraftOperations } from '@/lib/draft-operations';
import { readNewTicketDraft, writeNewTicketDraft, clearNewTicketDraft,readNewTicketOrganization,writeNewTicketOrganization } from '@/lib/new-ticket-draft';
import { useDraftAttachments } from '@/hooks/use-draft-attachments';
import { AttachmentComposer } from './attachments';
import './client-portal.css';
import { useTicketSearch, useTicketConversation, type TicketFilters } from '@/hooks/use-ticket-search';
import { TicketPagination } from './ticket-pagination';

const STATUS: Record<TicketStatus, string> = { open: 'Abierto', pending: 'En espera', resolved: 'Resuelto' };
const PRIORITY: Record<TicketPriority, string> = { low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };
const date = (value: string) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const number = (id: number) => `#${String(id).padStart(4, '0')}`;

async function post<T = unknown>(path: string, body: unknown): Promise<T> {
  const response = await daybookFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },UNCERTAIN_SEND_MESSAGE);
  const result: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result && typeof result === 'object' && 'error' in result ? result.error : null;
    throw new Error(typeof message === 'string' ? message : 'No se pudo guardar. Inténtalo de nuevo.');
  }
  return result as T;
}

function Badge({ status }: { status: TicketStatus }) {
  return <span className={`status ${status}`}><span />{STATUS[status]}</span>;
}

export default function ClientPortal({ data, displayName, email, onRefresh, connection, alerts }: {
  data: Workspace;
  displayName: string;
  email: string;
  onRefresh: () => Promise<Workspace>;
  connection: ConnectionStatus;
  alerts: AlertControls;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [section, setSection] = useState<'tickets' | 'help'>('tickets');
  const [selectedId, setSelectedId] = useState<number | null>(() => { const id = Number(searchParams.get('ticket')); return Number.isSafeInteger(id) && id > 0 ? id : null; });
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const createScope = `${data.viewer!.id}:client:new-ticket`;
  const [draft, setDraft] = useState(() => { const saved = readNewTicketDraft(createScope); return { subject: saved.subject || '', body: saved.body || '', priority: saved.priority || 'normal', department: saved.department || data.settings.departments[0] || '' }; });
  const updateDraft = (next: typeof draft) => { setDraft(next); writeNewTicketDraft(createScope, next); };
  const operation = useRef(false);
  const [organizationRequest,setOrganizationRequest]=useState<OrganizationRequestValue>(()=>readNewTicketOrganization(createScope));
  const changeOrganizationRequest=(value:OrganizationRequestValue)=>{setOrganizationRequest(value);writeNewTicketOrganization(createScope,value);};
  const createAttachments = useDraftAttachments(createScope, 'request');
  const isCompanyManager = data.viewer?.companyAccess === 'manager' && Boolean(data.viewer.customerCompanyId);
  const companyName = data.companies?.find(company => company.id === data.viewer?.customerCompanyId)?.name;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const feedKey = data.alertsPage?.snapshotAt;
  const accessKey = `${data.viewer?.id}:${data.viewer?.role}:${data.viewer?.customerCompanyId}:${data.viewer?.companyAccess}`;
  const [replyTarget,setReplyTarget]=useState<{memberId:string;ticketId:number;message:Message}|null>(null);
  const conversation = useTicketConversation(data.viewer?.id, accessKey, selectedId, feedKey);
  const current = conversation.ticket;
  const searchResults = useTicketSearch(data.viewer?.id, { q: search, queue: filter as TicketFilters['queue'], priority: 'all', department: 'all', company: 'all', agent: 'all' }, feedKey, section === 'tickets' && !creating && selectedId === null);
  const visibleTickets = searchResults.items;
  const counts = data.ticketCounts ?? { all: data.tickets.length, open: 0, pending: 0, resolved: 0 };
  const openCount = counts.open + counts.pending;

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 7000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => { headingRef.current?.focus(); }, [selectedId, creating, section]);

  const navigate = (next: 'tickets' | 'help') => {
    if (busy) return;
    setSection(next); setSelectedId(null); setCreating(false); setSearch(''); setError('');
  };

  const openTicket = (ticket: Ticket) => {
    if (busy) return;
    setSelectedId(ticket.id); setCreating(false); setError('');
  };

  const refresh = async () => {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError('');
    try { await onRefresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo actualizar la vista.'); }
    finally { operation.current = false; setBusy(false); }
  };

  const createTicket = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (operation.current || !createAttachments.canSubmit) return;
    operation.current = true; setBusy(true); setError('');
    try {
      const payload = { ...draft, ...createAttachments.payload(), bodyFormat: 'markdown' as const,...((organizationRequest.requestTypeId||Object.keys(organizationRequest.fieldValues||{}).length)?organizationRequest:{}) };
      const operations = getDraftOperations();
      const result = await post<{ ticket: Ticket }>('/api/tickets', { ...payload, operationId: operations.forPayload(createScope, payload) });
      createAttachments.complete(); clearNewTicketDraft(createScope); operations.clear(createScope);setOrganizationRequest({});
      setDraft({ subject: '', body: '', priority: 'normal', department: data.settings.departments[0] || '' });
      setCreating(false); setSection('tickets'); setSelectedId(result.ticket.id);
      setNotice(`Tu ticket ${number(result.ticket.id)} fue creado. Nuestro equipo podrá atenderlo aquí.`);
      try { await onRefresh(); }
      catch { setError('Tu ticket se guardó. Reintentaremos actualizar la vista automáticamente; no necesitas crearlo otra vez.'); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo crear el ticket.'); }
    finally { operation.current = false; setBusy(false); }
  };

  const sendReply = async (payload: ClientMessageSubmission): Promise<boolean> => {
    if (!current || !payload.body.trim() || operation.current) return false;
    operation.current = true; setBusy(true); setError('');
    try {
      await post(`/api/tickets/${current.id}/messages`, { ...payload, kind: 'reply' });
      setNotice('Tu respuesta se guardó y está disponible para nuestro equipo.');
      try { await onRefresh(); }
      catch { setError('Tu respuesta se guardó. Reintentaremos actualizar la conversación automáticamente; no necesitas reenviarla.'); }
      return true;
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo enviar la respuesta.'); return false; }
    finally { operation.current = false; setBusy(false); }
  };

  const newTicket = () => { if (!busy) { setCreating(true); setSelectedId(null); setError(''); } };
  const signOut = async () => {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError('');
    try { await disconnectPushOnSignOut(); await post('/api/auth/sign-out', {}); router.replace('/login'); router.refresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo cerrar sesión.'); operation.current = false; setBusy(false); }
  };

  return <div className="client-shell">
    <header className="client-header">
      <button className="client-brand" onClick={() => navigate('tickets')} aria-label="Daybook Ticket, mis tickets"><Brand dark /></button>
      <nav aria-label="Portal de clientes">
        <button className={section === 'tickets' ? 'is-active' : ''} onClick={() => navigate('tickets')} disabled={busy}><TicketIcon size={17} />{isCompanyManager ? 'Tickets de mi empresa' : 'Mis tickets'}</button>
        <button className={section === 'help' ? 'is-active' : ''} onClick={() => navigate('help')} disabled={busy}><BookOpen size={17} />Centro de ayuda</button>
      </nav>
      <div className="client-account"><span>{displayName}<small>{email}</small></span><button disabled={busy} onClick={signOut} aria-label="Cerrar sesión" title="Cerrar sesión"><LogOut size={18} /></button></div>
    </header>

    <main className="client-main">
      <div className="workspace-sync"><ThemeControl key={data.viewer!.id} memberId={data.viewer!.id} preferred={data.preferences?.theme||'system'}/><LiveStatus connection={connection} /><TicketAlerts alerts={alerts} onOpen={id => { window.open(`/?ticket=${id}`, '_blank', 'noopener,noreferrer'); }} /></div>
      {error && <div className="client-feedback error" role="alert"><CircleHelp size={18} /><p>{error}</p><button aria-label="Cerrar aviso" onClick={() => setError('')}><X size={17} /></button></div>}
      {notice && <div className="client-feedback success" role="status"><CheckCircle2 size={18} /><p>{notice}</p><button aria-label="Cerrar confirmación" onClick={() => setNotice('')}><X size={17} /></button></div>}

      {creating ? <>
        <button className="client-back" onClick={() => { setCreating(false); setError(''); }} disabled={busy}><ArrowLeft size={16} />Volver</button>
        <div className="client-heading"><div><span className="eyebrow">ESTAMOS PARA AYUDARTE</span><h1 ref={headingRef} tabIndex={-1}>Cuéntanos qué necesitas</h1><p>Tu solicitud tendrá un número de seguimiento y una conversación con nuestro equipo.</p></div><span className="client-heading-icon"><MessageSquare size={27} /></span></div>
        <form className="client-new-ticket" onSubmit={createTicket}>
          <div className="client-identity"><ShieldCheck size={19} /><p>Solicitud de <strong>{displayName}</strong><span>{email}</span></p></div>
          <fieldset disabled={busy}>
            <label>Asunto<input required maxLength={160} value={draft.subject} onChange={event => updateDraft({ ...draft, subject: event.target.value })} placeholder="Describe brevemente lo que necesitas" autoFocus /></label>
            <div className="client-fields"><label>Departamento<select value={draft.department} onChange={event => updateDraft({ ...draft, department: event.target.value })}>{data.settings.departments.map(department => <option key={department}>{department}</option>)}</select></label><label>Prioridad<select value={draft.priority} onChange={event => updateDraft({ ...draft, priority: event.target.value })}>{Object.entries(PRIORITY).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
            <div className="client-description"><label htmlFor="new-ticket-description">Descripción</label><MessageEditor id="new-ticket-description" label="Descripción" value={draft.body} onChange={value => updateDraft({ ...draft, body: value })} disabled={busy} rows={7} placeholder="Incluye qué sucede, desde cuándo y cómo podemos ayudarte."/></div>
          </fieldset>
          {data.evolution?.features.knowledge&&<KnowledgeSuggestions key={`${accessKey}:suggestions`} memberId={data.viewer!.id} query={draft.subject}/>}
          {data.evolution?.features.organization&&<RequestOrganizationFields key={accessKey} memberId={data.viewer!.id} companyId={data.viewer!.customerCompanyId} value={organizationRequest} onChange={changeOrganizationRequest} disabled={busy}/>}
          <AttachmentComposer controls={createAttachments} disabled={busy}/>
          <div className="client-form-footer"><span>Podrás consultar las respuestas en Mis tickets.</span><button className="primary" disabled={busy || !draft.subject.trim() || !draft.body.trim() || !createAttachments.canSubmit}>{busy ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}Crear ticket</button></div>
        </form>
      </> : selectedId && !current ? <div className="client-feedback" role={conversation.error ? 'alert' : 'status'}><p>{conversation.error || 'Cargando conversación…'}</p><button className="secondary" onClick={() => navigate('tickets')}>Mis tickets</button></div> : current ? <>
        <div className="client-detail-actions"><button className="client-back" onClick={() => navigate('tickets')} disabled={busy}><ArrowLeft size={16} />{isCompanyManager ? 'Tickets de mi empresa' : 'Mis tickets'}</button><button className="secondary" onClick={refresh} disabled={busy}><RefreshCw size={15} className={busy ? 'spin' : ''} />Actualizar</button></div>
        <div className="client-heading detail"><div><div className="client-ticket-meta"><span>{number(current.id)}</span><Badge status={current.status} /></div><h1 ref={headingRef} tabIndex={-1}>{current.subject}</h1><p>{current.department} · Creado el {date(current.createdAt)}{isCompanyManager && ` · Solicitado por ${current.requesterName}`}</p></div></div>
        <PublicTicketProgress key={`${data.viewer!.id}:${current.id}`} ticketId={current.id} memberId={data.viewer!.id} version={current.version}/>
        <div className="client-detail-grid"><section className="client-conversation ticket-chat-panel" aria-label="Conversación del ticket">
          <TicketChat key={`${accessKey}:${current.id}`} ticketId={current.id} collaboration={Boolean(data.evolution?.features.collaboration)} onReplyTo={message=>setReplyTarget({memberId:data.viewer!.id,ticketId:current.id,message})} messages={conversation.messages} viewerId={data.viewer!.id} staff={false} hasOlder={conversation.hasOlder} loadingOlder={conversation.loadingOlder} onLoadOlder={conversation.loadOlder} loading={conversation.loading} error={conversation.error} title="Tu conversación">
          {data.viewer && <ClientComposer key={ticketDraftKey({ memberId: data.viewer.id, role: 'client', ticketId: current.id })} memberId={data.viewer.id} ticketId={current.id} busy={busy} replyTarget={replyTarget?.memberId===data.viewer.id&&replyTarget.ticketId===current.id?replyTarget.message:null} onClearReply={()=>setReplyTarget(null)} onSend={sendReply}/>}
          </TicketChat>
        {data.evolution?.features.organization&&<TicketOrganizationPanel key={`${accessKey}:${current.id}`} ticketId={current.id} memberId={data.viewer!.id} staff={false} members={[]} refreshKey={current.version}/>}<TicketSatisfactionPanel key={`${data.viewer!.id}:${current.id}`} ticketId={current.id} memberId={data.viewer!.id} version={current.version} status={current.status}/></section><aside className="client-ticket-summary"><Headphones size={25} /><h2>Seguimos tu caso</h2><p>Consulta aquí el estado y las respuestas de nuestro equipo.</p><dl><div><dt>Estado</dt><dd><Badge status={current.status} /></dd></div><div><dt>Prioridad</dt><dd>{PRIORITY[current.priority]}</dd></div><div><dt>Última actividad</dt><dd>{date(current.updatedAt)}</dd></div></dl><div className="client-private-note"><ShieldCheck size={16} /><span>{isCompanyManager ? 'Visible para los contactos autorizados de tu empresa y el equipo de Daybook.' : 'Visible para ti, el equipo de Daybook y los contactos autorizados de tu empresa, si corresponde.'}</span></div></aside></div>
      </> : section === 'help' ? <>
        <div className="client-heading"><div><span className="eyebrow">RESPUESTAS A TU ALCANCE</span><h1 ref={headingRef} tabIndex={-1}>Centro de ayuda</h1><p>Guías aprobadas para tu empresa y acceso directo a nuestro equipo.</p></div></div>
        {data.evolution?.features.knowledge?<KnowledgePanel key={`${accessKey}:help`} memberId={data.viewer!.id}/>:<p className="info-note">Las guías están en pausa. Puedes crear una solicitud y continuar recibiendo atención.</p>}
        <div className="client-help-cta"><p>¿Necesitas más ayuda?</p><button className="primary" type="button" disabled={busy} onClick={newTicket}><Plus size={16}/>Crear ticket</button></div>
      </> : <>
        <div className="client-heading"><div><span className="eyebrow">TU ESPACIO DE SOPORTE</span><h1 ref={headingRef} tabIndex={-1}>Hola, {displayName.split(' ')[0]}.</h1><p>{isCompanyManager ? `Consulta y responde los tickets de ${companyName || 'tu empresa'}.` : 'Tus solicitudes y nuestras respuestas, siempre a mano.'}</p></div><button className="primary" onClick={newTicket} disabled={busy}><Plus size={17} />Nuevo ticket</button></div>
        <div className="client-overview"><div><span className="client-overview-icon"><MessageSquare size={21} /></span><span><strong>{openCount}</strong><small>Solicitudes en curso</small></span></div><div><span className="client-overview-icon resolved"><CheckCircle2 size={21} /></span><span><strong>{counts.resolved}</strong><small>Solicitudes resueltas</small></span></div><div className="client-overview-help"><ShieldCheck size={22} /><p>{isCompanyManager ? 'Un espacio para tu empresa.' : 'Un espacio personal.'}<span>{isCompanyManager ? 'Aquí ves tus tickets y los vinculados a tu empresa.' : 'Aquí ves únicamente tus tickets.'}</span></p></div></div>
        {data.evolution?.features.organization&&<SavedViewPicker key={accessKey} memberId={data.viewer!.id} filters={{q:search,queue:filter as TicketFilters['queue'],priority:'all',department:'all',company:'all',agent:'all'}} onApply={value=>{setSearch(value.q||'');setFilter(value.queue||'all');}}/>}<section className="client-ticket-list" aria-label={isCompanyManager ? 'Tickets de mi empresa' : 'Mis tickets'}><div className="client-list-toolbar"><h2>{isCompanyManager ? 'Tickets de mi empresa' : 'Mis tickets'} <span>{counts.all}</span></h2><button className="secondary" disabled={busy} onClick={refresh}><RefreshCw size={15} className={busy ? 'spin' : ''} />Actualizar</button></div><div className="client-list-filters"><label className="search-box"><Search size={17} /><input aria-label={isCompanyManager ? 'Buscar tickets de mi empresa' : 'Buscar mis tickets'} placeholder="Busca en tickets y conversaciones…" value={search} onChange={event => setSearch(event.target.value)} /></label><select aria-label="Filtrar tickets por estado" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Todos los estados</option>{Object.entries(STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
          {searchResults.error ? <p className="ticket-search-feedback" role="alert">{searchResults.error}</p> : searchResults.loading && visibleTickets.length === 0 ? <p className="ticket-search-feedback" role="status">Buscando tickets y conversaciones…</p> : visibleTickets.length === 0 ? <div className="client-empty"><TicketIcon size={34} /><h2>{counts.all ? 'No hay tickets con esos filtros' : 'Tu primera conversación empieza aquí'}</h2><p>{counts.all ? 'Prueba otra búsqueda o elige un estado diferente.' : 'Crea una solicitud para recibir ayuda de nuestro equipo.'}</p>{counts.all === 0 && <button className="primary" disabled={busy} onClick={newTicket}><Plus size={16} />Crear mi primer ticket</button>}</div> : <div>{visibleTickets.map(ticket => <button className="client-ticket-row" key={ticket.id} onClick={() => openTicket(ticket)} disabled={busy}><span className="client-row-icon"><TicketIcon size={20} /></span><span className="client-row-main"><span className="client-ticket-number">{number(ticket.id)}</span><strong>{ticket.subject}</strong><small>{isCompanyManager && `${ticket.requesterName} · `}{ticket.department} · <Clock3 size={12} />{date(ticket.updatedAt)}</small></span><Badge status={ticket.status} /><ChevronRight size={18} /></button>)}</div>}
          <TicketPagination index={searchResults.index} shown={visibleTickets.length} total={searchResults.total} nextCursor={searchResults.nextCursor} previous={searchResults.previous} next={searchResults.next} loading={searchResults.loading}/>
        </section>
        <EmailInboundPanel key={`inbound:${data.viewer!.id}`} memberId={data.viewer!.id}/><button className="client-resource-link" onClick={() => navigate('help')}><BookOpen size={19} /><span>Encuentra respuestas en nuestro centro de ayuda.</span><ArrowRight size={17} /></button>
      </>}
      <footer className="client-footer"><span>{data.settings.brandName} · Servicios Daybook</span><span>Un soporte más cercano.</span></footer>
    </main>
  </div>;
}


type ClientMessageSubmission = { replyToMessageId?:number|null; body: string; bodyFormat?: 'plain' | 'markdown'; draftId: string; attachmentIds: string[]; operationId: string };
function ClientComposer({ memberId, ticketId, busy, onSend, replyTarget, onClearReply }: {
  memberId: string;
  ticketId: number;
  busy: boolean;
  replyTarget:Message|null;onClearReply:()=>void;
  onSend: (payload: ClientMessageSubmission) => Promise<boolean>;
}) {
  const { message, persistent, edit, complete, setReferences } = useTicketDraft({ memberId, role: 'client', ticketId });
  const scope = `${ticketDraftKey({ memberId, role: 'client', ticketId })}.reply`;
  const attachments = useDraftAttachments(scope, 'reply', ticketId);
  const resolvedQuote=useDraftQuote({memberId,role:'client',ticketId},'reply',message.replyToMessageId),quote=resolvedQuote.quote;
  useEffect(()=>{if(!replyTarget)return;if(replyTarget.kind!=='note'&&replyTarget.ticketId===ticketId)setReferences('reply',{replyToMessageId:replyTarget.id});onClearReply();},[replyTarget,ticketId,setReferences,onClearReply]);
  return <form className="client-composer ticket-chat-composer reply" onSubmit={async event => {
    event.preventDefault();
    if (busy || !message.body.trim() || !attachments.canSubmit || resolvedQuote.loading || resolvedQuote.error) return;
    const payload = { body: message.body, ...attachments.payload(), bodyFormat: 'markdown' as const,...('replyToMessageId' in message?{replyToMessageId:message.replyToMessageId}:{}) };
    const operations = getDraftOperations();
    if (await onSend({ ...payload, operationId: operations.forPayload(scope, payload) })) { complete(message); attachments.complete(); operations.clear(scope); }
  }}>
    {!persistent && <p className="draft-notice" role="status">Tu navegador no permite guardar este borrador al recargar. Conservaremos el texto mientras esta página siga abierta.</p>}
    {message.replyToMessageId&&<div className="ticket-reply-banner"><span><strong>{quote?`Respondiendo a ${quote.author}`:resolvedQuote.loading?'Comprobando cita…':'Cita pendiente de comprobar'}</strong>{quote&&<small>{quote.body.slice(0,180)}</small>}{resolvedQuote.error&&<><small role="alert">{resolvedQuote.error}</small><button type="button" className="text-button" onClick={resolvedQuote.retry}>Reintentar cita</button></>}</span><button type="button" className="icon-button" aria-label="Quitar cita" onClick={()=>setReferences('reply',{})}><X size={16}/></button></div>}
    <MessageEditor compact id="client-reply" label="Añadir una respuesta" value={message.body} onChange={edit} disabled={busy} rows={5} placeholder="Escribe tu respuesta o añade información…"/>
    <AttachmentComposer controls={attachments} disabled={busy}/>
    <div className="composer-footer"><span>Compartida con quienes tienen acceso a este ticket.</span><button className="primary" disabled={busy || !message.body.trim() || !attachments.canSubmit || resolvedQuote.loading || Boolean(resolvedQuote.error)}>{busy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}Enviar respuesta</button></div>
  </form>;
}
