import { timingSafeEqual } from 'node:crypto';

export interface TickInvocation { invocationId: string; scheduledAt: string }
export interface TickHandlerDependencies {
  enabled: boolean;
  secret: string | undefined;
  run: (invocation: TickInvocation) => Promise<unknown>;
}

/** Authentication stays outside the worker and runs before any dependency may touch the DB. */
export function createNotificationTickHandler(dependencies: TickHandlerDependencies) {
  return async (request: Request): Promise<Response> => {
    const headers = { 'cache-control': 'private, no-store' };
    const expected = dependencies.secret || '';
    const given = request.headers.get('authorization') || '';
    const expectedBytes = Buffer.from(`Bearer ${expected}`);
    const givenBytes = Buffer.from(given);
    const valid = expected.length >= 32 && givenBytes.byteLength === expectedBytes.byteLength
      && timingSafeEqual(givenBytes, expectedBytes);
    if (!valid) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
    if (!dependencies.enabled) return Response.json({ error: 'Scheduler disabled' }, { status: 503, headers });
    if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
    // Do not trust Content-Length alone, and cap streaming bodies before JSON parsing.
    const reader = request.body?.getReader();
    let bytes = 0; const chunks: Uint8Array[] = [];
    try {
      if (!reader) throw new Error('missing_body');
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 4096) { await reader.cancel(); return Response.json({ error: 'Payload too large' }, { status: 413, headers }); }
        chunks.push(part.value);
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_body');
      const { invocationId, scheduledAt } = body as Partial<TickInvocation>;
      if (typeof invocationId !== 'string' || !/^[a-zA-Z0-9:_-]{1,200}$/.test(invocationId)
        || typeof scheduledAt !== 'string' || !Number.isFinite(Date.parse(scheduledAt))) throw new Error('invalid_body');
      const result = await dependencies.run({ invocationId, scheduledAt });
      return Response.json({ ok: true, result }, { headers });
    } catch (error) {
      if (error instanceof SyntaxError || (error instanceof Error && ['missing_body', 'invalid_body'].includes(error.message))) {
        return Response.json({ error: 'Invalid invocation' }, { status: 400, headers });
      }
      console.error('Daybook Ticket scheduled notification tick failed');
      return Response.json({ error: 'Tick unavailable' }, { status: 503, headers: { ...headers, 'retry-after': '60' } });
    } finally { reader?.releaseLock(); }
  };
}
