import type { BetterAuthOptions } from 'better-auth';

/** Adapter failures can contain SQL parameters, session tokens and reset links.
 * Keep Better Auth's default warning threshold, but never inspect or forward its payloads. */
export const safeAuthLogger: NonNullable<BetterAuthOptions['logger']> = {
  level: 'warn',
  disableColors: true,
  log(level) {
    if (level === 'error') console.error('Daybook Ticket authentication error');
    else if (level === 'warn') console.warn('Daybook Ticket authentication warning');
  },
};
