import { db, handle, json, parseBody, patchTicketSchema, getSettings, getTicket, parseId, checkAssignment, type RouteContext } from '@/lib/server';
import { requireAccess, requireStaff, assigneeFor, requesterFor } from '@/lib/access';
export async function PATCH(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = requireStaff(await requireAccess(request));
    const id = parseId((await context.params).id);
    const data = await parseBody(request, patchTicketSchema);
    const old = await getTicket(access, id);
    const settings = await getSettings(access.ownerId);
    checkAssignment(data, settings);
    const now = new Date().toISOString();
    const changes: Record<string, string | null> = { updatedAt: now };
    for (const key of ['subject', 'department', 'priority', 'status'] as const) if (data[key] !== undefined) changes[key] = data[key];
    if (data.assigneeMemberId !== undefined || data.assignee !== undefined) Object.assign(changes, await assigneeFor(access, data.assigneeMemberId, data.assignee));
    if (data.requesterMemberId !== undefined) {
      if (data.requesterMemberId) Object.assign(changes, await requesterFor(access, data.requesterMemberId));
      else changes.requesterMemberId = null;
    }
    if (data.priority && data.priority !== old.priority) changes.dueAt = new Date(new Date(old.createdAt).getTime() + settings.slaHours[data.priority] * 3600000).toISOString();
    if (data.status && data.status !== 'resolved' && old.status === 'resolved') changes.dueAt = new Date(Date.now() + settings.slaHours[data.priority || old.priority] * 3600000).toISOString();
    const labels: Record<string, string> = {subject:'Asunto',department:'Departamento',assignee:'Asignación',requesterName:'Cliente',priority:'Prioridad',status:'Estado'};
    const values: Record<string, string> = {open:'Abierto',pending:'Pendiente',resolved:'Resuelto',low:'Baja',normal:'Normal',high:'Alta',urgent:'Urgente'};
    const audit = Object.entries(changes).filter(([key, value]) => labels[key] && value !== old[key as keyof typeof old]).map(([key, value]) => `${labels[key]}: ${values[value || ''] || value || 'Sin asignar'}`).join(' · ');
    const database = db();
    const keys = Object.keys(changes);
    const queries = [database.prepare(`UPDATE tickets SET ${keys.map((key, index) => `"${key}" = $${index + 1}`).join(', ')} WHERE id = $${keys.length + 1} AND "ownerId" = $${keys.length + 2}`).bind(...Object.values(changes), id, access.ownerId)];
    if (audit) queries.push(database.prepare("INSERT INTO messages (\"ownerId\", \"ticketId\", author, body, kind, \"createdAt\") VALUES ($1, $2, $3, $4, $5, $6)").bind(access.ownerId, id, access.member.name, `Actualización del ticket — ${audit}`, 'note', now));
    await database.batch(queries);
    return json({ ticket: await getTicket(access, id) });
  });
}
