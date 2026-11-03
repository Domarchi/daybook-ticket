import { ApiError, db, handle, json, parseBody, messageSchema, getSettings, getTicket, parseId, messageColumns, type RouteContext } from '@/lib/server';
import { requireAccess, notificationRecipients } from '@/lib/access';
import { notificationStatements, processOutboxBestEffort } from '@/lib/mail';
import type { Message } from '@/lib/types';
import { after } from 'next/server';
import { processPushOutboxBestEffort } from '@/lib/push';
export async function POST(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = await requireAccess(request);
    const id = parseId((await context.params).id);
    const data = await parseBody(request, messageSchema);
    const ticket = await getTicket(access, id);
    const client = access.role === 'client';
    if (client && data.kind !== 'reply') throw new ApiError(403, 'Las notas internas están reservadas para el equipo.');
    const now = new Date().toISOString();
    const database = db();
    const eventId = crypto.randomUUID();
    const recipients = data.kind === 'note' ? [] : client
      ? await notificationRecipients(access, ticket.assigneeMemberId)
      : ticket.requesterMemberId ? [ticket.requesterMemberId] : [];
    const settings = client ? await getSettings(access.ownerId) : null;
    const deadline = (priority: 'urgent' | 'high' | 'normal' | 'low') => new Date(Date.parse(now) + settings!.slaHours[priority] * 3600000).toISOString();
    // Evaluate the stored status and priority in the same transaction as the reply.
    // A client's follow-up reopens a resolved case; staff messages preserve its state.
    const updateTicket = client
      ? database.prepare("UPDATE tickets SET \"updatedAt\" = $1,\n          status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END,\n          \"dueAt\" = CASE WHEN status = 'resolved' THEN CASE priority\n            WHEN 'urgent' THEN $2 WHEN 'high' THEN $3 WHEN 'low' THEN $4 ELSE $5 END ELSE \"dueAt\" END\n          WHERE id = $6 AND \"ownerId\" = $7")
        .bind(now, deadline('urgent'), deadline('high'), deadline('low'), deadline('normal'), id, access.ownerId)
      : database.prepare("UPDATE tickets SET \"updatedAt\" = $1 WHERE id = $2 AND \"ownerId\" = $3").bind(now, id, access.ownerId);
    const result = await database.batch([
      database.prepare(`INSERT INTO messages ("ownerId", "ticketId", author, body, kind, "createdAt") VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${messageColumns}`).bind(access.ownerId, id, access.member.name, data.body, data.kind, now),
      updateTicket,
      ...recipients.filter(memberId => memberId !== access.member.id).flatMap(recipientMemberId => notificationStatements(database, { ownerId: access.ownerId, event: client ? 'client_replied' : 'agent_replied', eventKey: `message:${eventId}:${recipientMemberId}`, recipientMemberId, ticketId: id })),
    ]);
    after(() => processPushOutboxBestEffort(access.ownerId));
    await processOutboxBestEffort(access.ownerId);
    return json({ message: result[0].results[0] as unknown as Message }, 201);
  });
}
