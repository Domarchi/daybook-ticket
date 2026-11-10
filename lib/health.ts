// Public liveness/readiness probe. It exposes nothing about workspaces, users or
// configuration: only whether the app runs and, on request, whether the database
// answers. The database check is cached briefly so a public URL cannot be used to
// keep Neon awake or to multiply queries.

export type HealthResult = { status: 'ok' | 'degraded'; version: string; database?: 'ok' | 'unreachable' };

const CACHE_MS = 10_000;
const PROBE_TIMEOUT_MS = 3_000;
let cached: { at: number; ok: boolean } | null = null;

export function appVersion(env: Record<string, string | undefined> = process.env): string {
  return (env.VERCEL_GIT_COMMIT_SHA || env.DAYBOOK_APP_VERSION || 'unknown').slice(0, 12);
}

export async function checkHealth(options: {
  deep: boolean;
  probe: () => Promise<unknown>;
  now?: number;
  version?: string;
}): Promise<HealthResult> {
  const version = options.version ?? appVersion();
  if (!options.deep) return { status: 'ok', version };
  const now = options.now ?? Date.now();
  if (!cached || now - cached.at >= CACHE_MS) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        options.probe(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), PROBE_TIMEOUT_MS);
        }),
      ]);
      cached = { at: now, ok: true };
    } catch {
      cached = { at: now, ok: false };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return cached.ok
    ? { status: 'ok', version, database: 'ok' }
    : { status: 'degraded', version, database: 'unreachable' };
}

export function resetHealthCacheForTests(): void {
  cached = null;
}
