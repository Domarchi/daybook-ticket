import { z } from 'zod';
export const workspaceIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/);
export function workspaceIdFromPath(path: string): string {
  const match = /^\/(?:api\/workspaces|w)\/([^/?#]+)(?:\/|\?|#|$)/.exec(path);
  if (!match) return 'daybook';
  return workspaceIdSchema.parse(match[1]);
}
export function workspaceHome(id: string, ticketId?: number) {
  workspaceIdSchema.parse(id);
  return `${id === 'daybook' ? '/' : `/w/${id}`}${ticketId && Number.isSafeInteger(ticketId) && ticketId > 0 ? `?ticket=${ticketId}` : ''}`;
}
export function workspaceApiPath(path: string, id = 'daybook') {
  workspaceIdSchema.parse(id);
  if (!path.startsWith('/api/') || /^\/api\/(?:auth|account|operator|workspaces|preferences)(?:\/|\?|$)/.test(path))
    return path;
  return id === 'daybook' ? path : `/api/workspaces/${id}/${path.slice(5)}`;
}
export function isWorkspaceSetupPath(path: string) {
  return /^\/api\/workspaces\/[^/]+\/(?:security(?:\/(?:policy|sessions))?|administration|evolution\/features)$/.test(
    path,
  );
}
export const limitsSchema = z
  .object({
    members: z.number().int().min(1).max(200),
    ticketsMonthly: z.number().int().min(1).max(10000),
    messagesMonthly: z.number().int().min(1).max(100000),
    storageBytes: z.number().int().min(10485760).max(10737418240),
    mailMonthly: z.number().int().min(1).max(100000),
  })
  .strict();
export const DEFAULT_PILOT_LIMITS = {
  members: 20,
  ticketsMonthly: 100,
  messagesMonthly: 1000,
  storageBytes: 104857600,
  mailMonthly: 1000,
};
export const pilotCapacitySchema = limitsSchema.extend({ maxActiveWorkspaces: z.number().int().min(1).max(10) });
export function parsePilotCapacity(config: Record<string, string | undefined> = process.env) {
  try {
    return pilotCapacitySchema.parse(JSON.parse(config.DAYBOOK_PILOT_CAPACITY_JSON || ''));
  } catch {
    return null;
  }
}
export function fitsPilotCapacity(limits: Record<string, number>[], capacity: z.infer<typeof pilotCapacitySchema>) {
  return (
    limits.length <= capacity.maxActiveWorkspaces &&
    Object.keys(DEFAULT_PILOT_LIMITS).every(
      key => limits.reduce((total, item) => total + item[key], 0) <= capacity[key as keyof typeof DEFAULT_PILOT_LIMITS],
    )
  );
}
export function operatorGranted(
  identity: { userId: string; email?: string },
  config: Record<string, string | undefined> = process.env,
) {
  const ids = (config.DAYBOOK_PLATFORM_OPERATOR_USER_IDS || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
  return ids.includes(identity.userId);
}
/** Operators attest existing provider verification in private configuration, never in tenant input. */
export function verifiedWorkspaceSender(
  id: string,
  sender: string | null,
  config: Record<string, string | undefined> = process.env,
): boolean {
  if (!sender || /[\r\n]/.test(sender) || !/^(?:[^<>]+\s*<)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(sender))
    return false;
  try {
    const allowed = JSON.parse(config.DAYBOOK_VERIFIED_WORKSPACE_SENDERS_JSON || '{}');
    return typeof allowed === 'object' && !Array.isArray(allowed) && allowed?.[id] === sender;
  } catch {
    return false;
  }
}
