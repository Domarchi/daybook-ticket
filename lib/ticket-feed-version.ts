/**
 * A cheap fingerprint of everything the automatic refresh (`/api/tickets/updates`) answers, so an unchanged inbox
 * is answered «304 sin cambios» instead of being read again (plan de calidad, A1).
 *
 * Today every tab reads the inbox page, its counts, departments and alerts every 5 to 30 seconds, and each answer
 * also makes the browser read the open conversation and the search results again. With the fingerprint, a poll costs
 * two aggregate queries while nothing changes.
 *
 * Getting it wrong in the safe direction (a new fingerprint although nothing visible changed) only costs one full
 * read. The fingerprint therefore covers more than the feed itself:
 * - tickets the person can see: count, newest `updatedAt` and the sum of `version` (every write bumps one of them,
 *   messages and their attachments included), plus the overdue count, which changes with time alone;
 * - their alerts: count, newest, unread and newest read, and when alerts were turned on;
 * - for the panels refreshed with the feed (contacts, requirements): members, companies and requirements of the
 *   workspace, by count and newest `updatedAt`;
 * - who is asking (member, role, company and visibility), so another account or a changed role is never «unchanged»;
 * - the current hour, so anything else that depends on time catches up at least once an hour.
 */
import { createHash } from 'node:crypto';
import type { AccessContext } from './access';
import { alertScope } from './alerts';
import { db } from './server';
import { ticketReadScope } from './ticket-read-scope';
import { FINISHED_SQL } from './ticket-status';

export async function getTicketFeedVersion(access: AccessContext, now = new Date()): Promise<string> {
  const tickets = ticketReadScope(access);
  const at = tickets.bind(now.toISOString());
  const owner = tickets.bind(access.ownerId);
  const alerts = alertScope(access);
  const [ticketRow, alertRow] = await Promise.all([
    db()
      .prepare(
        `SELECT
          (SELECT concat_ws(',', count(*), max(t."updatedAt"), sum(t.version),
              count(*) FILTER (WHERE t.status NOT IN ${FINISHED_SQL} AND t."dueAt"<${at}))
             FROM tickets t WHERE ${tickets.sql}) AS tickets,
          (SELECT concat_ws(',', count(*), max("updatedAt")) FROM members WHERE "ownerId"=${owner}) AS members,
          (SELECT concat_ws(',', count(*), max("updatedAt")) FROM "customerCompanies" WHERE "ownerId"=${owner}) AS companies,
          (SELECT concat_ws(',', count(*), max("updatedAt")) FROM "ticketFulfillment" WHERE "ownerId"=${owner}) AS requirements,
          (SELECT "alertsActivatedAt" FROM "notificationSettings" WHERE "ownerId"=${owner}) AS "alertsActivatedAt"`,
      )
      .bind(...tickets.values)
      .first<Record<string, string | null>>(),
    db()
      .prepare(
        `SELECT concat_ws(',', count(*), max(o."createdAt"), count(*) FILTER (WHERE o."readAt" IS NULL), max(o."readAt")) AS alerts
           FROM "mailOutbox" o JOIN tickets t ON t.id = o."ticketId" AND t."ownerId" = o."ownerId"
          WHERE ${alerts.sql}`,
      )
      .bind(...alerts.values)
      .first<{ alerts: string | null }>(),
  ]);
  return feedVersion({
    viewer: [
      access.member.id,
      access.role,
      access.member.status,
      access.member.customerCompanyId ?? '',
      access.member.companyAccess,
    ],
    data: { ...ticketRow, alerts: alertRow?.alerts ?? null },
    hour: now.toISOString().slice(0, 13),
  });
}

/** Pure part, tested on its own: the same inputs always give the same short tag. */
export function feedVersion(input: { viewer: string[]; data: Record<string, unknown>; hour: string }): string {
  const keys = Object.keys(input.data).sort();
  const payload = JSON.stringify([input.viewer, keys.map(key => [key, input.data[key] ?? null]), input.hour]);
  return createHash('sha256').update(payload).digest('base64url').slice(0, 27);
}

export const feedTag = (version: string) => `W/"${version}"`;

/** RFC 9110 weak comparison for `If-None-Match`: any listed tag, or `*`. */
export function feedUnchanged(ifNoneMatch: string | null, tag: string): boolean {
  if (!ifNoneMatch) return false;
  const opaque = (value: string) => value.trim().replace(/^W\//, '');
  return ifNoneMatch.split(',').some(value => value.trim() === '*' || opaque(value) === opaque(tag));
}
