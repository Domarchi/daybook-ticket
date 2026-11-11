'use client';
import { workspaceStorageKey } from '@/lib/workspace-client';
import { isTicketQueue } from '@/lib/ticket-status';
import { isCategoryFilter } from '@/lib/ticket-category-model';
import { useState } from 'react';
export type TeamFilters = {
  company: string;
  agent: string;
  queue: string;
  priority: string;
  department: string;
  category: string;
};
const EMPTY: TeamFilters = {
  company: 'all',
  agent: 'all',
  queue: 'all',
  priority: 'all',
  department: 'all',
  category: 'all',
};
export function normalizeTeamFilters(value: unknown): TeamFilters {
  if (!value || typeof value !== 'object') return EMPTY;
  const saved = value as Record<string, unknown>;
  const text = (key: string) => (typeof saved[key] === 'string' && saved[key].length > 0 ? saved[key] : 'all');
  const queue = text('queue'),
    priority = text('priority');
  return {
    company: text('company'),
    agent: text('agent'),
    department: text('department'),
    category: isCategoryFilter(text('category')) ? text('category') : 'all',
    // "open" and "pending" belonged to the old three states; "all" shows every state.
    queue: isTicketQueue(queue) && queue !== 'open' && queue !== 'pending' ? queue : 'all',
    priority: ['all', 'low', 'normal', 'high', 'urgent'].includes(priority) ? priority : 'all',
  };
}
function read(memberId: string): TeamFilters {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(workspaceStorageKey(`daybook.ticket.filters.v1.${memberId}`)) || 'null',
    );
    return normalizeTeamFilters(value);
  } catch {
    /* Filters work without browser storage. */
  }
  return EMPTY;
}
export function useTeamFilters(memberId?: string) {
  const [state, setState] = useState<{ memberId?: string; filters: TeamFilters }>({ filters: EMPTY });
  if (memberId !== state.memberId) setState({ memberId, filters: memberId ? read(memberId) : EMPTY });
  const filters = state.memberId === memberId ? state.filters : EMPTY;
  const update = (next: TeamFilters) => {
    setState({ memberId, filters: next });
    if (memberId)
      try {
        localStorage.setItem(workspaceStorageKey(`daybook.ticket.filters.v1.${memberId}`), JSON.stringify(next));
      } catch {
        /* Keep current filters in memory. */
      }
  };
  return { filters, update };
}
