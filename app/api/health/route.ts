import { checkHealth } from '@/lib/health';
import { db } from '@/lib/server';

export const dynamic = 'force-dynamic';

// Public on purpose: uptime monitors cannot hold a session. `?deep=1` also checks the
// database (cached for 10 s); without it the probe never touches Neon.
export async function GET(request: Request) {
  const deep = new URL(request.url).searchParams.get('deep') === '1';
  const result = await checkHealth({ deep, probe: () => db().prepare('SELECT 1 AS ok').first() });
  return Response.json(result, { status: result.status === 'ok' ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
