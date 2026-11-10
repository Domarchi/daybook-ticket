/**
 * The staff desk keeps the current view and open ticket in the URL so that Back, Forward,
 * reload and shared links land where the person was. Only these query parameters are used:
 *
 *   /                      inbox
 *   /?view=overview        any other view in DESK_VIEWS
 *   /?ticket=12            an open ticket (the view is the inbox when the person goes back)
 *   /?view=service&company=<uuid>   a company inside "Empresas y servicios"
 *
 * `?serviceContext=1[&company=]` is the older form of the service view; it is still read.
 */
export const DESK_VIEWS = ['inbox', 'overview', 'contacts', 'knowledge', 'team', 'settings', 'portal', 'operations', 'metrics', 'service', 'reports', 'security'] as const;
export type View = (typeof DESK_VIEWS)[number];

const COMPANY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isDeskView(value: unknown): value is View {
  return typeof value === 'string' && (DESK_VIEWS as readonly string[]).includes(value);
}

export function parseTicketId(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

type Params = { get(name: string): string | null };

export function parseDeskLocation(params: Params): { view: View; ticketId: number | null; companyId: string | null } {
  const ticketId = parseTicketId(params.get('ticket'));
  const requested = params.get('view');
  const view: View = isDeskView(requested) ? requested : params.get('serviceContext') === '1' ? 'service' : 'inbox';
  const company = params.get('company');
  return { view, ticketId, companyId: company && COMPANY_ID.test(company) ? company.toLowerCase() : null };
}

/** The query string (with the leading "?", or "" for the inbox) that represents a desk location. */
export function deskQuery(location: { view?: View; ticketId?: number | null; companyId?: string | null }): string {
  if (location.ticketId && Number.isSafeInteger(location.ticketId) && location.ticketId > 0) return `?ticket=${location.ticketId}`;
  const view = location.view ?? 'inbox';
  if (view === 'inbox') return '';
  const params = new URLSearchParams({ view });
  if (view === 'service' && location.companyId && COMPANY_ID.test(location.companyId)) params.set('company', location.companyId.toLowerCase());
  return `?${params}`;
}

type DeskTarget = { view?: View; ticketId?: number | null; companyId?: string | null };

/**
 * Changes the URL without a server round trip (Next.js syncs `useSearchParams` with the History API).
 * Entries pushed here are tagged so the "back to inbox" button can tell an in-app history entry from a
 * shared link opened directly.
 */
export function navigateDesk(next: DeskTarget, mode: 'push' | 'replace' = 'push') {
  if (typeof window === 'undefined') return;
  const target = `${window.location.pathname}${deskQuery(next)}`;
  if (target === `${window.location.pathname}${window.location.search}`) return;
  if (mode === 'push') window.history.pushState({ deskNav: true }, '', target);
  else {
    // Never hand Next.js its own history state back: it treats that as an internal call and then
    // leaves `useSearchParams` on the old URL. A fresh object lets it copy its internals itself.
    const state = window.history.state as { deskNav?: boolean } | null;
    window.history.replaceState(state?.deskNav ? { deskNav: true } : null, '', target);
  }
}

/** Back to the list: a real "back" when the ticket was opened from inside the app, otherwise the inbox in place. */
export function leaveTicket() {
  if (typeof window === 'undefined') return;
  const state = window.history.state as { deskNav?: boolean } | null;
  if (state?.deskNav) window.history.back();
  else navigateDesk({ view: 'inbox' }, 'replace');
}
