import type { Database, PreparedStatement } from '../db/database';
import { PUSH_EVENTS } from './push-validation';

/** Run immediately after inserting the corresponding event, within the same transaction. */
export function pushDeliveryStatements(database: Database, input: { eventId: string; ownerId: string; event: string; recipientMemberId: string; createdAt: string }): PreparedStatement[] {
  if (!(PUSH_EVENTS as readonly string[]).includes(input.event)) return [];
  return [database.prepare(`INSERT INTO "pushDeliveries" (id, "ownerId", "eventId", "subscriptionId", status, attempts, "createdAt", "updatedAt")
    SELECT $1 || ':' || s.id, $2, o.id, s.id, 'queued', 0, $5, $5
    FROM "pushSubscriptions" s
    JOIN members m ON m.id = s."memberId" AND m."ownerId" = s."ownerId" AND m.status = 'active'
    JOIN "mailOutbox" o ON o.id = $1 AND o."ownerId" = s."ownerId" AND o."recipientMemberId" = s."memberId"
    WHERE s."ownerId" = $2 AND s."memberId" = $3 AND s.active = true AND o.event = $4 AND s."createdAt" <= o."createdAt"
    ON CONFLICT("eventId", "subscriptionId") DO NOTHING`)
    .bind(input.eventId, input.ownerId, input.recipientMemberId, input.event, input.createdAt)];
}
