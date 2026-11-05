/** Only ticket links may survive sign-in. Never accept arbitrary redirect URLs. */
export function ticketReturnPath(value: unknown): string {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return '/';
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? `/?ticket=${id}` : '/';
}

export function safeTicketReturnPath(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if(value==='/workspaces')return value;
  const workspace=/^\/w\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})(?:\?ticket=([1-9]\d*))?$/.exec(value);
  if(workspace&&(!workspace[2]||Number.isSafeInteger(Number(workspace[2]))))return value;
  const match = /^\/\?ticket=(\d+)$/.exec(value);
  return match ? ticketReturnPath(match[1]) : '/';
}

export function ticketLoginPath(returnTo: unknown): string {
  const safe = safeTicketReturnPath(returnTo);
  return safe === '/' ? '/login' : `/login?return_to=${encodeURIComponent(safe)}`;
}
