import { enqueueAutomationEvent, drainAutomationBestEffort } from '@/lib/automation';
import {
  validateMessageCollaboration,
  attachMessageCollaboration,
  followerRecipients,
} from '@/lib/ticket-collaboration';
import { ApiError, db, handle, json, parseBody, messageSchema, parseId, type RouteContext } from '@/lib/server';
import { getSettingsInTransaction } from '@/lib/settings-transaction';
import { getEffectiveServicePolicy } from '@/lib/service-policies';
import { resolutionDeadline } from '@/lib/ticket-sla';
import { requireAccess } from '@/lib/access';
import { notificationStatements, drainOutboxBestEffort } from '@/lib/mail';
import {
  runOperation,
  lockTicket,
  publicReplyRecipients,
  recordEvent,
  staffNotificationRecipients,
} from '@/lib/ticket-mutations';
import { linkReadyAttachments } from '@/lib/attachments';
import { after } from 'next/server';
import { processPushOutboxBestEffort } from '@/lib/push';
export async function POST(request: Request, context: RouteContext) {
  return handle(async () => {
    const access = await requireAccess(request);
    const id = parseId((await context.params).id);
    const data = await parseBody(request, messageSchema);
    const result = await runOperation(
      access,
      data.operationId,
      'message',
      { ticketId: id, ...data },
      async (tx, fresh) => {
        const settings = await getSettingsInTransaction(tx, access.ownerId);
        const client = fresh.role === 'client';
        if (client && data.kind !== 'reply')
          throw new ApiError(403, 'Las notas internas están reservadas para el equipo.');
        // Reserve mentioned members before the ticket, sharing the order used by
        // current-membership readers and all owner-serialized ticket writers.
        const collaboration = await validateMessageCollaboration(tx, fresh, id, data);
        const ticket = await lockTicket(tx, fresh, id);
        // A closed ticket is final for the customer: their next request is a new ticket. The team can still write.
        if (client && ticket.status === 'closed')
          throw new ApiError(409, 'Este ticket está cerrado. Crea un ticket nuevo para continuar la conversación.');
        const now = new Date().toISOString();
        const { rows } = await tx.query(
          'INSERT INTO messages ("ownerId","ticketId",author,"authorMemberId","authorRole",body,kind,"createdAt","bodyFormat") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,"ticketId",author,"authorMemberId","authorRole",body,"bodyFormat",kind,"createdAt"',
          [
            access.ownerId,
            id,
            fresh.member.name,
            fresh.member.id,
            fresh.role,
            data.body,
            data.kind,
            now,
            data.bodyFormat || 'plain',
          ],
        );
        const message = { ...rows[0], ...collaboration };
        await attachMessageCollaboration(tx, fresh, message.id, collaboration);
        await linkReadyAttachments(tx, fresh, {
          ids: data.attachmentIds,
          draftId: data.draftId || data.operationId,
          kind: data.kind,
          ticketId: id,
          messageId: message.id,
        });
        const attachments = await tx.query(
          'SELECT id,name,size,"contentType" FROM attachments WHERE "messageId"=$1 AND "ownerId"=$2 AND status=\'attached\' ORDER BY "createdAt",id',
          [message.id, access.ownerId],
        );
        message.attachments = attachments.rows;
        const reopen = client && ticket.status === 'resolved';
        const policy = reopen
          ? await getEffectiveServicePolicy(tx, access.ownerId, ticket.customerCompanyId, settings.slaHours)
          : null;
        await tx.query(
          'UPDATE tickets SET "updatedAt"=$1,version=version+1,status=$2,"dueAt"=$3,"slaPolicySnapshot"=$6,"slaStartedAt"=$7 WHERE id=$4 AND "ownerId"=$5',
          [
            now,
            reopen ? 'open' : ticket.status,
            policy ? resolutionDeadline(now, ticket.priority, policy) : ticket.dueAt,
            id,
            access.ownerId,
            policy ? JSON.stringify(policy) : ticket.slaPolicySnapshot || null,
            reopen ? now : ticket.slaStartedAt || null,
          ],
        );
        if (reopen) await recordEvent(tx, fresh, id, 'status', 'resolved', 'open');
        for (const mention of collaboration.mentions)
          for (const stmt of notificationStatements(db(), {
            ownerId: access.ownerId,
            event: 'member_mentioned',
            eventKey: `mention:${data.operationId}`,
            recipientMemberId: mention.id,
            ticketId: id,
            sourceMessageId: message.id,
          }))
            await db().execute(stmt, tx);
        if (data.kind !== 'note') {
          const recipients = await publicReplyRecipients(
            tx,
            fresh,
            ticket,
            client ? await staffNotificationRecipients(tx, fresh, ticket.assigneeMemberId, settings) : [],
          );
          for (const recipientMemberId of recipients)
            for (const stmt of notificationStatements(db(), {
              ownerId: access.ownerId,
              event: client ? 'client_replied' : 'agent_replied',
              eventKey: `message:${data.operationId}:${recipientMemberId}`,
              recipientMemberId,
              ticketId: id,
            }))
              await db().execute(stmt, tx);
          for (const recipientMemberId of await followerRecipients(tx, fresh, id, recipients))
            for (const stmt of notificationStatements(db(), {
              ownerId: access.ownerId,
              event: 'ticket_followed_update',
              eventKey: `follow:${data.operationId}`,
              recipientMemberId,
              ticketId: id,
              sourceMessageId: message.id,
            }))
              await db().execute(stmt, tx);
        }
        if (data.kind !== 'note')
          await enqueueAutomationEvent(
            tx,
            fresh,
            id,
            `message:${data.operationId}`,
            client ? 'client_replied' : 'agent_replied',
          );
        return { message };
      },
    );
    after(async () => {
      await Promise.allSettled([
        processPushOutboxBestEffort(access.ownerId),
        drainOutboxBestEffort(access.ownerId),
        drainAutomationBestEffort(access.ownerId),
      ]);
    });
    return json(result, 201);
  });
}
