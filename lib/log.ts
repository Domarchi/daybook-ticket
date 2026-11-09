// Minimal structured logging. One JSON object per line so Vercel's log search can
// filter by event or requestId. Never pass request bodies, emails, tokens or SQL.

export type LogLevel = 'info' | 'warn' | 'error';

export function newRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Reduces an unknown error to fields that are safe to log. Drizzle and pg embed the
 * statement and its parameters in the message ("Failed query: ... params: ..."), so
 * those messages are dropped; every other message keeps its first line only.
 */
export function describeError(error: unknown): { errorName: string; errorCode?: string; errorMessage?: string } {
  if (!(error instanceof Error)) return { errorName: typeof error };
  const code = (error as { code?: unknown }).code;
  const firstLine = error.message.split('\n', 1)[0].slice(0, 160);
  return {
    errorName: error.name,
    ...(typeof code === 'string' && /^[A-Z0-9_]{1,32}$/i.test(code) ? { errorCode: code } : {}),
    ...(/failed query|params:/i.test(error.message) || !firstLine ? {} : { errorMessage: firstLine }),
  };
}

export function logEvent(level: LogLevel, event: string, fields: Record<string, string | number | boolean | null | undefined> = {}): void {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
