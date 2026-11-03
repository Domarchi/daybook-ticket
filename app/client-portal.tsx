'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, ChevronRight, CircleHelp, Clock3, Headphones, LoaderCircle, LogOut, MessageSquare, Plus, RefreshCw, Search, Send, ShieldCheck, Ticket as TicketIcon, X } from 'lucide-react';
import type { Article, Ticket, TicketPriority, TicketStatus, Workspace } from '../lib/types';
import Brand from './brand';
import { LiveStatus } from './live-status';
import type { ConnectionStatus } from '@/hooks/use-workspace';
import type { AlertControls } from '@/hooks/use-ticket-alerts';
import { TicketAlerts } from './ticket-alerts';
import { disconnectPushOnSignOut } from '@/lib/push-client';
import './client-portal.css';

const STATUS: Record<TicketStatus, string> = { open: 'Abierto', pending: 'En espera', resolved: 'Resuelto' };
const PRIORITY: Record<TicketPriority, string> = { low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };
const date = (value: string) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const number = (id: number) => `#${String(id).padStart(4, '0')}`;

async function post<T = unknown>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
  const [section, setSection] = useState<'tickets' | 'help'>('tickets');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [article, setArticle] = useState<Article | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState({ subject: '', body: '', priority: 'normal', department: data.settings.departments[0] || '' });
  const operation = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const current = data.tickets.find(ticket => ticket.id === selectedId);
  const published = data.articles.filter(item => item.published);
  const visibleTickets = data.tickets.filter(ticket => (filter === 'all' || ticket.status === filter) && `${ticket.id} ${ticket.subject}`.toLowerCase().includes(search.toLowerCase()));
  const visibleArticles = published.filter(item => `${item.title} ${item.body} ${item.category}`.toLowerCase().includes(search.toLowerCase()));
  const openCount = data.tickets.filter(ticket => ticket.status !== 'resolved').length;

  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get('ticket'));
    if (Number.isSafeInteger(id) && id > 0) setSelectedId(id);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 7000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => { headingRef.current?.focus(); }, [selectedId, creating, article, section]);

  const navigate = (next: 'tickets' | 'help') => {
    if (busy) return;
    setSection(next); setSelectedId(null); setCreating(false); setArticle(null); setSearch(''); setError('');
  };

  const openTicket = (ticket: Ticket) => {
    if (busy) return;
    setSelectedId(ticket.id); setCreating(false); setReply(''); setError('');
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
    if (operation.current) return;
    operation.current = true; setBusy(true); setError('');
    try {
      const result = await post<{ ticket: Ticket }>('/api/tickets', draft);
      setDraft({ subject: '', body: '', priority: 'normal', department: data.settings.departments[0] || '' });
      setCreating(false); setSection('tickets'); setSelectedId(result.ticket.id);
      setNotice(`Tu ticket ${number(result.ticket.id)} fue creado. Nuestro equipo podrá atenderlo aquí.`);
      try { await onRefresh(); }
      catch { setError('Tu ticket se guardó. Reintentaremos actualizar la vista automáticamente; no necesitas crearlo otra vez.'); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo crear el ticket.'); }
    finally { operation.current = false; setBusy(false); }
  };

  const sendReply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!current || !reply.trim() || operation.current) return;
    operation.current = true; setBusy(true); setError('');
    try {
      await post(`/api/tickets/${current.id}/messages`, { body: reply, kind: 'reply' });
      setReply(''); setNotice('Tu respuesta se guardó y está disponible para nuestro equipo.');
      try { await onRefresh(); }
      catch { setError('Tu respuesta se guardó. Reintentaremos actualizar la conversación automáticamente; no necesitas reenviarla.'); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo enviar la respuesta.'); }
    finally { operation.current = false; setBusy(false); }
  };

  const newTicket = () => { if (!busy) { setCreating(true); setSelectedId(null); setArticle(null); setError(''); } };
  const signOut = async () => {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError('');
    try { await disconnectPushOnSignOut(); await post('/api/auth/sign-out', {}); window.location.href = '/login'; }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo cerrar sesión.'); operation.current = false; setBusy(false); }
  };

  return <div className="client-shell">
    <header className="client-header">
      <button className="client-brand" onClick={() => navigate('tickets')} aria-label="Daybook Ticket, mis tickets"><Brand dark /></button>
      <nav aria-label="Portal de clientes">
        <button className={section === 'tickets' ? 'is-active' : ''} onClick={() => navigate('tickets')} disabled={busy}><TicketIcon size={17} />Mis tickets</button>
        <button className={section === 'help' ? 'is-active' : ''} onClick={() => navigate('help')} disabled={busy}><BookOpen size={17} />Centro de ayuda</button>
      </nav>
      <div className="client-account"><span>{displayName}<small>{email}</small></span><button disabled={busy} onClick={signOut} aria-label="Cerrar sesión" title="Cerrar sesión"><LogOut size={18} /></button></div>
    </header>

    <main className="client-main">
      <div className="workspace-sync"><LiveStatus connection={connection} /><TicketAlerts alerts={alerts} onOpen={id => { window.open(`/?ticket=${id}`, '_blank', 'noopener,noreferrer'); }} /></div>
      {error && <div className="client-feedback error" role="alert"><CircleHelp size={18} /><p>{error}</p><button aria-label="Cerrar aviso" onClick={() => setError('')}><X size={17} /></button></div>}
      {notice && <div className="client-feedback success" role="status"><CheckCircle2 size={18} /><p>{notice}</p><button aria-label="Cerrar confirmación" onClick={() => setNotice('')}><X size={17} /></button></div>}

      {creating ? <>
        <button className="client-back" onClick={() => { setCreating(false); setError(''); }} disabled={busy}><ArrowLeft size={16} />Volver</button>
        <div className="client-heading"><div><span className="eyebrow">ESTAMOS PARA AYUDARTE</span><h1 ref={headingRef} tabIndex={-1}>Cuéntanos qué necesitas</h1><p>Tu solicitud tendrá un número de seguimiento y una conversación con nuestro equipo.</p></div><span className="client-heading-icon"><MessageSquare size={27} /></span></div>
        <form className="client-new-ticket" onSubmit={createTicket}>
          <div className="client-identity"><ShieldCheck size={19} /><p>Solicitud de <strong>{displayName}</strong><span>{email}</span></p></div>
          <fieldset disabled={busy}>
            <label>Asunto<input required maxLength={160} value={draft.subject} onChange={event => setDraft({ ...draft, subject: event.target.value })} placeholder="Describe brevemente lo que necesitas" autoFocus /></label>
            <div className="client-fields"><label>Departamento<select value={draft.department} onChange={event => setDraft({ ...draft, department: event.target.value })}>{data.settings.departments.map(department => <option key={department}>{department}</option>)}</select></label><label>Prioridad<select value={draft.priority} onChange={event => setDraft({ ...draft, priority: event.target.value })}>{Object.entries(PRIORITY).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
            <label>Descripción<textarea required maxLength={20000} rows={7} value={draft.body} onChange={event => setDraft({ ...draft, body: event.target.value })} placeholder="Incluye qué sucede, desde cuándo y cómo podemos ayudarte." /></label>
          </fieldset>
          <div className="client-form-footer"><span>Podrás consultar las respuestas en Mis tickets.</span><button className="primary" disabled={busy || !draft.subject.trim() || !draft.body.trim()}>{busy ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}Crear ticket</button></div>
        </form>
      </> : current ? <>
        <div className="client-detail-actions"><button className="client-back" onClick={() => navigate('tickets')} disabled={busy}><ArrowLeft size={16} />Mis tickets</button><button className="secondary" onClick={refresh} disabled={busy}><RefreshCw size={15} className={busy ? 'spin' : ''} />Actualizar</button></div>
        <div className="client-heading detail"><div><div className="client-ticket-meta"><span>{number(current.id)}</span><Badge status={current.status} /></div><h1 ref={headingRef} tabIndex={-1}>{current.subject}</h1><p>{current.department} · Creado el {date(current.createdAt)}</p></div></div>
        <div className="client-detail-grid"><section className="client-conversation" aria-label="Conversación del ticket">
          <div className="client-section-heading"><MessageSquare size={18} /><h2>Tu conversación</h2></div>
          <div className="client-messages">{data.messages.filter(message => message.ticketId === current.id && message.kind !== 'note').map(message => <article className="client-message" key={message.id}><div className="client-message-avatar">{message.author.trim().slice(0, 1).toUpperCase() || 'D'}</div><div><header><strong>{message.author}</strong><time dateTime={message.createdAt}>{date(message.createdAt)}</time></header><p>{message.body}</p></div></article>)}</div>
          <form className="client-composer" onSubmit={sendReply}><label htmlFor="client-reply">Añadir una respuesta</label><textarea id="client-reply" value={reply} onChange={event => setReply(event.target.value)} disabled={busy} required maxLength={20000} rows={5} placeholder="Escribe tu respuesta o añade información…" /><div><span>Compartida con el equipo de Daybook.</span><button className="primary" disabled={busy || !reply.trim()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}Enviar respuesta</button></div></form>
        </section><aside className="client-ticket-summary"><Headphones size={25} /><h2>Seguimos tu caso</h2><p>Consulta aquí el estado y las respuestas de nuestro equipo.</p><dl><div><dt>Estado</dt><dd><Badge status={current.status} /></dd></div><div><dt>Prioridad</dt><dd>{PRIORITY[current.priority]}</dd></div><div><dt>Última actividad</dt><dd>{date(current.updatedAt)}</dd></div></dl><div className="client-private-note"><ShieldCheck size={16} /><span>Solo tú y el equipo autorizado pueden acceder a esta conversación.</span></div></aside></div>
      </> : section === 'help' ? <>
        {article ? <>
          <button className="client-back" disabled={busy} onClick={() => setArticle(null)}><ArrowLeft size={16} />Centro de ayuda</button>
          <article className="client-reading"><span className="tag">{article.category}</span><h1 ref={headingRef} tabIndex={-1}>{article.title}</h1><div>{article.body}</div><small>Actualizado el {date(article.updatedAt)}</small></article>
        </> : <>
          <div className="client-heading"><div><span className="eyebrow">RESPUESTAS A TU ALCANCE</span><h1 ref={headingRef} tabIndex={-1}>¿Cómo podemos ayudarte?</h1><p>Consulta nuestras guías o abre un ticket para recibir ayuda.</p></div><span className="client-heading-icon"><BookOpen size={27} /></span></div>
          <label className="search-box client-search"><Search size={18} /><input aria-label="Buscar una guía" value={search} onChange={event => setSearch(event.target.value)} placeholder="Busca una respuesta…" /></label>
          <div className="client-article-grid">{visibleArticles.map(item => <button className="client-article" key={item.id} onClick={() => setArticle(item)}><BookOpen size={24} /><small>{item.category}</small><h2>{item.title}</h2><p>{item.body.slice(0, 150)}{item.body.length > 150 ? '…' : ''}</p><span>Leer guía <ArrowRight size={15} /></span></button>)}</div>
          {visibleArticles.length === 0 && <div className="client-empty"><BookOpen size={30} /><h2>{search ? 'No encontramos esa guía' : 'Las guías están en camino'}</h2><p>Puedes crear un ticket y nuestro equipo te ayudará.</p></div>}
          <div className="client-help-cta"><div><h2>Estamos al otro lado.</h2><p>Cuéntanos qué necesitas y seguimos la conversación.</p></div><button className="primary" onClick={newTicket}><Plus size={17} />Crear ticket</button></div>
        </>}
      </> : <>
        <div className="client-heading"><div><span className="eyebrow">TU ESPACIO DE SOPORTE</span><h1 ref={headingRef} tabIndex={-1}>Hola, {displayName.split(' ')[0]}.</h1><p>Tus solicitudes y nuestras respuestas, siempre a mano.</p></div><button className="primary" onClick={newTicket} disabled={busy}><Plus size={17} />Nuevo ticket</button></div>
        <div className="client-overview"><div><span className="client-overview-icon"><MessageSquare size={21} /></span><span><strong>{openCount}</strong><small>Solicitudes en curso</small></span></div><div><span className="client-overview-icon resolved"><CheckCircle2 size={21} /></span><span><strong>{data.tickets.length - openCount}</strong><small>Solicitudes resueltas</small></span></div><div className="client-overview-help"><ShieldCheck size={22} /><p>Un espacio personal.<span>Aquí ves únicamente tus tickets.</span></p></div></div>
        <section className="client-ticket-list" aria-label="Mis tickets"><div className="client-list-toolbar"><h2>Mis tickets <span>{data.tickets.length}</span></h2><button className="secondary" disabled={busy} onClick={refresh}><RefreshCw size={15} className={busy ? 'spin' : ''} />Actualizar</button></div><div className="client-list-filters"><label className="search-box"><Search size={17} /><input aria-label="Buscar mis tickets" placeholder="Busca por asunto o número…" value={search} onChange={event => setSearch(event.target.value)} /></label><select aria-label="Filtrar tickets por estado" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Todos los estados</option>{Object.entries(STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
          {visibleTickets.length === 0 ? <div className="client-empty"><TicketIcon size={34} /><h2>{data.tickets.length ? 'No hay tickets con esos filtros' : 'Tu primera conversación empieza aquí'}</h2><p>{data.tickets.length ? 'Prueba otra búsqueda o elige un estado diferente.' : 'Crea una solicitud para recibir ayuda de nuestro equipo.'}</p>{data.tickets.length === 0 && <button className="primary" disabled={busy} onClick={newTicket}><Plus size={16} />Crear mi primer ticket</button>}</div> : <div>{visibleTickets.map(ticket => <button className="client-ticket-row" key={ticket.id} onClick={() => openTicket(ticket)} disabled={busy}><span className="client-row-icon"><TicketIcon size={20} /></span><span className="client-row-main"><span className="client-ticket-number">{number(ticket.id)}</span><strong>{ticket.subject}</strong><small>{ticket.department} · <Clock3 size={12} />{date(ticket.updatedAt)}</small></span><Badge status={ticket.status} /><ChevronRight size={18} /></button>)}</div>}
        </section>
        <button className="client-resource-link" onClick={() => navigate('help')}><BookOpen size={19} /><span>Encuentra respuestas en nuestro centro de ayuda.</span><ArrowRight size={17} /></button>
      </>}
      <footer className="client-footer"><span>{data.settings.brandName} · Servicios Daybook</span><span>Un soporte más cercano.</span></footer>
    </main>
  </div>;
}
