import { workspaceApiPath, workspaceIdFromPath } from './workspace-model';
export function currentWorkspaceId() {
  return typeof window === 'undefined' || !window.location ? 'daybook' : workspaceIdFromPath(window.location.pathname);
}
/** Per call and per tab. There is no mutable global workspace, cookie, or selected-space storage. */
export function workspaceRequestInput(
  input: RequestInfo | URL,
  id = currentWorkspaceId(),
  origin = typeof window === 'undefined' ? null : window.location?.origin,
): RequestInfo | URL {
  if (typeof input === 'string' && input.startsWith('/')) return workspaceApiPath(input, id);
  // Requests and URL objects follow the same rule as relative strings. External
  // origins and explicitly scoped APIs retain their original destinations.
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!origin) return input;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return input;
  }
  if (url.origin !== origin) return input;
  const scoped = workspaceApiPath(`${url.pathname}${url.search}`, id);
  if (scoped === `${url.pathname}${url.search}`) return input;
  url = new URL(scoped, origin);
  return input instanceof Request ? new Request(url, input) : url;
}
export const workspaceFetch: typeof fetch = (input, init) => fetch(workspaceRequestInput(input), init);
export function workspaceStorageKey(key: string, workspaceId = currentWorkspaceId()) {
  return workspaceId === 'daybook' ? key : `daybook.workspace.${workspaceId}.${key}`;
}
