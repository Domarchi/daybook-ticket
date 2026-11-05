import { z } from 'zod';
import { requireAccess } from '@/lib/access';
import { db, handle, json, parseBody } from '@/lib/server';
import { getAutomaticBackupStatus, saveAutomaticBackupSettings } from '@/lib/automatic-backup';
import { assertPlatformBackupAccess,recordSecurityEvent } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const schema = z.object({ enabled: z.boolean(), localTime: z.string().regex(/^([01]\d|2[0-3]):(00|30)$/),
  retention: z.number().int().min(1).max(14), storageBudgetMiB: z.number().int().min(64).max(1024),
  version: z.number().int().nonnegative(), planConfirmed: z.boolean() }).strict();
export async function GET(request: Request) {
  return handle(async () => {const access=await requireAccess(request);assertPlatformBackupAccess(access);return json(await getAutomaticBackupStatus(access, db()));});
}
export async function PATCH(request: Request) {
  return handle(async () => {const access=await requireAccess(request);assertPlatformBackupAccess(access);const result=await saveAutomaticBackupSettings(access, db(), await parseBody(request, schema));await db().transaction(tx=>recordSecurityEvent(tx,access,'configuration_changed'));return json(result);});
}
