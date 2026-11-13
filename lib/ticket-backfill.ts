import { requireAdmin, type AccessContext } from './access';
import {
  BACKFILL_LIMIT,
  backfillColumns,
  backfillSuggestion,
  describeSuggestion,
  type BackfillSource,
  type BackfillSuggestion,
} from './ticket-backfill-model';
import { lockAccess, recordEvent } from './ticket-mutations';
import { db } from './server';
import { acquireTicketWorkLock } from './work-lock';

/** Old tickets (created before the classifier) with what the classifier would suggest. Nothing is written. */
export type BackfillPreviewItem = BackfillSuggestion & {
  subject: string;
  requesterName: string;
  createdAt: string;
  status: string;
};

const SOURCES = `SELECT t.id, t.subject, t."requesterName", t."createdAt", t.status,
    (SELECT m.body FROM messages m WHERE m."ownerId"=t."ownerId" AND m."ticketId"=t.id AND m.kind='request'
      ORDER BY m."createdAt", m.id LIMIT 1) AS body
  FROM tickets t WHERE t."ownerId"=$1 AND t."categorySource" IS NULL`;

export async function previewUnclassified(
  access: AccessContext,
): Promise<{ total: number; limit: number; items: BackfillPreviewItem[] }> {
  requireAdmin(access);
  const database = db();
  const [count, rows] = await Promise.all([
    database
      .prepare('SELECT count(*)::int AS total FROM tickets WHERE "ownerId"=$1 AND "categorySource" IS NULL')
      .bind(access.ownerId)
      .first<{ total: number }>(),
    database
      .prepare(`${SOURCES} ORDER BY t."createdAt", t.id LIMIT ${BACKFILL_LIMIT}`)
      .bind(access.ownerId)
      .all<BackfillSource & { requesterName: string; createdAt: string; status: string }>(),
  ]);
  return {
    total: count?.total ?? 0,
    limit: BACKFILL_LIMIT,
    items: rows.results.map(row => ({
      ...backfillSuggestion(row),
      subject: row.subject,
      requesterName: row.requesterName,
      createdAt: row.createdAt,
      status: row.status,
    })),
  };
}

/**
 * Stores the suggestion for the tickets a person ticked. The suggestion is computed again here (the browser only
 * sends ids), saved as `bot` so the ticket says «Sugerida» and anyone can still correct it. A ticket classified in
 * the meantime, by a person or by a new message, is skipped. `updatedAt` stays: old tickets do not jump to the top.
 */
export async function applyUnclassified(
  access: AccessContext,
  ticketIds: number[],
): Promise<{ applied: number; skipped: number }> {
  requireAdmin(access);
  return db().transaction(async tx => {
    await acquireTicketWorkLock(tx, access.ownerId);
    const fresh = requireAdmin(await lockAccess(tx, access));
    const rows = (
      await tx.query<BackfillSource>(`${SOURCES} AND t.id=ANY($2::int[]) ORDER BY t.id FOR UPDATE OF t`, [
        fresh.ownerId,
        ticketIds,
      ])
    ).rows;
    for (const row of rows) {
      const suggestion = backfillSuggestion(row);
      await tx.query(
        `UPDATE tickets SET "faultGroup"=$3,"faultElement"=$4,requirement=$5,"categorySource"='bot',"categoryConfidence"=$6,
           version=version+1 WHERE id=$1 AND "ownerId"=$2 AND "categorySource" IS NULL`,
        [row.id, fresh.ownerId, ...backfillColumns(suggestion)],
      );
      await recordEvent(
        tx,
        fresh,
        row.id,
        'category',
        'Sin clasificar',
        `${describeSuggestion(suggestion)} (sugerida automáticamente)`,
      );
    }
    return { applied: rows.length, skipped: ticketIds.length - rows.length };
  });
}
