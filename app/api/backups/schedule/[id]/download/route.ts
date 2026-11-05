import { z } from 'zod';
import { requireAccess } from '@/lib/access';
import { db, handle, type RouteContext } from '@/lib/server';
import { downloadAutomaticBackup } from '@/lib/automatic-backup';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = await requireAccess(request), id = z.string().uuid().parse((await context.params).id);
    const { bytes, date } = await downloadAutomaticBackup(access, id, db());
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === bytes.length) { bytes.fill(0); controller.close(); return; }
        const end = Math.min(offset + 64 * 1024, bytes.length);
        controller.enqueue(new Uint8Array(bytes.subarray(offset, end))); offset = end;
      },
      cancel() { bytes.fill(0); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="daybook-automatico-${date}.daybook"`,
      'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'", 'Referrer-Policy': 'no-referrer' } });
  });
}
