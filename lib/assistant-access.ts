import { requireAccess, type AccessContext } from './access';
import { assistantAllowedFor, assistantEnabled } from './assistant-config';
import { ApiError } from './server';

/**
 * The gate of every Bita route. With the flag off the routes answer 404 before reading the session: for everyone,
 * Bita does not exist. With it on, the session decides; an agent, a customer or a pilot workspace also gets 404, so
 * the routes do not reveal a feature that is not theirs.
 */
export async function requireAssistantAccess(request: Request): Promise<AccessContext> {
  if (!assistantEnabled()) throw new ApiError(404, 'No encontrado.');
  const access = await requireAccess(request);
  if (!assistantAllowedFor(access)) throw new ApiError(404, 'No encontrado.');
  return access;
}
