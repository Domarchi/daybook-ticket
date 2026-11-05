import { requireAccess, requireAdmin } from '@/lib/access';
import { ApiError, db, handle, json, parseBody, settingsSchema } from '@/lib/server';
import { acquireTicketWorkLock } from '@/lib/work-lock';
import { lockAccess } from '@/lib/ticket-mutations';
import { getSettingsInTransaction } from '@/lib/settings-transaction';
import { getEffectiveServicePolicy } from '@/lib/service-policies';
import { resolutionDeadline } from '@/lib/ticket-sla';
export async function PATCH(request: Request) {
  return handle(async () => {
    const access = requireAdmin(await requireAccess(request));
    const data = await parseBody(request, settingsSchema);
    const settings = await db().transaction(async tx => {
      await acquireTicketWorkLock(tx, access.ownerId);
      const fresh = requireAdmin(await lockAccess(tx, access));
      if (data.notificationMemberIds?.length) {
        const eligible = await tx.query(`SELECT id FROM members WHERE "ownerId"=$1 AND "organizationId"=$2
          AND id=ANY($3::text[]) AND role IN ('owner','admin','agent') AND status IN ('active','invited') FOR SHARE`,
        [fresh.ownerId, fresh.organizationId, data.notificationMemberIds]);
        if (eligible.rows.length !== data.notificationMemberIds.length) throw new ApiError(400, 'Selecciona responsables del equipo con acceso activo o una invitación pendiente.');
      }
      const previous = await getSettingsInTransaction(tx, fresh.ownerId);
      const next = { ...previous, ...data };
      let calendar;
      if (data.slaHours) {
        const policy = await getEffectiveServicePolicy(tx, fresh.ownerId, null, data.slaHours);
        calendar = policy.calendar;
        resolutionDeadline(new Date().toISOString(), 'urgent', { ...policy, slaHours: {
          ...data.slaHours, urgent: Math.max(...Object.values(data.slaHours)),
        } });
      }
      await tx.query('INSERT INTO settings ("ownerId",data) VALUES ($1,$2) ON CONFLICT ("ownerId") DO UPDATE SET data=EXCLUDED.data', [fresh.ownerId, JSON.stringify(next)]);
      // Keep older clients and the new general SLA editor consistent.
      const hours = data.slaHours;
      if (hours && (['urgent', 'high', 'normal', 'low'] as const).some(priority => hours[priority] !== previous.slaHours[priority])) {
        const now = new Date().toISOString();
        // Materialize the first explicit legacy edit as well, so an open new
        // editor with inherited id=null/version=0 cannot overwrite that change.
        await tx.query(`INSERT INTO "servicePolicies" (id,"ownerId","scopeKey","customerCompanyId","calendarJson","slaHoursJson",version,"createdAt","updatedAt")
          VALUES ($1,$2,'default',NULL,$3,$4,1,$5,$5) ON CONFLICT ("ownerId","scopeKey") DO UPDATE
          SET "slaHoursJson"=EXCLUDED."slaHoursJson",version="servicePolicies".version+1,"updatedAt"=EXCLUDED."updatedAt"`,
        [crypto.randomUUID(), fresh.ownerId, JSON.stringify(calendar), JSON.stringify(hours), now]);
      }
      return next;
    });
    return json({ settings });
  });
}
