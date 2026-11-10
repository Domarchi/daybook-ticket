import { getDatabase } from '../db';
import type { Database } from '../db/database';
import { ApiError } from './server';
import { logEvent } from './log';

// Per-user, per-action fixed windows kept in the table Better Auth already uses for
// sign-in limits ("authRateLimit"), so no migration is needed. Limits are generous:
// they stop scripts and runaway clients, not people. Each check is one small upsert,
// so only expensive or abusable actions are limited (not the polling feed).
export type RateRule = { bucket: string; max: number; windowMs: number; message: string };

export const RATE_RULES = {
  ticketSearch: {
    bucket: 'ticket-search',
    max: 120,
    windowMs: 60_000,
    message: 'Estás buscando demasiado rápido. Espera unos segundos.',
  },
  ticketCreate: {
    bucket: 'ticket-create',
    max: 30,
    windowMs: 60_000,
    message: 'Estás creando tickets demasiado rápido. Espera un minuto.',
  },
  attachmentReserve: {
    bucket: 'attachment-reserve',
    max: 30,
    windowMs: 60_000,
    message: 'Estás subiendo archivos demasiado rápido. Espera un minuto.',
  },
  attachmentUpload: {
    bucket: 'attachment-upload',
    max: 90,
    windowMs: 60_000,
    message: 'Estás subiendo archivos demasiado rápido. Espera un minuto.',
  },
  report: {
    bucket: 'report',
    max: 10,
    windowMs: 60_000,
    message: 'Estás generando informes demasiado rápido. Espera un minuto.',
  },
} as const satisfies Record<string, RateRule>;

export function rateLimitKey(rule: Pick<RateRule, 'bucket'>, userId: string): string {
  return `daybook-rate:${rule.bucket}:${userId}`;
}

/** Counts one use of `rule` for the user and throws 429 beyond the limit. Fails open if the limiter itself errors. */
export async function consumeRateLimit(
  access: { userId: string },
  rule: RateRule,
  database: Database = getDatabase(),
  now = Date.now(),
): Promise<void> {
  const key = rateLimitKey(rule, access.userId);
  let count: number | undefined;
  try {
    const row = await database
      .prepare(
        `INSERT INTO "authRateLimit" (id,key,count,"lastRequest") VALUES ($1,$1,1,$2)
      ON CONFLICT(key) DO UPDATE SET count=CASE WHEN "authRateLimit"."lastRequest"<$2-$3 THEN 1 ELSE "authRateLimit".count+1 END,
      "lastRequest"=CASE WHEN "authRateLimit"."lastRequest"<$2-$3 THEN $2 ELSE "authRateLimit"."lastRequest" END RETURNING count`,
      )
      .bind(key, now, rule.windowMs)
      .first<{ count: number }>();
    count = row?.count;
  } catch {
    logEvent('warn', 'rate_limit_unavailable', { bucket: rule.bucket });
    return;
  }
  if (count !== undefined && count > rule.max) throw new ApiError(429, rule.message);
}
