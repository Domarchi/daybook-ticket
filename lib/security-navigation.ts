import { safeTicketReturnPath } from './return-path';
import { workspaceHome, workspaceIdFromPath } from './workspace-model';
/** Only known local verification pages may be followed from an API response. */
export function safeSecurityRedirect(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\u0000-\u0020\u007f\\]/.test(value)
  )
    return null;
  try {
    const url = new URL(value, 'https://daybook.invalid'),
      page =
        ['/security', '/account/security'].includes(url.pathname) ||
        /^\/w\/[A-Za-z0-9][A-Za-z0-9_-]{0,79}\/security$/.test(url.pathname);
    if (
      url.origin !== 'https://daybook.invalid' ||
      url.pathname !== value.split('?')[0] ||
      !page ||
      url.hash ||
      [...url.searchParams.keys()].some(key => key !== 'return_to') ||
      url.searchParams.getAll('return_to').length > 1
    )
      return null;
    const raw = url.searchParams.get('return_to');
    if (raw !== null) {
      const target = safeTicketReturnPath(raw);
      if (target === '/' && raw !== '/') return null;
      url.searchParams.set('return_to', target);
    }
    return url.pathname + url.search;
  } catch {
    return null;
  }
}
export async function followSecurityResponse(response: Response, input: RequestInfo | URL) {
  if (response.status !== 428 || typeof window === 'undefined') return response;
  try {
    const requested = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      window.location.href,
    );
    if (requested.origin !== window.location.origin || !requested.pathname.startsWith('/api/')) return response;
    const result = await response
        .clone()
        .json()
        .catch(() => null),
      path = safeSecurityRedirect(result?.redirectTo);
    if (!path) return response;
    const target = new URL(path, window.location.origin),
      id = workspaceIdFromPath(requested.pathname);
    if (id !== 'daybook' && target.pathname === '/security') target.pathname = `/w/${id}/security`;
    // A verification hint from one business cannot send this tab into another.
    if (target.pathname.startsWith('/w/') && workspaceIdFromPath(target.pathname) !== id) return response;
    let returnTo = safeTicketReturnPath(window.location.pathname + window.location.search);
    if (id !== 'daybook' && workspaceIdFromPath(returnTo) !== id) returnTo = workspaceHome(id);
    const explicit = target.searchParams.get('return_to');
    if (id !== 'daybook' && explicit !== null && workspaceIdFromPath(safeTicketReturnPath(explicit)) !== id)
      target.searchParams.set('return_to', workspaceHome(id));
    if (!target.searchParams.has('return_to') && returnTo !== '/') target.searchParams.set('return_to', returnTo);
    window.location.replace(target.href);
  } catch {
    /* Invalid hints never override the API error or retry the request. */
  }
  return response;
}
