/**
 * Configuration of Bita, the staff assistant, read from the environment in one place.
 *
 * Pure: it takes the environment as a parameter (default `process.env`) so it can be tested without touching the
 * process. Bita is OFF by default: it is a new feature that costs money per use, and anything not recognised as an
 * explicit "yes" leaves it off. A typo fails towards the safe side and shows up as a missing button, not on the bill.
 *
 * Access is fixed in code, not configurable: owner and admin of the main Servicios Daybook space only. Never agents,
 * never clients (the customer portal), never a pilot workspace (`/w/<id>`), whose data belongs to another business.
 */
type Env = Record<string, string | undefined>;

const YES = new Set(['1', 'true', 'on', 'yes', 'si', 'sí']);

/** The cheapest model of the current family. Bita reads and summarises the desk's own data; it needs no more. */
export const DEFAULT_ASSISTANT_MODEL = 'claude-haiku-5-5';
/** Messages per person and Santiago day. Two people use Bita; 20 each keeps a month around a few dollars. */
export const DEFAULT_DAILY_LIMIT = 20;
export const MIN_DAILY_LIMIT = 1;
export const MAX_DAILY_LIMIT = 200;
/** The only space Bita works in. Pilot workspaces are other businesses and stay out. */
export const ASSISTANT_WORKSPACE = 'daybook';
export const ASSISTANT_ROLES: ReadonlySet<string> = new Set(['owner', 'admin']);

export function assistantEnabled(env: Env = process.env): boolean {
  const value = env.ASSISTANT_ENABLED?.trim().toLowerCase();
  return Boolean(value) && YES.has(value!);
}

/** Whether a key is configured. Asked apart from the flag to tell "off" from "on but not set up". The value itself
 * is only read by the client factory in `assistant-agent.ts`. */
export function assistantHasKey(env: Env = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY?.trim());
}

export function assistantModel(env: Env = process.env): string {
  return env.ASSISTANT_MODEL?.trim() || DEFAULT_ASSISTANT_MODEL;
}

/** A value that is not a positive integer falls back to the default; one out of range is clamped. It is a spending
 * cap: a typo must not be able to set it to zero or to a million. */
export function assistantDailyLimit(env: Env = process.env): number {
  const raw = env.ASSISTANT_DAILY_LIMIT?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_DAILY_LIMIT;
  return Math.min(MAX_DAILY_LIMIT, Math.max(MIN_DAILY_LIMIT, Number(raw)));
}

export function assistantAllowedFor(
  access: { role: string; organizationId: string; member: { status: string } },
  env: Env = process.env,
): boolean {
  return (
    assistantEnabled(env) &&
    ASSISTANT_ROLES.has(access.role) &&
    access.organizationId === ASSISTANT_WORKSPACE &&
    access.member.status === 'active'
  );
}

/** What the page tells the desk: the client component never reads the environment. */
export function assistantAvailableFor(
  access: { role: string; organizationId: string; member: { status: string } },
  env: Env = process.env,
): boolean {
  return assistantAllowedFor(access, env) && assistantHasKey(env);
}
