import { z } from 'zod';
import { requireAccess } from '@/lib/access';
import { handle, json, parseBody } from '@/lib/server';
import { encryptBackup, MAX_BACKUP_BYTES } from '@/lib/backup-format';
import { createWorkspaceBackup } from '@/lib/workspace-backup';
import { requireFreshSecurity,recordSecurityEvent,assertPlatformBackupAccess } from '@/lib/security';
import { db } from '@/lib/server';
export const maxDuration = 300;
export async function GET(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request);
    assertPlatformBackupAccess(access);
    return json({ available: true, format: 'daybook.workspace.v1', maximumBytes: MAX_BACKUP_BYTES, includes: ['cuentas y contraseñas cifradas', 'empresas', 'tickets y conversaciones', 'notas internas', 'archivos enviados', 'configuración e historial'], freshSignInAfterRecovery: true });
  });
}
export async function POST(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request);
    assertPlatformBackupAccess(access);
    await requireFreshSecurity(access);
    const { password } = await parseBody(request, z.object({ password: z.string().min(16).max(256), confirmation: z.literal('RESPALDAR') }).strict());
    const backup = await createWorkspaceBackup(access);
    const encrypted = encryptBackup(backup, password);
    await db().transaction(tx=>recordSecurityEvent(tx,access,'platform_backup_created'));
    let offset = 0;
    // Stream bounded chunks; a buffered Function response cannot exceed Vercel's payload limit.
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === encrypted.length) { encrypted.fill(0); controller.close(); return; }
        const end = Math.min(offset + 64 * 1024, encrypted.length);
        controller.enqueue(new Uint8Array(encrypted.subarray(offset, end))); offset = end;
      },
      cancel() { encrypted.fill(0); },
    });
    return new Response(stream, { headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="daybook-${backup.createdAt.slice(0, 10)}.daybook"`,
      'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'", 'Referrer-Policy': 'no-referrer',
      'X-Daybook-Backup-Rows': String(backup.tables.reduce((n, table) => n + table.rows.length, 0)),
      'X-Daybook-Backup-Files': String(backup.files.length),
    } });
  });
}
