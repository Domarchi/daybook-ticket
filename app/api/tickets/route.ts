import { ApiError, db, handle, json, parseBody, createTicketSchema, getSettings, checkAssignment, ticketColumns } from '@/lib/server';
import { requireAccess, assigneeFor, requesterFor, notificationRecipients } from '@/lib/access';
import { notificationStatements, processOutboxBestEffort } from '@/lib/mail';
import type { Ticket } from '@/lib/types';
import { after } from 'next/server';
import { processPushOutboxBestEffort } from '@/lib/push';
export async function POST(request: Request) {
  return handle(async () => {
    const access = await requireAccess(request);
    const data = await parseBody(request, createTicketSchema);
    const settings = await getSettings(access.ownerId);
    checkAssignment(data, settings);
    const client = access.role === 'client';
    if (client && (data.assigneeMemberId || data.assignee || (data.requesterMemberId && data.requesterMemberId !== access.member.id))) throw new ApiError(403, 'Solo puedes crear tickets para tu propia cuenta.');
    const requester = client
      ? { requesterMemberId: access.member.id, requesterName: access.member.name, requesterEmail: access.member.email }
      : data.requesterMemberId ? await requesterFor(access, data.requesterMemberId)
      : { requesterMemberId: null, requesterName: data.requesterName || '', requesterEmail: data.requesterEmail || '' };
    if (!requester.requesterName || !requester.requesterEmail) throw new ApiError(400, 'Selecciona un cliente o completa su nombre y correo.');
    const assignment = client ? { assignee: '', assigneeMemberId: null } : await assigneeFor(access, data.assigneeMemberId, data.assignee);
    const now = new Date().toISOString();
    const dueAt = new Date(Date.now() + settings.slaHours[data.priority] * 3600000).toISOString();
    const creationKey = crypto.randomUUID();
    const database = db();
    const recipients = await notificationRecipients(access, assignment.assigneeMemberId);
    const statements = [
      database.prepare("INSERT INTO tickets (\"ownerId\", \"creationKey\", subject, \"requesterName\", \"requesterEmail\", \"requesterMemberId\", department, assignee, \"assigneeMemberId\", status, priority, \"createdAt\", \"updatedAt\", \"dueAt\") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)").bind(access.ownerId, creationKey, data.subject, requester.requesterName, requester.requesterEmail, requester.requesterMemberId, data.department, assignment.assignee, assignment.assigneeMemberId, 'open', data.priority, now, now, dueAt),
      database.prepare("INSERT INTO messages (\"ownerId\", \"ticketId\", author, body, kind, \"createdAt\") SELECT $1, id, $2, $3, $4, $5 FROM tickets WHERE \"creationKey\" = $6 AND \"ownerId\" = $7").bind(access.ownerId, requester.requesterName, data.body, 'request', now, creationKey, access.ownerId),
      ...recipients.filter(id => id !== access.member.id).flatMap(recipientMemberId => notificationStatements(database, { ownerId: access.ownerId, event: 'ticket_created', eventKey: `ticket:${creationKey}:${recipientMemberId}`, recipientMemberId, ticketCreationKey: creationKey })),
    ];
    await database.batch(statements);
    after(() => processPushOutboxBestEffort(access.ownerId));
    await processOutboxBestEffort(access.ownerId);
    const ticket = await database.prepare(`SELECT ${ticketColumns} FROM tickets WHERE "creationKey" = $1 AND "ownerId" = $2`).bind(creationKey, access.ownerId).first<Ticket>();
    return json({ ticket }, 201);
  });
}
