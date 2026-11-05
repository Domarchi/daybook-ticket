'use client';
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, LoaderCircle, RefreshCw, Users } from 'lucide-react';
import { readTicketResource } from '@/hooks/use-ticket-search';
import type { ContactPage } from '@/lib/ticket-search';
import './ticket-search.css';

export function TicketPagination({ index, shown, total, nextCursor, previous, next, loading }: { index: number; shown: number; total: number; nextCursor: string | null; previous: () => void; next: () => void; loading: boolean }) {
  return <div className="ticket-pagination"><span>{loading ? 'Actualizando…' : `${total} ${total === 1 ? 'resultado' : 'resultados'} · ${shown} en esta página`}</span><nav aria-label="Páginas de tickets"><button className="secondary" type="button" disabled={index === 0 || loading} onClick={previous}><ArrowLeft size={15}/>Anterior</button><span>Página {index + 1}</span><button className="secondary" type="button" disabled={!nextCursor || loading} onClick={next}>Siguiente<ArrowRight size={15}/></button></nav></div>;
}

export function ConversationPagination({ loading, onLoad }: { loading: boolean; onLoad: () => void }) {
  return <div className="conversation-pagination"><button type="button" className="secondary" disabled={loading} onClick={onLoad}>{loading ? <LoaderCircle size={15} className="spin"/> : <RefreshCw size={15}/>}Cargar mensajes anteriores</button></div>;
}

export function ContactDirectory({ memberId, refreshKey, onSearch }: { memberId: string; refreshKey?: string; onSearch: (email: string) => void }) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]), [index, setIndex] = useState(0);
  const [state, setState] = useState<{ key: string; page: ContactPage | null; error: string; loading: boolean }>({ key: '', page: null, error: '', loading: true });
  const cursor = cursors[index], key = `${memberId}:${cursor ?? ''}`;
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState(previous => ({ key, page: previous.key === key ? previous.page : null, error: '', loading: true }));
      try {
        const page = await readTicketResource<ContactPage>(`/api/tickets/contacts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, memberId, controller.signal);
        if (!controller.signal.aborted) setState({ key, page, error: '', loading: false });
      } catch (failure) {
        if (!controller.signal.aborted) setState({ key, page: null, error: failure instanceof Error ? failure.message : 'No se pudo cargar el directorio.', loading: false });
      }
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, cursor, memberId, refreshKey]);
  const page = state.key === key ? state.page : null, loading = state.key !== key || state.loading;
  return <div className="panel"><div className="section-head"><h2><Users size={18}/>Directorio de contactos</h2><span>{page?.total ?? 0} contactos</span></div>{state.error && <p role="alert" className="ticket-search-feedback">{state.error}</p>}{loading && !page ? <p role="status" className="ticket-search-feedback">Cargando contactos…</p> : page && page.total === 0 ? <p className="ticket-search-feedback">Los solicitantes de tus tickets aparecerán aquí.</p> : <div className="contact-grid">{page?.items.map(contact => <article className="contact-card" key={contact.email}><h3>{contact.name}</h3><a href={`mailto:${contact.email}`}>{contact.email}</a><div><span>{contact.total} tickets</span><span>{contact.active} activos</span></div><button type="button" className="text-button" onClick={() => onSearch(contact.email)}>Ver conversaciones<ArrowRight size={15}/></button></article>)}</div>}<TicketPagination index={index} shown={page?.items.length ?? 0} total={page?.total ?? 0} nextCursor={page?.nextCursor ?? null} loading={loading} previous={() => setIndex(value => Math.max(0, value - 1))} next={() => { if (page?.nextCursor) { setCursors(previous => [...previous.slice(0, index + 1), page.nextCursor]); setIndex(value => value + 1); } }}/></div>;
}
