'use client';
import { useState } from 'react';
export type TeamFilters = { company: string; agent: string };
const EMPTY: TeamFilters = { company: 'all', agent: 'all' };
function read(memberId: string): TeamFilters {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`daybook.ticket.filters.v1.${memberId}`) || 'null');
    if (value && typeof value === 'object' && 'company' in value && typeof value.company === 'string' && 'agent' in value && typeof value.agent === 'string') return { company: value.company, agent: value.agent };
  } catch { /* Filters work without browser storage. */ }
  return EMPTY;
}
export function useTeamFilters(memberId?: string) {
  const [state, setState] = useState<{ memberId?: string; filters: TeamFilters }>({ filters: EMPTY });
  if (memberId !== state.memberId) setState({ memberId, filters: memberId ? read(memberId) : EMPTY });
  const filters = state.memberId === memberId ? state.filters : EMPTY;
  const update = (next: TeamFilters) => {
    setState({ memberId, filters: next });
    if (memberId) try { localStorage.setItem(`daybook.ticket.filters.v1.${memberId}`, JSON.stringify(next)); } catch { /* Keep current filters in memory. */ }
  };
  return { filters, update };
}
