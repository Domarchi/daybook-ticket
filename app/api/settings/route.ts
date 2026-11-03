import { requireAccess, requireAdmin } from '@/lib/access';
import { ApiError, db, handle, json, parseBody, settingsSchema, getSettings } from '@/lib/server';
export async function PATCH(request: Request) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    const data = await parseBody(request, settingsSchema);
    if (data.notificationMemberIds?.length) {
      const ids = data.notificationMemberIds;
      const placeholders = ids.map((_, index) => `$${index + 3}`).join(', ');
      const eligible = await db().prepare(`SELECT id FROM members WHERE "ownerId" = $1 AND "organizationId" = $2 AND id IN (${placeholders}) AND role IN ('owner', 'admin', 'agent') AND status IN ('active', 'invited')`)
        .bind(access.ownerId, access.organizationId, ...ids).all<{ id: string }>();
      if (eligible.results.length !== ids.length) throw new ApiError(400, 'Selecciona responsables del equipo con acceso activo o una invitación pendiente.');
    }
    const settings = { ...(await getSettings(access.ownerId)), ...data };
    await db().prepare("INSERT INTO settings (\"ownerId\", data) VALUES ($1, $2) ON CONFLICT(\"ownerId\") DO UPDATE SET data = excluded.data").bind(access.ownerId, JSON.stringify(settings)).run();
    return json({ settings });
  });
}
