'use client';

import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ChevronDown, ChevronUp, LoaderCircle, LockKeyhole, MessageSquare, Search, X } from 'lucide-react';
import type { Message } from '@/lib/types';
import { appendedChatMessages, chatAuthorRole, chatTimeLabel, findChatMatches, groupChatMessages, visibleChatMessages } from '@/lib/ticket-chat';
import { MessageContent } from './message-content';
import { MessageAttachments } from './attachments';

export interface TicketChatProps {
  messages: Message[];
  viewerId: string;
  staff: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  loading?: boolean;
  error?: string;
  title?: string;
  children?: ReactNode;
}

/** Mount this component with an account/ticket key, never a ticket-version key. */
export function TicketChat({ messages, viewerId, staff, hasOlder, loadingOlder, onLoadOlder, loading = false, error, title = 'Conversación', children }: TicketChatProps) {
  const searchId = useId(), headingId = useId();
  const viewport = useRef<HTMLDivElement>(null), searchInput = useRef<HTMLInputElement>(null), searchToggle = useRef<HTMLButtonElement>(null);
  const rows = useRef(new Map<number, HTMLElement>());
  const previousMessages = useRef<Message[] | null>(null), atBottom = useRef(true);
  const olderPosition = useRef<{ height: number; top: number; anchorId: number | null; anchorOffset: number } | null>(null);
  const incomingCount = useRef(0);
  const [scrollState, setScrollState] = useState({ atBottom: true, newCount: 0 });
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState({ query: '', index: 0 });
  const visible = useMemo(() => visibleChatMessages(messages, staff), [messages, staff]);
  const groups = useMemo(() => groupChatMessages(visible), [visible]);
  const matches = useMemo(() => findChatMatches(visible, search.query, staff), [visible, search.query, staff]);
  const matchIndex = Math.min(search.index, Math.max(0, matches.length - 1));
  const activeMatch = searchOpen ? matches[matchIndex] : undefined;
  const matchIds = useMemo(() => new Set(searchOpen ? matches : []), [matches, searchOpen]);

  const syncScroll = () => {
    const element = viewport.current;
    if (!element) return;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 72;
    atBottom.current = nearBottom;
    if (nearBottom) incomingCount.current = 0;
    setScrollState(previous => previous.atBottom === nearBottom && previous.newCount === incomingCount.current
      ? previous : { atBottom: nearBottom, newCount: incomingCount.current });
  };

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const previous = previousMessages.current;
    previousMessages.current = visible;
    const appended = previous ? appendedChatMessages(previous, visible) : [];
    const restore = olderPosition.current;
    const prepended = restore && previous?.length && visible[0]?.id !== previous[0]?.id && visible.some(message => message.id === previous[0].id);
    if (prepended) {
      const anchor = restore.anchorId === null ? null : rows.current.get(restore.anchorId);
      // An actual visible row also handles a simultaneous append at the tail;
      // total-height differences alone would incorrectly move the reader.
      element.scrollTop = anchor ? element.scrollTop + anchor.getBoundingClientRect().top - element.getBoundingClientRect().top - restore.anchorOffset
        : restore.top + element.scrollHeight - restore.height;
      olderPosition.current = null;
    } else if (!previous || appended.length && (atBottom.current || appended.some(message => message.authorMemberId === viewerId))) {
      element.scrollTop = element.scrollHeight;
      atBottom.current = true;
      incomingCount.current = 0;
    }
    if (appended.length && !atBottom.current) incomingCount.current += appended.filter(message => message.authorMemberId !== viewerId).length;
    if (!loadingOlder) olderPosition.current = null;
    // Defer React state to the browser frame; the scroll correction itself runs
    // before paint so prepending history does not move the reader's paragraph.
    const frame = requestAnimationFrame(() => {
      const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 72;
      atBottom.current = nearBottom;
      if (nearBottom) incomingCount.current = 0;
      setScrollState(previousState => previousState.atBottom === nearBottom && previousState.newCount === incomingCount.current
        ? previousState : { atBottom: nearBottom, newCount: incomingCount.current });
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, loadingOlder, viewerId]);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      // Keep the tail visible when a short reply editor grows or the viewport
      // resizes, while leaving readers of older messages at their position.
      if (atBottom.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const goToMessage = (id: number | undefined) => {
    const element = viewport.current, message = id === undefined ? null : rows.current.get(id);
    if (!element || !message) return;
    const top = element.scrollTop + message.getBoundingClientRect().top - element.getBoundingClientRect().top - Math.max(0, (element.clientHeight - message.offsetHeight) / 2);
    element.scrollTo({ top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };

  const moveMatch = (direction: number) => {
    if (!matches.length) return;
    const index = (matchIndex + direction + matches.length) % matches.length;
    setSearch(previous => ({ ...previous, index }));
    goToMessage(matches[index]);
  };

  const goToLatest = () => {
    const element = viewport.current;
    if (!element) return;
    incomingCount.current = 0;
    element.scrollTo({ top: element.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    setScrollState(previous => ({ ...previous, newCount: 0 }));
  };

  return <section className={`ticket-chat ${staff ? 'is-staff' : 'is-client'}`} aria-labelledby={headingId}>
    <header className="ticket-chat-header">
      <div className="ticket-chat-heading"><span className="ticket-chat-avatar" aria-hidden="true"><MessageSquare size={21}/></span><div><h2 id={headingId}>{title}</h2><p>{visible.length} {visible.length === 1 ? 'mensaje cargado' : 'mensajes cargados'} · Hora de Santiago</p></div></div>
      <div className="ticket-chat-tools"><button ref={searchToggle} className="ticket-chat-icon-button" type="button" aria-label={searchOpen ? 'Cerrar búsqueda en la conversación' : 'Buscar en la conversación'} title="Buscar en la conversación" aria-expanded={searchOpen} aria-controls={searchId} onClick={() => {
        if (searchOpen) { setSearchOpen(false); setSearch({ query: '', index: 0 }); }
        else { setSearchOpen(true); requestAnimationFrame(() => searchInput.current?.focus()); }
      }}>{searchOpen ? <X size={19}/> : <Search size={19}/>}</button></div>
    </header>
    {searchOpen && <div id={searchId} className="ticket-chat-search-panel">
      <div className="ticket-chat-search"><Search size={17} aria-hidden="true"/><input ref={searchInput} aria-label="Buscar en mensajes cargados" placeholder="Buscar en esta conversación…" maxLength={160} value={search.query} onChange={event => {
        const query = event.target.value;
        setSearch({ query, index: 0 });
        const id = findChatMatches(visible, query, staff)[0];
        requestAnimationFrame(() => goToMessage(id));
      }} onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); setSearchOpen(false); setSearch({ query: '', index: 0 }); searchToggle.current?.focus(); }
        else if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); moveMatch(event.shiftKey ? -1 : 1); }
      }}/><span className="ticket-chat-search-count" role="status">{search.query.trim() ? matches.length ? `${matchIndex + 1} de ${matches.length}` : 'Sin resultados' : ''}</span>
        <button type="button" className="ticket-chat-icon-button" aria-label="Coincidencia anterior" disabled={!matches.length} onClick={() => moveMatch(-1)}><ChevronUp size={18}/></button><button type="button" className="ticket-chat-icon-button" aria-label="Coincidencia siguiente" disabled={!matches.length} onClick={() => moveMatch(1)}><ChevronDown size={18}/></button>
      </div><p className="ticket-chat-search-help">Busca texto, autores y nombres de archivos en los mensajes cargados.{hasOlder ? ' Carga mensajes anteriores para ampliar la búsqueda.' : ''}</p>
    </div>}
    <div className="ticket-chat-scroll-area">
      <div className="ticket-chat-viewport" ref={viewport} tabIndex={0} aria-label="Mensajes de la conversación" onScroll={syncScroll}>
        {hasOlder && <div className="ticket-chat-history"><button type="button" className="secondary" disabled={loadingOlder} onClick={() => {
          const element = viewport.current;
          if (element) {
            const bounds = element.getBoundingClientRect();
            const anchor = visible.map(message => ({ id: message.id, node: rows.current.get(message.id) })).find(item => {
              const rectangle = item.node?.getBoundingClientRect();
              return rectangle && rectangle.bottom > bounds.top && rectangle.top < bounds.bottom;
            });
            olderPosition.current = { height: element.scrollHeight, top: element.scrollTop, anchorId: anchor?.id ?? null,
              anchorOffset: anchor?.node ? anchor.node.getBoundingClientRect().top - bounds.top : 0 };
          }
          onLoadOlder();
        }}>{loadingOlder ? <LoaderCircle size={15} className="spin"/> : <ChevronUp size={15}/>} {loadingOlder ? 'Cargando mensajes…' : 'Cargar mensajes anteriores'}</button></div>}
        <p className="sr-only" role="status">{loading ? 'Actualizando conversación…' : ''}</p>
        {error && <p className="ticket-chat-feedback" role="alert">{error}</p>}
        {!visible.length && !loading && <div className="ticket-chat-empty"><MessageSquare size={28} aria-hidden="true"/><p>Esta conversación aún no tiene mensajes.</p></div>}
        {groups.map(group => <div className="ticket-chat-day" key={group.key}><div className="ticket-chat-date"><span>{group.label}</span></div>{group.messages.map(message => <article key={message.id} ref={node => { if (node) rows.current.set(message.id, node); else rows.current.delete(message.id); }} data-message-id={message.id} className={`ticket-chat-message${message.authorMemberId === viewerId ? ' is-own' : ''}${message.kind === 'note' ? ' is-note' : ''}${matchIds.has(message.id) ? ' is-match' : ''}${activeMatch === message.id ? ' is-selected' : ''}`} aria-label={`${message.kind === 'note' ? 'Nota interna de ' : 'Mensaje de '}${message.author}`}>
          <div className="ticket-chat-bubble"><header className="ticket-chat-message-heading"><strong>{message.authorMemberId === viewerId ? 'Tú' : message.author}</strong><span>{message.kind === 'note' && <LockKeyhole size={11} aria-hidden="true"/>}{chatAuthorRole(message)}</span></header><div className="ticket-chat-message-content"><MessageContent body={message.body} format={message.bodyFormat}/><MessageAttachments attachments={message.attachments}/></div><footer className="ticket-chat-message-meta"><time dateTime={message.createdAt}>{chatTimeLabel(message.createdAt)}</time>{message.kind === 'note' && <span>Solo el equipo</span>}</footer></div>
        </article>)}</div>)}
      </div>
      {(!scrollState.atBottom || scrollState.newCount > 0) && <button type="button" className="ticket-chat-jump" onClick={goToLatest}><ArrowDown size={16}/>{scrollState.newCount > 0 ? `${scrollState.newCount} ${scrollState.newCount === 1 ? 'mensaje nuevo' : 'mensajes nuevos'}` : 'Ir a los últimos mensajes'}</button>}
      <span className="sr-only" role="status">{scrollState.newCount > 0 ? `${scrollState.newCount} ${scrollState.newCount === 1 ? 'mensaje nuevo en esta conversación' : 'mensajes nuevos en esta conversación'}` : ''}</span>
    </div>
    {children && <div className="ticket-chat-compose">{children}</div>}
  </section>;
}
