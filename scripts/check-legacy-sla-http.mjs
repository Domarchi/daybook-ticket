/** Serial, real HTTP regression for the legacy SLA settings editor.
 * Run only after 0004, with the isolated QA server already on port 5175:
 * DAYBOOK_SITE_URL=http://127.0.0.1:5175 node --env-file=.env.test.local --import tsx scripts/check-legacy-sla-http.mjs
 * Uses DAYBOOK_QA_OWNER_EMAIL (or fictitious DAYBOOK_OWNER_EMAIL) and the QA-only
 * password convention; DAYBOOK_QA_OWNER_PASSWORD can override it. No provisioning,
 * tickets, delivery providers, Blob calls, auth-table reads, or persisted credentials.
 * Only settings/default service policy are temporarily changed and restored.
 */
import assert from 'node:assert/strict';
import pg from 'pg';
import { DEFAULT_SETTINGS } from '../lib/types.ts';

const qaHost = 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1', 'QA database opt-in is required.');
const databaseUrl = new URL(process.env.DATABASE_URL);
assert.equal(databaseUrl.hostname, qaHost, 'Only the isolated QA database is allowed.');
assert.equal(databaseUrl.pathname, '/daybook_ticket');
assert.equal(process.env.DAYBOOK_QA_DATABASE_HOST, qaHost);
assert.equal(process.env.DAYBOOK_SITE_URL, 'http://127.0.0.1:5175', 'Use the dedicated operations QA server.');
assert.notEqual(process.env.VERCEL_ENV, 'production');
for (const key of [
  'RESEND_API_KEY',
  'DAYBOOK_EMAIL_FROM',
  'VAPID_PRIVATE_KEY',
  'DAYBOOK_BLOB_PRODUCTION_READ_WRITE_TOKEN',
]) {
  assert.ok(!process.env[key], `${key} must be absent.`);
}
const email = process.env.DAYBOOK_QA_OWNER_EMAIL || process.env.DAYBOOK_OWNER_EMAIL;
const password = process.env.DAYBOOK_QA_OWNER_PASSWORD || 'Local-QA-only!Daybook-2026';
assert.ok(email && /^[^\s@]+@example\.test$/i.test(email), 'Set the existing fictitious DAYBOOK_QA_OWNER_EMAIL.');

const origin = process.env.DAYBOOK_SITE_URL;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 15000 });
const owner = { cookies: new Map(), ip: '192.0.2.221' };
const checks = [];
let ownerId, before, expectedTarget, pendingPatch, failure, cleanupFailure;
let dirty = false,
  restored = false,
  sessionClosed = false;
let phase = 'authentication';

async function api(path, method = 'GET', body) {
  const cookie = [...owner.cookies].map(([key, value]) => `${key}=${value}`).join('; ');
  const response = await fetch(`${origin}${path}`, {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(45000),
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(owner.id ? { 'X-Daybook-Member-Id': owner.id } : {}),
      'x-vercel-forwarded-for': owner.ip,
      ...(method === 'GET' ? {} : { origin, 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const line of response.headers.getSetCookie()) {
    const [part] = line.split(';'),
      at = part.indexOf('=');
    if (part.slice(at + 1)) owner.cookies.set(part.slice(0, at), part.slice(at + 1));
    else owner.cookies.delete(part.slice(0, at));
  }
  return { status: response.status, data: await response.json().catch(() => null) };
}
function ok(result, status = 200) {
  assert.equal(result.status, status, `${phase}: expected HTTP ${status}, received ${result.status}.`);
  assert.ok(result.data, `${phase}: expected a JSON response.`);
  return result.data;
}
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const targets = state => ({ settings: state.settings, policy: state.policy });
function checkTargets(state, expected, message) {
  // Compare booleans so a failed assertion cannot dump configuration rows.
  assert.ok(equal(targets(state), expected), message);
}
function checkProtected(state) {
  assert.ok(equal(state.notifications, before.notifications), 'Notification configuration must remain unchanged.');
  assert.ok(
    equal(state.tickets, before.tickets),
    'Existing ticket rows, deadlines and SLA snapshots must remain unchanged.',
  );
}
async function state(tx) {
  const settings =
    (await tx.query('SELECT "ownerId",data FROM settings WHERE "ownerId"=$1', [ownerId])).rows[0] || null;
  const policy =
    (
      await tx.query(
        `SELECT id,"ownerId","scopeKey","customerCompanyId","calendarJson","slaHoursJson",version,"createdAt","updatedAt"
    FROM "servicePolicies" WHERE "ownerId"=$1 AND "scopeKey"='default'`,
        [ownerId],
      )
    ).rows[0] || null;
  const notifications = (
    await tx.query(
      `SELECT "ownerId","alertsActivatedAt","remindersEnabled","remindersActivatedAt"
    FROM "notificationSettings" WHERE "ownerId"=$1`,
      [ownerId],
    )
  ).rows;
  // Only aggregates leave Postgres; no ticket subjects, bodies or personal data.
  const tickets = (
    await tx.query(
      `SELECT count(*)::integer AS total,
    encode(sha256(convert_to(COALESCE(string_agg(h,'' ORDER BY id),''),'UTF8')),'hex') AS sha256
    FROM (SELECT id,encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS h
      FROM tickets t WHERE t."ownerId"=$1) ticket_hashes`,
      [ownerId],
    )
  ).rows[0];
  return { settings, policy, notifications, tickets };
}
async function locked(work) {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    await tx.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='20s'");
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`daybook-ticket-work:${ownerId}`]);
    const result = await work(tx);
    await tx.query('COMMIT');
    return result;
  } catch (error) {
    await tx.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    tx.release();
  }
}
function changedHours(hours) {
  assert.ok(
    ['urgent', 'high', 'normal', 'low'].every(
      key => Number.isFinite(hours[key]) && hours[key] >= 1 && hours[key] <= 8760,
    ),
  );
  return { ...hours, normal: hours.normal >= 1.25 ? hours.normal - 0.25 : 1.25 };
}

/** Recognize only the pending PATCH's exact settings and bounded policy change.
 * A transport failure may occur after commit; adopt that known result so finally
 * can restore it. Unknown rows/versions remain untouched for operator review. */
async function adoptPendingPatch() {
  if (!pendingPatch) return;
  const pending = pendingPatch;
  await locked(async tx => {
    const current = await state(tx);
    if (equal(targets(current), pending.before)) {
      pendingPatch = null;
      return;
    }
    assert.ok(
      current.settings?.data === pending.expectedData,
      'Unexpected concurrent settings change; refusing to overwrite it.',
    );
    const old = pending.before.policy,
      next = current.policy;
    let recognized;
    if (old) {
      recognized =
        next &&
        next.id === old.id &&
        next.ownerId === old.ownerId &&
        next.scopeKey === 'default' &&
        next.customerCompanyId === null &&
        next.createdAt === old.createdAt &&
        next.calendarJson === old.calendarJson &&
        ((next.version === old.version && equal(next, old)) ||
          (next.version === old.version + 1 && next.slaHoursJson === JSON.stringify(pending.hours)));
    } else {
      recognized =
        next === null ||
        (next.ownerId === ownerId &&
          next.scopeKey === 'default' &&
          next.customerCompanyId === null &&
          next.version === 1 &&
          next.slaHoursJson === JSON.stringify(pending.hours) &&
          equal(JSON.parse(next.calendarJson), pending.calendar));
    }
    assert.ok(recognized, 'Unexpected concurrent policy change; refusing to overwrite it.');
    expectedTarget = targets(current);
    dirty = true;
    pendingPatch = null;
  });
}
async function editLegacy(label) {
  phase = label;
  const initial = await locked(async tx => {
    const current = await state(tx);
    checkTargets(current, expectedTarget, 'Shared configuration changed before the legacy edit.');
    checkProtected(current);
    return current;
  });
  const stale = ok(await api('/api/service-policies/default')).policy;
  assert.equal(stale.id, initial.policy?.id ?? null);
  assert.equal(stale.version, initial.policy?.version ?? 0);
  const previousSettings = {
    ...structuredClone(DEFAULT_SETTINGS),
    ...(initial.settings ? JSON.parse(initial.settings.data) : {}),
  };
  const hours = changedHours(previousSettings.slaHours);
  pendingPatch = {
    before: targets(initial),
    hours,
    calendar: stale.calendar,
    expectedData: JSON.stringify({ ...previousSettings, slaHours: hours }),
  };
  let result;
  try {
    result = await api('/api/settings', 'PATCH', { slaHours: hours });
  } finally {
    await adoptPendingPatch();
  }
  assert.ok(equal(ok(result).settings.slaHours, hours), 'The legacy editor must return the requested hours.');
  const updated = ok(await api('/api/service-policies/default')).policy;
  assert.ok(updated.id && updated.override, 'The first explicit legacy edit must materialize the general policy.');
  assert.equal(updated.version, (initial.policy?.version ?? 0) + 1);
  if (initial.policy) assert.equal(updated.id, initial.policy.id, 'Later edits preserve policy identity.');
  assert.ok(equal(updated.calendar, stale.calendar), 'The legacy editor must preserve the configured calendar.');
  assert.ok(equal(updated.slaHours, hours), 'Policy hours and legacy settings must remain synchronized.');
  ok(
    await api('/api/service-policies/default', 'PUT', {
      expectedId: stale.id,
      expectedVersion: stale.version,
      calendar: stale.calendar,
      slaHours: stale.slaHours,
    }),
    409,
  );
  await locked(async tx => {
    const after = await state(tx);
    checkTargets(after, expectedTarget, 'The stale policy PUT must not change either configuration row.');
    checkProtected(after);
  });
  checks.push(label);
}

try {
  // Read only membership identifiers; never inspect password/session tables.
  const members = (
    await pool.query(
      `SELECT m.id,m."ownerId",m."userId" FROM members m
    JOIN organizations o ON o.id=m."organizationId" AND o."ownerId"=m."ownerId"
    WHERE o.id='daybook' AND lower(m.email)=lower($1) AND m.role='owner' AND m.status='active'`,
      [email],
    )
  ).rows;
  assert.equal(members.length, 1, 'Activate the fictitious QA owner before running this regression.');
  ownerId = members[0].ownerId;
  const signedIn = ok(await api('/api/auth/sign-in/email', 'POST', { email, password }));
  assert.equal(
    signedIn.user?.id,
    members[0].userId,
    'HTTP sessions and the guarded QA database must identify the same owner.',
  );
  owner.id = members[0].id;
  before = await locked(state);
  expectedTarget = targets(before);

  if (before.policy) await editLegacy('existing general calendar and legacy stale-version rejection');
  // Exercise the previously unmaterialized editor even if QA already has a
  // general policy. Its exact original row stays in memory for finally only.
  await locked(async tx => {
    const current = await state(tx);
    checkTargets(current, expectedTarget, 'Shared configuration changed before the absent-policy scenario.');
    checkProtected(current);
    if (current.policy) {
      await tx.query(
        'DELETE FROM "servicePolicies" WHERE "ownerId"=$1 AND "scopeKey"=\'default\' AND id=$2 AND version=$3',
        [ownerId, current.policy.id, current.policy.version],
      );
      dirty = true;
    }
    expectedTarget = targets(await state(tx));
    assert.equal(expectedTarget.policy, null);
  });
  await editLegacy('first legacy edit invalidates inherited null/version-zero editor');
  await editLegacy('subsequent legacy edit increments the materialized policy version');
} catch (error) {
  failure = error;
} finally {
  if (before) {
    try {
      await adoptPendingPatch();
      phase = 'restoration';
      const after = await locked(async tx => {
        const current = await state(tx);
        checkTargets(
          current,
          expectedTarget,
          'Configuration changed concurrently; restoration refused to preserve another writer.',
        );
        if (dirty) {
          if (before.settings) {
            await tx.query(
              'INSERT INTO settings ("ownerId",data) VALUES ($1,$2) ON CONFLICT ("ownerId") DO UPDATE SET data=EXCLUDED.data',
              [ownerId, before.settings.data],
            );
          } else await tx.query('DELETE FROM settings WHERE "ownerId"=$1', [ownerId]);
          await tx.query('DELETE FROM "servicePolicies" WHERE "ownerId"=$1 AND "scopeKey"=\'default\'', [ownerId]);
          if (before.policy) {
            const row = before.policy;
            await tx.query(
              `INSERT INTO "servicePolicies" (id,"ownerId","scopeKey","customerCompanyId","calendarJson","slaHoursJson",version,"createdAt","updatedAt")
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [
                row.id,
                row.ownerId,
                row.scopeKey,
                row.customerCompanyId,
                row.calendarJson,
                row.slaHoursJson,
                row.version,
                row.createdAt,
                row.updatedAt,
              ],
            );
          }
        }
        const result = await state(tx);
        checkTargets(result, targets(before), 'Restoration must preserve both original rows byte for byte.');
        return result;
      });
      // Commit restoration before reporting interference with protected rows.
      restored = true;
      checkProtected(after);
    } catch (error) {
      cleanupFailure = error;
    }
  }
  if (owner.cookies.size) {
    try {
      phase = 'session cleanup';
      ok(await api('/api/auth/sign-out', 'POST', {}));
      sessionClosed = true;
    } catch (error) {
      cleanupFailure ||= error;
    }
  }
  await pool.end();
}
if (failure && cleanupFailure)
  throw new AggregateError([failure, cleanupFailure], 'Legacy SLA regression failed; cleanup also needs review.');
if (failure || cleanupFailure) throw failure || cleanupFailure;
assert.ok(restored && sessionClosed, 'Configuration and the private test session must be cleaned up.');
console.log(
  JSON.stringify({
    result: 'PASS',
    checks,
    existingTickets: before.tickets.total,
    ticketRowsSha256: before.tickets.sha256,
    deadlinesAndSnapshotsUnchanged: true,
    settingsAndPolicyRestored: restored,
    notificationsUnchanged: true,
    ownSessionClosed: sessionClosed,
    externalNotifications: 0,
  }),
);
