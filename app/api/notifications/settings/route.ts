import { z } from 'zod';
import { requireAccess, requireAdmin } from '@/lib/access';
import { getNotificationConfig } from '@/lib/notification-config';
import { getReminderHealth } from '@/lib/reminders';
import { db, handle, json, parseBody } from '@/lib/server';

export const dynamic = 'force-dynamic';
const updateSchema = z.object({ enabled: z.boolean() }).strict();

export async function GET(request: Request) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    return json({
      config: await getNotificationConfig(access.ownerId),
      health: await getReminderHealth(access.ownerId),
    });
  });
}

export async function PATCH(request: Request) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    const { enabled } = await parseBody(request, updateSchema);
    await getNotificationConfig(access.ownerId);
    // Reset only on a genuine activation, preventing old conditions from flooding the team.
    await db()
      .prepare(
        `UPDATE "notificationSettings" SET
      "remindersActivatedAt" = CASE WHEN $1 AND NOT "remindersEnabled" THEN $2
        WHEN NOT $1 THEN NULL ELSE "remindersActivatedAt" END,
      "remindersEnabled" = $1 WHERE "ownerId" = $3`,
      )
      .bind(enabled, new Date().toISOString(), access.ownerId)
      .run();
    return json({
      config: await getNotificationConfig(access.ownerId),
      health: await getReminderHealth(access.ownerId),
    });
  });
}
