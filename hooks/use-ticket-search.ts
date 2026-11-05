'use client';
import { workspaceFetch } from '@/lib/workspace-client';

import { useEffect, useRef, useState } from 'react';
import type { TicketPage } from '@/lib/ticket-search';
import type { TicketSearchQuery } from '@/lib/ticket-search-query';

export type TicketFilters = Pick<TicketSearchQuery, 'q' | 'queue' | 'priority' | 'department' | 'company' | 'agent'>;
const EMPTY: TicketPage = { items: [], total: 0, nextCursor: null };
export function ticketSearchParams(filters: TicketFilters, cursor: string | null = null, limit = 50): URLSearchParams {
  const params = new URLSearchParams({ ...filters, limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return params;
}
export async function readTicketResource<T>(path: string, memberId: string, signal?: AbortSignal): Promise<T> {
  const response = await workspaceFetch(path, { headers: { 'X-Daybook-Member-Id': memberId }, signal, cache: 'no-store' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'No se pudo cargar esta página.');
  return result as T;
}

export function useTicketSearch(memberId: string | undefined, filters: TicketFilters, refreshKey: string | undefined, enabled = true) {
  const params = ticketSearchParams(filters).toString(), baseKey = `${memberId ?? ''}:${params}`;
  const [pagination, setPagination] = useState<{ key: string; cursors: (string | null)[]; index: number }>({ key: '', cursors: [null], index: 0 });
  const index = pagination.key === baseKey ? pagination.index : 0;
  const cursor = pagination.key === baseKey ? pagination.cursors[index] : null;
  const key = `${baseKey}:${cursor ?? ''}`;
  const [result, setResult] = useState<{ key: string; page: TicketPage; error: string; loading: boolean }>({ key: '', page: EMPTY, error: '', loading: false });
  useEffect(() => {
    if (!memberId || !enabled) return;
    const controller = new AbortController();
    // Debounce typing and cancel stale pages, including reads of another account.
    const timer = setTimeout(async () => {
      setResult(previous => ({ key, page: previous.key === key ? previous.page : EMPTY, error: '', loading: true }));
      try {
        const query = new URLSearchParams(params);
        if (cursor) query.set('cursor', cursor);
        const page = await readTicketResource<TicketPage>(`/api/tickets/search?${query}`, memberId, controller.signal);
        if (!controller.signal.aborted) setResult({ key, page, error: '', loading: false });
      } catch (failure) {
        if (!controller.signal.aborted) setResult({ key, page: EMPTY, error: failure instanceof Error ? failure.message : 'No se pudo buscar.', loading: false });
      }
    }, filters.q ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, params, cursor, memberId, enabled, refreshKey, filters.q]);
  const page = result.key === key ? result.page : EMPTY;
  const next = () => { if (!page.nextCursor) return; setPagination(previous => {
    const history = previous.key === baseKey ? previous.cursors.slice(0, index + 1) : [null];
    return { key: baseKey, cursors: [...history, page.nextCursor], index: index + 1 };
  }); };
  const previous = () => setPagination(value => value.key === baseKey ? { ...value, index: Math.max(0, value.index - 1) } : value);
  const exportAll = async (): Promise<TicketPage['items']> => {
    if (!memberId) return [];
    const items = new Map<number, TicketPage['items'][number]>();
    let nextCursor: string | null = null;
    do {
      const page: TicketPage = await readTicketResource<TicketPage>(`/api/tickets/search?${ticketSearchParams(filters, nextCursor, 100)}`, memberId);
      page.items.forEach(ticket => items.set(ticket.id, ticket));
      nextCursor = page.nextCursor;
      if (items.size >= 10_000 && nextCursor) throw new Error('La exportación supera 10.000 resultados. Ajusta los filtros para dividirla.');
    } while (nextCursor);
    return [...items.values()];
  };
  return { ...page, loading: enabled && (result.key !== key || result.loading), error: result.key === key ? result.error : '', index, next, previous, exportAll };
}

export function useTicketConversation(memberId: string | undefined, accessKey: string, ticketId: number | null, refreshKey: string | undefined) {
  type Conversation = import('@/lib/ticket-search').ConversationPage;
  const key = `${accessKey}:${ticketId ?? ''}`;
  const [result, setResult] = useState<{ key: string; value: Conversation | null; error: string; loading: boolean }>({ key: '', value: null, error: '', loading: false });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const selected = useRef(key);
  useEffect(() => {
    selected.current = key;
    if (!memberId || !ticketId) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setResult(previous => ({ key, value: previous.key === key ? previous.value : null, error: '', loading: true }));
      try {
        const value = await readTicketResource<Conversation>(`/api/tickets/${ticketId}/conversation`, memberId, controller.signal);
        if (!controller.signal.aborted) setResult(previous => {
          // Keep older pages the person explicitly opened, and refresh the live tail.
          const previousMessages = previous.key === key ? previous.value?.messages ?? [] : [];
          const previousIds = new Set(previousMessages.map(message => message.id));
          const overlap = value.messages.some(message => previousIds.has(message.id));
          const first = value.messages[0];
          const older = overlap && first ? previousMessages.filter(message => message.createdAt < first.createdAt || message.createdAt === first.createdAt && message.id < first.id) : [];
          const messages = [...new Map([...older, ...value.messages].map(message => [message.id, message])).values()];
          return { key, value: { ...value, messages, nextCursor: older.length ? previous.value!.nextCursor : value.nextCursor }, error: '', loading: false };
        });
      } catch (failure) {
        if (!controller.signal.aborted) setResult({ key, value: null, error: failure instanceof Error ? failure.message : 'No se pudo abrir la conversación.', loading: false });
      }
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, memberId, ticketId, refreshKey]);
  const value = result.key === key ? result.value : null;
  const loadOlder = async () => {
    if (!memberId || !ticketId || !value?.nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await readTicketResource<Conversation>(`/api/tickets/${ticketId}/conversation?cursor=${encodeURIComponent(value.nextCursor)}`, memberId);
      if (selected.current === key) setResult(previous => ({ key, value: { ...page, messages: [...new Map([...page.messages, ...(previous.value?.messages ?? [])].map(message => [message.id, message])).values()] }, error: '', loading: false }));
    } catch (failure) {
      if (selected.current === key) setResult(previous => ({ ...previous, error: failure instanceof Error ? failure.message : 'No se pudieron cargar mensajes anteriores.' }));
    } finally { setLoadingOlder(false); }
  };
  return { ticket: value?.ticket ?? null, messages: value?.messages ?? [], hasOlder: Boolean(value?.nextCursor), loadOlder, loadingOlder, loading: Boolean(ticketId) && (result.key !== key || result.loading), error: result.key === key ? result.error : '' };
}
