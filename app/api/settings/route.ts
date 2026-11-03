import { requireAccess, requireAdmin } from '@/lib/access';
import { db, handle, json, parseBody, settingsSchema, getSettings } from '@/lib/server';
export async function PATCH(request: Request) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    const data = await parseBody(request, settingsSchema);
    const settings = { ...(await getSettings(access.ownerId)), ...data };
    await db().prepare("INSERT INTO settings (\"ownerId\", data) VALUES ($1, $2) ON CONFLICT(\"ownerId\") DO UPDATE SET data = excluded.data").bind(access.ownerId, JSON.stringify(settings)).run();
    return json({ settings });
  });
}
