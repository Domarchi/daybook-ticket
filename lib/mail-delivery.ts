import type { PoolClient } from 'pg';
import type { Database } from '../db/database';
import {
  mailAddress,
  projectDeliveryEvents,
  type DeliveryEventType,
  type DeliveryReceipt,
  type DeliveryStatus,
} from './mail-delivery-validation';
import { readFrozenMailPayload } from './mail-templates';

type OutboxDeliveryRow = {
  id: string;
  ownerId: string;
  providerId: string | null;
  payloadJson: string | null;
  environment: string | null;
};
export interface MailDeliveryItem {
  id: string;
  event: string;
  recipientEmail: string | null;
  status: string;
  attempts: number;
  createdAt: string;
  nextAttemptAt: string | null;
  error: string | null;
  deliveryStatus: DeliveryStatus;
  deliveryEventAt: string | null;
  deliveredAt: string | null;
  bouncedAt: string | null;
  complainedAt: string | null;
  history: { eventType: DeliveryEventType; occurredAt: string }[];
}
const DELIVERY_LABELS: Partial<Record<string, string>> = {
  delivery_delayed: 'El servidor del destinatario demoró la entrega.',
  recipient_bounced: 'El servidor del destinatario rechazó el correo.',
  recipient_complained: 'El destinatario marcó este correo como no deseado.',
  delivery_failed: 'El proveedor no pudo entregar el correo.',
  recipient_suppressed: 'El proveedor bloqueó la entrega a este destinatario.',
};

async function providerLock(client: PoolClient, providerId: string) {
  // Both ingestion and send acceptance take the same lock, so an early legacy
  // receipt cannot fall between an orphan lookup and the provider-id update.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`daybook-mail:${providerId}`]);
}

async function pruneOrphans(client: PoolClient, now: string) {
  const cutoff = new Date(Date.parse(now) - 86_400_000).toISOString();
  await client.query(
    `WITH expired AS (SELECT id FROM "mailDeliveryEvents" WHERE "outboxId" IS NULL AND "receivedAt" < $1
    ORDER BY "receivedAt", id LIMIT 100 FOR UPDATE SKIP LOCKED)
    DELETE FROM "mailDeliveryEvents" e USING expired WHERE e.id = expired.id`,
    [cutoff],
  );
}

async function updateProjection(client: PoolClient, row: Pick<OutboxDeliveryRow, 'id' | 'ownerId'>) {
  const { rows } = await client.query<{ eventType: DeliveryEventType; occurredAt: string }>(
    `SELECT "eventType", "occurredAt" FROM "mailDeliveryEvents"
    WHERE "outboxId" = $1 AND "ownerId" = $2`,
    [row.id, row.ownerId],
  );
  const projected = projectDeliveryEvents(rows);
  await client.query(
    `UPDATE "mailOutbox" SET "deliveryStatus" = $1, "deliveryEventAt" = $2, "deliveredAt" = $3,
    "bouncedAt" = $4, "complainedAt" = $5, "deliveryErrorCode" = $6 WHERE id = $7 AND "ownerId" = $8`,
    [
      projected.deliveryStatus,
      projected.deliveryEventAt,
      projected.deliveredAt,
      projected.bouncedAt,
      projected.complainedAt,
      projected.deliveryErrorCode,
      row.id,
      row.ownerId,
    ],
  );
}

async function adoptOrphans(
  client: PoolClient,
  row: Pick<OutboxDeliveryRow, 'id' | 'ownerId'>,
  providerId: string,
  now: string,
) {
  await client.query(
    `UPDATE "mailDeliveryEvents" SET "outboxId" = $1, "ownerId" = $2
    WHERE "providerId" = $3 AND "outboxId" IS NULL AND "ownerId" IS NULL AND "receivedAt" >= $4`,
    [row.id, row.ownerId, providerId, new Date(Date.parse(now) - 86_400_000).toISOString()],
  );
  await updateProjection(client, row);
}

/** Provider acceptance is independent from delivery. This only binds the id and
 * adopts authenticated receipts; it never fabricates an email.sent event. */
export async function acceptMailWithDelivery(
  db: Database,
  input: { id: string; ownerId: string; leaseUntil: string | null; providerId: string },
) {
  const now = new Date().toISOString();
  return db.transaction(async client => {
    await providerLock(client, input.providerId);
    const result = await client.query(
      `UPDATE "mailOutbox" SET status = 'accepted', "lastErrorCode" = NULL, "nextAttemptAt" = NULL,
      "providerId" = COALESCE("providerId", $1), "leaseUntil" = NULL, "updatedAt" = $2
      WHERE id = $3 AND "ownerId" = $4 AND status = 'processing' AND "leaseUntil" = $5
        AND ("providerId" IS NULL OR "providerId" = $1) RETURNING id`,
      [input.providerId, now, input.id, input.ownerId, input.leaseUntil],
    );
    if (result.rowCount !== 1) return false;
    await adoptOrphans(client, input, input.providerId, now);
    await pruneOrphans(client, now);
    return true;
  });
}

/** Called only after raw-body signature verification. No subject, raw payload,
 * email address or bounce text is retained in provider event history. */
export async function recordDeliveryReceipt(
  db: Database,
  receipt: DeliveryReceipt,
): Promise<'tracked' | 'pending' | 'duplicate' | 'ignored'> {
  return db.transaction(async client => {
    await providerLock(client, receipt.providerId);
    await pruneOrphans(client, receipt.receivedAt);
    const duplicate = await client.query<{ payloadHash: string }>(
      'SELECT "payloadHash" FROM "mailDeliveryEvents" WHERE id = $1',
      [receipt.id],
    );
    if (duplicate.rows[0]) {
      if (duplicate.rows[0].payloadHash !== receipt.payloadHash) throw new Error('Conflicting delivery receipt');
      return 'duplicate';
    }
    const candidate = receipt.outboxId
      ? await client.query<OutboxDeliveryRow>(
          `SELECT id, "ownerId", "providerId", "payloadJson", environment FROM "mailOutbox" WHERE id = $1 FOR UPDATE`,
          [receipt.outboxId],
        )
      : await client.query<OutboxDeliveryRow>(
          `SELECT id, "ownerId", "providerId", "payloadJson", environment FROM "mailOutbox" WHERE "providerId" = $1 ORDER BY "createdAt", id LIMIT 1 FOR UPDATE`,
          [receipt.providerId],
        );
    const row = candidate.rows[0];
    if (receipt.outboxId && (!row || row.environment !== receipt.environment)) return 'ignored';
    if (row) {
      if (row.providerId && row.providerId !== receipt.providerId) return 'ignored';
      const payload = row.payloadJson ? readFrozenMailPayload(row.payloadJson) : null;
      if (!payload || mailAddress(payload.from) !== receipt.from || mailAddress(payload.to[0]) !== receipt.to[0])
        return 'ignored';
    }
    const inserted = await client.query(
      `INSERT INTO "mailDeliveryEvents"
      (id, "outboxId", "ownerId", "providerId", "eventType", "occurredAt", "receivedAt", "payloadHash")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [
        receipt.id,
        row?.id ?? null,
        row?.ownerId ?? null,
        receipt.providerId,
        receipt.eventType,
        receipt.occurredAt,
        receipt.receivedAt,
        receipt.payloadHash,
      ],
    );
    if (!inserted.rowCount) return 'duplicate';
    if (!row) return 'pending';
    await client.query(
      'UPDATE "mailOutbox" SET "providerId" = COALESCE("providerId", $1) WHERE id = $2 AND "ownerId" = $3',
      [receipt.providerId, row.id, row.ownerId],
    );
    await adoptOrphans(client, row, receipt.providerId, receipt.receivedAt);
    return 'tracked';
  });
}

/** Invoked inside the route's fresh staff + ticket lock transaction. */
export async function ticketMailDelivery(
  client: PoolClient,
  ownerId: string,
  ticketId: number,
): Promise<MailDeliveryItem[]> {
  const { rows } = await client.query<
    MailDeliveryItem & { deliveryErrorCode: string | null; frozenPayload: string | null }
  >(
    `SELECT o.id, o.event, o.status, o.attempts,
    o."createdAt", o."nextAttemptAt", o."deliveryStatus", o."deliveryEventAt", o."deliveredAt", o."bouncedAt", o."complainedAt", o."deliveryErrorCode",
    o."payloadJson" AS "frozenPayload", m.email AS "recipientEmail" FROM "mailOutbox" o LEFT JOIN members m ON m.id = o."recipientMemberId" AND m."ownerId" = o."ownerId"
    WHERE o."ownerId" = $1 AND o."ticketId" = $2 ORDER BY o."createdAt" DESC, o.id DESC LIMIT 50`,
    [ownerId, ticketId],
  );
  if (!rows.length) return [];
  const events = await client.query<{ outboxId: string; eventType: DeliveryEventType; occurredAt: string }>(
    `SELECT "outboxId", "eventType", "occurredAt" FROM "mailDeliveryEvents"
    WHERE "ownerId" = $1 AND "outboxId" = ANY($2::text[]) ORDER BY "occurredAt", id`,
    [ownerId, rows.map(row => row.id)],
  );
  return rows.map(({ deliveryErrorCode, frozenPayload, ...row }) => ({
    ...row,
    recipientEmail: (frozenPayload ? readFrozenMailPayload(frozenPayload)?.to[0] : null) ?? row.recipientEmail,
    error: deliveryErrorCode ? (DELIVERY_LABELS[deliveryErrorCode] ?? 'La entrega requiere revisión.') : null,
    history: events.rows
      .filter(event => event.outboxId === row.id)
      .map(({ eventType, occurredAt }) => ({ eventType, occurredAt })),
  }));
}
