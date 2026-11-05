import {collaborationDeliveryValid} from './ticket-collaboration';
import webpush from 'web-push';
import { createECDH } from 'node:crypto';
import { getDatabase } from '../db';
import { canAccessTicket, type AccessContext } from './access';
import type { CompanyAccess, MemberRole, MemberStatus } from './types';
import { ApiError } from './server';
import { classifyPushFailure, pushSubscriptionSchema, type BrowserPushSubscription } from './push-validation';

type Subscription = {
  id: string; ownerId: string; memberId: string; endpoint: string; p256dh: string; auth: string;
  active: boolean; createdAt: string; updatedAt: string; lastTestAt: string | null;
};
type Delivery = {
  id: string; ownerId: string; eventId: string; subscriptionId: string;
  attempts: number; leaseUntil: string; createdAt: string;
};
type Event = { id: string; event: string; ticketId: number; createdAt: string };
export type PushSender = (subscription: webpush.PushSubscription, payload: string, options: webpush.RequestOptions) => Promise<unknown>;
const TTL_SECONDS = 24 * 60 * 60;
const MAX_ATTEMPTS = 3;
const MAX_BATCH = 20;

function configuration() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || '';
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || '';
  const subject = process.env.VAPID_SUBJECT?.trim() || '';
  let validSubject = false;
  try {
    const url = new URL(subject);
    validSubject = (url.protocol === 'https:' && !url.username && !url.password) || /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject);
    if (!/^[A-Za-z0-9_-]{87}$/.test(publicKey) || !/^[A-Za-z0-9_-]{43}$/.test(privateKey)) throw new Error('Invalid VAPID key');
    const curve = createECDH('prime256v1');
    curve.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    if (curve.getPublicKey().toString('base64url') !== publicKey) throw new Error('VAPID keys do not match');
  } catch { return { publicKey: '', privateKey: '', subject: '', configured: false }; }
  return { publicKey, privateKey, subject, configured: validSubject };
}

export function pushConfiguration() {
  const config = configuration();
  return { configured: config.configured, publicKey: config.configured ? config.publicKey : null };
}

export async function registerPushSubscription(access: AccessContext, input: BrowserPushSubscription) {
  if (!configuration().configured) throw new ApiError(503, 'Los avisos con la página cerrada aún no están configurados.');
  const subscription = pushSubscriptionSchema.parse(input);
  const database = getDatabase();
  const now = new Date().toISOString();
  const rows = await database.batch([
    // The member lock keeps the device limit effective under concurrent registrations.
    database.prepare('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))').bind(`push:${access.member.id}`),
    database.prepare(`INSERT INTO "pushSubscriptions" (id, "ownerId", "memberId", endpoint, p256dh, auth, active, "createdAt", "updatedAt")
      SELECT $1, $2, $3, $4, $5, $6, true, $7, $7
      WHERE (SELECT COUNT(*) FROM "pushSubscriptions" WHERE "ownerId" = $2 AND "memberId" = $3 AND active = true AND endpoint <> $4) < 10
      ON CONFLICT(endpoint) DO UPDATE SET
        "ownerId" = EXCLUDED."ownerId", "memberId" = EXCLUDED."memberId", p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
        active = true, "updatedAt" = EXCLUDED."updatedAt",
        "createdAt" = CASE WHEN "pushSubscriptions".active = true AND "pushSubscriptions"."memberId" = EXCLUDED."memberId"
          AND "pushSubscriptions"."ownerId" = EXCLUDED."ownerId" AND "pushSubscriptions".p256dh = EXCLUDED.p256dh AND "pushSubscriptions".auth = EXCLUDED.auth
          THEN "pushSubscriptions"."createdAt" ELSE EXCLUDED."createdAt" END
      WHERE ("pushSubscriptions"."ownerId" = EXCLUDED."ownerId" AND "pushSubscriptions"."memberId" = EXCLUDED."memberId")
        OR ("pushSubscriptions".p256dh = EXCLUDED.p256dh AND "pushSubscriptions".auth = EXCLUDED.auth)
      RETURNING id`).bind(crypto.randomUUID(), access.ownerId, access.member.id, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, now),
    database.prepare(`UPDATE "pushDeliveries" d SET status = 'cancelled', "leaseUntil" = NULL, "updatedAt" = $1
      FROM "pushSubscriptions" s, "mailOutbox" o
      WHERE d."subscriptionId" = s.id AND d."eventId" = o.id AND s.endpoint = $2
      AND s."memberId" = $3 AND s."ownerId" = $4 AND d.status IN ('queued', 'processing')
      AND (o."recipientMemberId" <> s."memberId" OR o."createdAt" < s."createdAt")`).bind(now, subscription.endpoint, access.member.id, access.ownerId),
  ]);
  const id = rows[1].results[0]?.id;
  if (typeof id !== 'string') throw new ApiError(409, 'No se pudo activar este navegador. Puedes tener hasta diez activos; desactiva uno o renueva el permiso.');
  return { subscriptionId: id };
}

export async function getPushSubscriptionStatus(access: AccessContext, endpoint: string) {
  const row = await getDatabase().prepare('SELECT id, active FROM "pushSubscriptions" WHERE endpoint = $1 AND "memberId" = $2 AND "ownerId" = $3')
    .bind(endpoint, access.member.id, access.ownerId).first<{ id: string; active: boolean }>();
  return { enabled: Boolean(row?.active && configuration().configured), subscriptionId: row?.active ? row.id : null };
}

export async function unregisterPushSubscription(access: AccessContext, endpoint: string) {
  const database = getDatabase();
  const now = new Date().toISOString();
  await database.batch([
    database.prepare('UPDATE "pushSubscriptions" SET active = false, "updatedAt" = $1 WHERE endpoint = $2 AND "memberId" = $3 AND "ownerId" = $4')
      .bind(now, endpoint, access.member.id, access.ownerId),
    database.prepare(`UPDATE "pushDeliveries" d SET status = 'cancelled', "leaseUntil" = NULL, "updatedAt" = $1
      FROM "pushSubscriptions" s WHERE d."subscriptionId" = s.id AND s.endpoint = $2
      AND s."memberId" = $3 AND s."ownerId" = $4 AND d.status IN ('queued', 'processing')`)
      .bind(now, endpoint, access.member.id, access.ownerId),
  ]);
  return { ok: true };
}

async function eligibleEvent(subscription: Subscription, eventId: string): Promise<Event | null> {
  const row = await getDatabase().prepare(`SELECT o.id, o.event, o."sourceMessageId", o."ticketId", o."createdAt",
      t."requesterMemberId", t."customerCompanyId" AS "ticketCompanyId",
      m.role, m.status AS "memberStatus", m."customerCompanyId", m."companyAccess"
    FROM "mailOutbox" o
    JOIN members m ON m.id = o."recipientMemberId" AND m."ownerId" = o."ownerId"
    JOIN tickets t ON t.id = o."ticketId" AND t."ownerId" = o."ownerId"
    JOIN "pushDeliveries" d ON d."eventId" = o.id AND d."subscriptionId" = $1 AND d."ownerId" = o."ownerId"
    WHERE o.id = $2 AND o."ownerId" = $3 AND o."recipientMemberId" = $4 AND m.status = 'active'
      AND m.role IN ('client', 'owner', 'admin', 'agent')
      AND o.event IN ('ticket_created', 'agent_replied', 'client_replied', 'member_mentioned', 'ticket_followed_update') AND o."createdAt" >= $5
      AND d.status <> 'cancelled'`)
    .bind(subscription.id, eventId, subscription.ownerId, subscription.memberId, subscription.createdAt).first<Event & {
      sourceMessageId:number|null;requesterMemberId: string | null; ticketCompanyId: string | null; role: MemberRole;
      memberStatus: MemberStatus; customerCompanyId: string | null; companyAccess: CompanyAccess;
    }>();
  if (!row || !canAccessTicket({ ownerId: subscription.ownerId, role: row.role, member: {
    id: subscription.memberId, status: row.memberStatus, customerCompanyId: row.customerCompanyId, companyAccess: row.companyAccess,
  } }, { ownerId: subscription.ownerId, requesterMemberId: row.requesterMemberId, customerCompanyId: row.ticketCompanyId })) return null;
  if(!(await collaborationDeliveryValid(getDatabase(),{...row,ownerId:subscription.ownerId,recipientMemberId:subscription.memberId})))return null;
  return { id: row.id, event: row.event, ticketId: row.ticketId, createdAt: row.createdAt };
}

/** Called by the service worker with cookies before any OS notification is displayed. */
export async function pushReceipt(access: AccessContext, input: { subscriptionId: string; eventId?: string; test?: boolean }) {
  const subscription = await getDatabase().prepare('SELECT * FROM "pushSubscriptions" WHERE id = $1 AND "ownerId" = $2 AND "memberId" = $3 AND active = true')
    .bind(input.subscriptionId, access.ownerId, access.member.id).first<Subscription>();
  if (!subscription) throw new ApiError(404, 'Este navegador no tiene avisos activos para tu cuenta.');
  if (input.test) {
    if (!subscription.lastTestAt || Date.now() - Date.parse(subscription.lastTestAt) > 5 * 60_000) throw new ApiError(404, 'La prueba ya no está disponible.');
    return { title: 'Daybook Ticket', body: 'Los avisos están activos en este computador.', url: '/', tag: `daybook-test-${subscription.id}` };
  }
  const event = input.eventId ? await eligibleEvent(subscription, input.eventId) : null;
  if (!event) throw new ApiError(404, 'El aviso ya no está disponible para tu cuenta.');
  return {
    title: 'Daybook Ticket',
    body: event.event === 'member_mentioned' ? `Te mencionaron en una nota del ticket #${event.ticketId}.` : event.event === 'ticket_created' ? `Llegó el ticket #${event.ticketId}.` : `Nuevo mensaje en el ticket #${event.ticketId}.`,
    url: `/?ticket=${event.ticketId}`,
    tag: `daybook-${subscription.id}-${event.id}`,
  };
}

async function send(subscription: Subscription, payload: object, sender: PushSender) {
  const config = configuration();
  if (!config.configured) throw new ApiError(503, 'Los avisos con la página cerrada aún no están configurados.');
  // Validate stored values too: a compromised or legacy row must not become an arbitrary fetch.
  const safe = pushSubscriptionSchema.safeParse({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } });
  if (!safe.success) throw { statusCode: 400 };
  return sender(safe.data, JSON.stringify(payload), {
    TTL: TTL_SECONDS, urgency: 'normal', timeout: 10000,
    vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
  });
}

export async function sendPushTest(access: AccessContext, subscriptionId: string, sender: PushSender = webpush.sendNotification) {
  if (!configuration().configured) throw new ApiError(503, 'Los avisos con la página cerrada aún no están configurados.');
  const database = getDatabase();
  const now = new Date().toISOString();
  const subscription = await database.prepare(`UPDATE "pushSubscriptions" SET "lastTestAt" = $1
    WHERE id = $2 AND "ownerId" = $3 AND "memberId" = $4 AND active = true
      AND ("lastTestAt" IS NULL OR "lastTestAt" <= $5) RETURNING *`)
    .bind(now, subscriptionId, access.ownerId, access.member.id, new Date(Date.now() - 60_000).toISOString()).first<Subscription>();
  if (!subscription) throw new ApiError(429, 'Activa los avisos y espera un minuto entre pruebas.');
  try { await send(subscription, { subscriptionId: subscription.id, test: true }, sender); }
  catch (error) {
    const code = classifyPushFailure(error);
    if (code === 'expired_subscription') await disableExpired(subscription);
    throw new ApiError(503, code === 'expired_subscription' ? 'El permiso de este navegador venció. Desactiva y activa los avisos de nuevo.' : 'No se pudo enviar la prueba. Intenta nuevamente en un minuto.');
  }
  return { ok: true };
}

async function disableExpired(subscription: Subscription) {
  // A late 410 response must not disable a newer binding of this endpoint.
  await getDatabase().prepare('UPDATE "pushSubscriptions" SET active = false, "updatedAt" = $1 WHERE id = $2 AND "memberId" = $3 AND "createdAt" = $4 AND p256dh = $5 AND auth = $6')
    .bind(new Date().toISOString(), subscription.id, subscription.memberId, subscription.createdAt, subscription.p256dh, subscription.auth).run();
}

async function finish(delivery: Delivery, status: string, code: string | null) {
  await getDatabase().prepare(`UPDATE "pushDeliveries" SET status = $1, "lastErrorCode" = $2, "leaseUntil" = NULL, "updatedAt" = $3
    WHERE id = $4 AND "ownerId" = $5 AND status = 'processing' AND "leaseUntil" = $6`)
    .bind(status, code, new Date().toISOString(), delivery.id, delivery.ownerId, delivery.leaseUntil).run();
}

/** Event-triggered delivery after the response. Persisted claims prevent concurrent double sends.
 * Retries are bounded to this invocation; a later incoming event resumes any interrupted claims.
 */
export async function processPushOutbox(ownerId: string, options: { send?: PushSender; sleep?: (ms: number) => Promise<void> } = {}) {
  const summary = { configured: configuration().configured, processed: 0, accepted: 0, failed: 0 };
  if (!summary.configured) return summary;
  const database = getDatabase();
  const sender = options.send || webpush.sendNotification;
  const sleep = options.sleep || ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const now = new Date().toISOString();
  await database.prepare(`UPDATE "pushDeliveries" SET status = 'failed', "leaseUntil" = NULL, "lastErrorCode" = 'interrupted_delivery', "updatedAt" = $1
    WHERE "ownerId" = $2 AND attempts >= $3 AND (status = 'queued' OR (status = 'processing' AND "leaseUntil" <= $1))`)
    .bind(now, ownerId, MAX_ATTEMPTS).run();

  async function processCandidate(candidate: { id: string }) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const claimAt = new Date().toISOString();
      const delivery = await database.prepare(`UPDATE "pushDeliveries" SET status = 'processing', attempts = attempts + 1, "leaseUntil" = $1, "updatedAt" = $2
        WHERE id = $3 AND "ownerId" = $4 AND attempts < $5 AND (status = 'queued' OR (status = 'processing' AND "leaseUntil" <= $2)) RETURNING *`)
        .bind(new Date(Date.now() + 60_000).toISOString(), claimAt, candidate.id, ownerId, MAX_ATTEMPTS).first<Delivery>();
      if (!delivery) return;
      summary.processed++;
      const subscription = await database.prepare('SELECT * FROM "pushSubscriptions" WHERE id = $1 AND "ownerId" = $2 AND active = true')
        .bind(delivery.subscriptionId, ownerId).first<Subscription>();
      if (!subscription || !(await eligibleEvent(subscription, delivery.eventId)) || Date.now() - Date.parse(delivery.createdAt) >= TTL_SECONDS * 1000) {
        await finish(delivery, 'cancelled', 'recipient_unavailable'); return;
      }
      try {
        await send(subscription, { subscriptionId: subscription.id, eventId: delivery.eventId }, sender);
        await finish(delivery, 'accepted', null);
        summary.accepted++;
        return;
      } catch (error) {
        const code = classifyPushFailure(error);
        if (code === 'expired_subscription') await disableExpired(subscription);
        const retry = code === 'provider_unavailable' && delivery.attempts < MAX_ATTEMPTS;
        await finish(delivery, retry ? 'queued' : 'failed', code);
        if (!retry) { summary.failed++; return; }
        await sleep(1000 * delivery.attempts);
      }
    }
  }
  // Drain batches rather than leaving the 21st device waiting for another ticket. The
  // wall-clock bound leaves room for a final four-request group within Vercel's 300s limit.
  const deadline = Date.now() + 180_000;
  let visited = 0;
  while (visited < 200 && Date.now() < deadline) {
    const candidates = await database.prepare(`SELECT id FROM "pushDeliveries" WHERE "ownerId" = $1 AND attempts < $2
      AND (status = 'queued' OR (status = 'processing' AND "leaseUntil" <= $3)) ORDER BY "createdAt" ASC LIMIT $4`)
      .bind(ownerId, MAX_ATTEMPTS, new Date().toISOString(), MAX_BATCH).all<{ id: string }>();
    if (!candidates.results.length) break;
    for (let offset = 0; offset < candidates.results.length && Date.now() < deadline; offset += 4) {
      const group = candidates.results.slice(offset, offset + 4);
      visited += group.length;
      const results = await Promise.allSettled(group.map(processCandidate));
      // Wait for every in-flight send before leaving the background task on a DB error.
      if (results.some(result => result.status === 'rejected')) throw new Error('push_batch_unavailable');
    }
  }
  return summary;
}

export async function processPushOutboxBestEffort(ownerId: string) {
  try { await processPushOutbox(ownerId); }
  catch { console.error('Daybook Ticket push delivery unavailable'); }
}
