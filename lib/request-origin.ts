/**
 * Browser mutations must come from the configured public origin.
 *
 * `Origin` is the primary signal. When it is absent, the Fetch Metadata header
 * `Sec-Fetch-Site` is the fallback: a browser that says the request is
 * `cross-site` or `same-site` is rejected even if it did not send `Origin`.
 * Requests with neither header are not browser traffic (scripts, the QA HTTP
 * validators) and keep working: they cannot carry a victim's cookies cross-site.
 */
export function mutationOriginAllowed(headers: Pick<Headers, 'get'>, siteOrigin: string): boolean {
  const origin = headers.get('origin');
  if (origin) return origin === siteOrigin;
  const site = headers.get('sec-fetch-site');
  return !site || site === 'same-origin' || site === 'none';
}
