/** SERIAL integration test; fictitious rows only, on the explicit isolated QA host.
 * node --env-file=.env.test.local --import tsx scripts/check-reminders-database.mjs
 * Never invoke against production. The coordinator runs this after additive migrations.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Database } from '../db/database.ts';
import {
  enqueueTicketReminder,
  isReminderEligibleForDelivery,
  runNotificationTick,
  getReminderHealth,
} from '../lib/reminders.ts';

assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
assert.ok(process.env.DATABASE_URL && process.env.DAYBOOK_QA_DATABASE_HOST);
const hostname = new URL(process.env.DATABASE_URL).hostname;
assert.equal(hostname, process.env.DAYBOOK_QA_DATABASE_HOST);
assert.ok(!hostname.includes('ep-dawn-moon'), 'Production endpoint is forbidden.');
assert.ok(!process.env.RESEND_API_KEY && !process.env.DAYBOOK_EMAIL_FROM, 'Real mail must be disabled.');
process.env.DAYBOOK_NOTIFICATION_ENVIRONMENT = 'qa';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const database = new Database(pool);
const ownerId = `qa-reminders-${randomUUID()}`;
const orgId = `qa-reminders-${randomUUID()}`;
const agentA = randomUUID(),
  agentB = randomUUID(),
  agentC = randomUUID(),
  client = randomUUID();
const now = new Date();
const at = milliseconds => new Date(now.getTime() + milliseconds).toISOString();
const hour = 3600_000;
const activationAt = at(-5 * hour);
let nextCreation = 0;
async function addMessage(ticketId, authorMemberId, role, kind, createdAt) {
  return (
    await pool.query(
      `INSERT INTO messages ("ownerId","ticketId",author,"authorMemberId","authorRole",body,kind,"createdAt")
    VALUES ($1,$2,'QA ficticio',$3,$4,'Contenido ficticio',$5,$6) RETURNING id`,
      [ownerId, ticketId, authorMemberId, role, kind, createdAt],
    )
  ).rows[0].id;
}
async function ticket(dueAt = at(4 * hour), clientAt = at(-3 * hour)) {
  const id = (
    await pool.query(
      `INSERT INTO tickets ("ownerId","creationKey",subject,"requesterName","requesterEmail","requesterMemberId",department,status,priority,"createdAt","updatedAt","dueAt")
    VALUES ($1,$2,'QA recordatorio','Cliente ficticio','client@example.test',$3,'Soporte','open','normal',$4,$4,$5) RETURNING id`,
      [ownerId, `${ownerId}:${++nextCreation}`, client, clientAt, dueAt],
    )
  ).rows[0].id;
  await addMessage(id, client, 'client', 'request', clientAt);
  return id;
}
async function occurrences(ticketId) {
  return (
    await pool.query('SELECT * FROM "reminderOccurrences" WHERE "ownerId"=$1 AND "ticketId"=$2 ORDER BY sequence', [
      ownerId,
      ticketId,
    ])
  ).rows;
}
const eligible = (row, recipientMemberId = agentA, when = new Date(now.getTime() + 60_000)) =>
  isReminderEligibleForDelivery(
    database,
    { ownerId, ticketId: row.ticketId, recipientMemberId, reminderId: row.id },
    when,
  );

/** Only the fixed organization lookup is redirected, exclusively in this test.
 * Transactions, ticket locks, leases, cursors and outbox SQL use real PostgreSQL.
 * The application's shared organizations.daybook record is never modified.
 */
function workerDatabase(beforeExecute = async () => undefined) {
  const isolated = new Database(pool);
  const execute = isolated.execute.bind(isolated);
  isolated.execute = async (statement, tx) => {
    if (statement.sql === 'SELECT "ownerId" FROM organizations WHERE id=$1') {
      assert.deepEqual(statement.values, ['daybook']);
      return execute(isolated.prepare(statement.sql).bind(orgId), tx);
    }
    await beforeExecute(statement);
    return execute(statement, tx);
  };
  return isolated;
}

try {
  await pool.query(
    'INSERT INTO organizations (id,"ownerId",name,"createdAt") VALUES ($1,$2,\'QA ficticio recordatorios\',$3)',
    [orgId, ownerId, now.toISOString()],
  );
  for (const [id, role] of [
    [agentA, 'agent'],
    [agentB, 'admin'],
    [agentC, 'agent'],
    [client, 'client'],
  ]) {
    await pool.query(
      `INSERT INTO members (id,"organizationId","ownerId","userId",email,name,role,status,"createdAt","updatedAt")
      VALUES ($1,$2,$3,$4,$5,'QA ficticio',$6,'active',$7,$7)`,
      [id, orgId, ownerId, randomUUID(), `${id}@example.test`, role, now.toISOString()],
    );
  }
  await pool.query('INSERT INTO settings ("ownerId",data) VALUES ($1,$2)', [
    ownerId,
    JSON.stringify({ notificationMemberIds: [agentA, agentB, client] }),
  ]);
  await pool.query(
    `INSERT INTO "notificationSettings" ("ownerId","alertsActivatedAt","remindersEnabled","remindersActivatedAt") VALUES ($1,$2,true,$2)`,
    [ownerId, activationAt],
  );

  const first = await ticket();
  const concurrent = await Promise.all(
    Array.from({ length: 4 }, () => enqueueTicketReminder(database, ownerId, first, now)),
  );
  assert.equal(
    concurrent.reduce((sum, value) => sum + value, 0),
    2,
    'Concurrent workers create one grouped event, two active staff recipients.',
  );
  let rows = await occurrences(first);
  assert.equal(rows.length, 1);
  assert.deepEqual(JSON.parse(rows[0].reasonsJson), ['unanswered']);
  const outbox = await pool.query('SELECT * FROM "mailOutbox" WHERE "ownerId"=$1 AND "ticketId"=$2', [ownerId, first]);
  assert.equal(outbox.rows.length, 2);
  assert.ok(outbox.rows.every(row => row.reminderId === rows[0].id && row.event === 'reminder'));
  assert.equal(await eligible(rows[0]), true);
  assert.equal(await eligible(rows[0], client), false, 'Clients can never receive a reminder.');
  assert.equal(
    await eligible(rows[0], agentA, new Date(now.getTime() + 30 * 60_000)),
    false,
    'Unsent occurrence expires after the scheduler grace window.',
  );

  await pool.query('UPDATE tickets SET "assigneeMemberId"=$2 WHERE id=$1', [first, agentC]);
  assert.equal(await eligible(rows[0], agentA), false);
  assert.equal(
    await enqueueTicketReminder(database, ownerId, first, new Date(now.getTime() + 60_000)),
    1,
    'A newly assigned agent gets the current stage without waiting 24 hours.',
  );
  const reassigned = (await occurrences(first))[1];
  assert.deepEqual(JSON.parse(reassigned.recipientMemberIdsJson), [agentC]);
  assert.equal(await eligible(reassigned, agentC), true);
  assert.equal(await enqueueTicketReminder(database, ownerId, first, new Date(now.getTime() + 120_000)), 0);
  await pool.query('UPDATE tickets SET "assigneeMemberId"=NULL WHERE id=$1', [first]);

  await addMessage(first, client, 'client', 'reply', at(-hour));
  await addMessage(first, agentB, 'admin', 'note', at(-30 * 60_000));
  assert.equal(await enqueueTicketReminder(database, ownerId, first, new Date(now.getTime() + 60_000)), 0);
  assert.equal(await eligible(rows[0]), true, 'Client comments do not delay the clock; notes do not close it.');
  await pool.query('UPDATE tickets SET "assigneeMemberId"=$2 WHERE id=$1', [first, agentB]);
  assert.equal(await eligible(rows[0], agentA), false, 'Old unassigned recipients lose eligibility once assigned.');
  assert.equal(await eligible(rows[0], agentB), true);
  await pool.query("UPDATE members SET status='revoked' WHERE id=$1", [agentB]);
  assert.equal(await eligible(rows[0], agentB), false);
  assert.equal(await eligible(rows[0], agentA), true, 'A revoked assignee falls back to configured active staff.');
  await pool.query("UPDATE members SET status='active' WHERE id=$1", [agentB]);
  await addMessage(first, agentB, 'admin', 'reply', at(-1000));
  assert.equal(await eligible(rows[0], agentB), false, 'Public team reply cancels pending unanswered reminder.');
  await addMessage(first, client, 'client', 'reply', at(1000));
  assert.equal(
    await enqueueTicketReminder(database, ownerId, first, new Date(now.getTime() + 2 * hour)),
    0,
    'New burst waits its own full two hours.',
  );
  assert.equal(await enqueueTicketReminder(database, ownerId, first, new Date(now.getTime() + 2 * hour + 1000)), 1);

  const deadlines = await ticket(at(30 * 60_000));
  assert.equal(await enqueueTicketReminder(database, ownerId, deadlines, now), 2);
  rows = await occurrences(deadlines);
  assert.deepEqual(JSON.parse(rows[0].reasonsJson), ['unanswered', 'due_soon']);
  await pool.query('UPDATE tickets SET "dueAt"=$2 WHERE id=$1', [deadlines, at(4 * hour)]);
  assert.equal(await eligible(rows[0]), false, 'Changing the deadline invalidates a frozen grouped reminder.');
  await pool.query('UPDATE tickets SET "dueAt"=$2 WHERE id=$1', [deadlines, at(30 * 60_000)]);
  assert.equal(
    await enqueueTicketReminder(database, ownerId, deadlines, new Date(now.getTime() + 60_000)),
    0,
    'Deadline flapping does not duplicate a stage.',
  );
  const overdueAt = new Date(now.getTime() + 31 * 60_000);
  assert.equal(
    await enqueueTicketReminder(database, ownerId, deadlines, overdueAt),
    2,
    'Overdue escalates once, even shortly after previous reminder.',
  );
  rows = await occurrences(deadlines);
  assert.deepEqual(JSON.parse(rows[1].reasonsJson), ['unanswered', 'overdue']);
  assert.equal(
    await enqueueTicketReminder(database, ownerId, deadlines, new Date(overdueAt.getTime() + 24 * hour - 1)),
    0,
  );
  assert.equal(
    await enqueueTicketReminder(database, ownerId, deadlines, new Date(overdueAt.getTime() + 24 * hour)),
    2,
    'Daily interval counts from the last enqueued escalation.',
  );
  assert.equal(
    await enqueueTicketReminder(database, ownerId, deadlines, new Date(overdueAt.getTime() + 10 * 24 * hour)),
    2,
    'After downtime enqueue one event, never a catch-up storm.',
  );
  assert.equal((await occurrences(deadlines)).length, 4);
  await pool.query("UPDATE tickets SET status='resolved' WHERE id=$1", [deadlines]);
  assert.equal(
    await enqueueTicketReminder(database, ownerId, deadlines, new Date(overdueAt.getTime() + 11 * 24 * hour)),
    0,
  );

  const historic = await ticket(at(-hour), at(-6 * hour));
  assert.equal(
    await enqueueTicketReminder(database, ownerId, historic, now),
    0,
    'Existing backlog is not replayed on activation.',
  );
  await addMessage(historic, client, 'client', 'reply', at(-3 * hour));
  assert.equal(
    await enqueueTicketReminder(database, ownerId, historic, now),
    2,
    'A new client intervention after activation starts eligibility.',
  );
  await pool.query('UPDATE "notificationSettings" SET "remindersEnabled"=false WHERE "ownerId"=$1', [ownerId]);
  assert.equal(await eligible((await occurrences(historic))[0]), false);
  await pool.query(
    'UPDATE "notificationSettings" SET "remindersEnabled"=true,"remindersActivatedAt"=$2 WHERE "ownerId"=$1',
    [ownerId, now.toISOString()],
  );
  assert.equal(
    await enqueueTicketReminder(database, ownerId, historic, now),
    0,
    'Reactivation resets the cutoff without replaying previous client activity.',
  );
  await addMessage(historic, client, 'client', 'reply', at(1000));
  assert.equal(await enqueueTicketReminder(database, ownerId, historic, new Date(now.getTime() + 2 * hour + 1000)), 2);

  await pool.query('UPDATE "notificationSettings" SET "remindersActivatedAt"=$2 WHERE "ownerId"=$1', [
    ownerId,
    activationAt,
  ]);
  const rollback = await ticket();
  const broken = new Database(pool);
  broken.execute = async () => {
    throw new Error('qa-outbox-failure');
  };
  await assert.rejects(enqueueTicketReminder(broken, ownerId, rollback, now), /qa-outbox-failure/);
  assert.equal((await occurrences(rollback)).length, 0, 'Occurrence rolls back when an outbox write fails.');
  assert.equal(
    (
      await pool.query('SELECT count(*)::integer AS n FROM "mailOutbox" WHERE "ownerId"=$1 AND "ticketId"=$2', [
        ownerId,
        rollback,
      ])
    ).rows[0].n,
    0,
  );

  // Exercise the actual worker with real leases and health, without replacing daybook.
  const daybookBefore = (await pool.query('SELECT id,"ownerId" FROM organizations WHERE id=\'daybook\'')).rows;
  await pool.query('UPDATE tickets SET status=\'resolved\' WHERE "ownerId"=$1', [ownerId]);
  const workerTickets = [await ticket(), await ticket(), await ticket()];
  const initialCount = (
    await pool.query('SELECT count(*)::integer AS n FROM "mailOutbox" WHERE "ownerId"=$1', [ownerId])
  ).rows[0].n;
  const cleanWorker = workerDatabase();
  let releaseScan;
  let announceScan;
  const scanReached = new Promise(resolve => {
    announceScan = resolve;
  });
  const scanRelease = new Promise(resolve => {
    releaseScan = resolve;
  });
  let gated = false;
  const gatedWorker = workerDatabase(async statement => {
    if (!gated && statement.sql.startsWith('SELECT id FROM tickets')) {
      gated = true;
      announceScan(); // This query follows the committed lease claim.
      await scanRelease;
    }
  });
  const firstTick = runNotificationTick('qa-worker-one', { database: gatedWorker, maxTickets: 1, now: () => now });
  await Promise.race([
    scanReached,
    firstTick.then(() => {
      throw new Error('Worker completed before reaching the scan gate.');
    }),
  ]);
  let secondTick;
  try {
    const inFlight = (await pool.query('SELECT * FROM "notificationJobHealth" WHERE "ownerId"=$1', [ownerId])).rows[0];
    assert.ok(inFlight.leaseToken && Date.parse(inFlight.leaseUntil) > now.getTime());
    secondTick = await runNotificationTick('qa-worker-concurrent', {
      database: cleanWorker,
      maxTickets: 1,
      now: () => now,
    });
    assert.equal(
      secondTick.skipped,
      true,
      'A committed active lease prevents a concurrent worker from doing ticket work.',
    );
    assert.equal(secondTick.processed, 0);
  } finally {
    releaseScan();
  }
  const firstResult = await firstTick;
  assert.deepEqual([firstResult.processed, firstResult.queued, firstResult.incomplete], [1, 2, true]);
  let health = await getReminderHealth(ownerId, cleanWorker);
  assert.equal(health.cursorTicketId, workerTickets[0]);
  assert.equal(health.lastInvocationId, 'qa-worker-one');
  assert.equal(health.lastSucceededAt, now.toISOString());
  assert.equal(health.leaseUntil, null);
  assert.equal('leaseToken' in health, false, 'Private lease ownership is not exposed in health.');

  const secondResult = await runNotificationTick('qa-worker-two', {
    database: cleanWorker,
    maxTickets: 1,
    now: () => new Date(now.getTime() + 30 * 60_000),
  });
  assert.deepEqual([secondResult.processed, secondResult.queued, secondResult.incomplete], [1, 2, true]);
  assert.equal(
    (await getReminderHealth(ownerId, cleanWorker)).cursorTicketId,
    workerTickets[1],
    'Next invocation resumes from the saved cursor.',
  );
  const thirdResult = await runNotificationTick('qa-worker-three', {
    database: cleanWorker,
    maxTickets: 1,
    now: () => new Date(now.getTime() + hour),
  });
  assert.deepEqual([thirdResult.processed, thirdResult.queued, thirdResult.incomplete], [1, 2, false]);
  assert.equal(
    (await getReminderHealth(ownerId, cleanWorker)).cursorTicketId,
    0,
    'A completed traversal wraps to zero.',
  );
  assert.equal(
    (await pool.query('SELECT count(*)::integer AS n FROM "mailOutbox" WHERE "ownerId"=$1', [ownerId])).rows[0].n,
    initialCount + 6,
  );
  const repeat = await runNotificationTick('qa-worker-three', {
    database: cleanWorker,
    maxTickets: 10,
    now: () => new Date(now.getTime() + hour),
  });
  assert.equal(repeat.queued, 0, 'Repeating a native invocation cannot duplicate already enqueued stages.');

  await pool.query(
    'UPDATE "notificationJobHealth" SET "leaseToken"=\'qa-expired-lease\',"leaseUntil"=$2,"cursorTicketId"=2147483647 WHERE "ownerId"=$1',
    [ownerId, at(-1)],
  );
  const recovered = await runNotificationTick('qa-worker-expired-recovery', {
    database: cleanWorker,
    maxTickets: 1,
    now: () => new Date(now.getTime() + hour),
  });
  assert.equal(recovered.skipped, false, 'An expired process lease is recoverable.');
  assert.equal(recovered.processed, 1, 'An obsolete cursor beyond the last ticket safely wraps.');
  assert.equal(recovered.queued, 0);
  health = await getReminderHealth(ownerId, cleanWorker);
  assert.equal(health.lastInvocationId, 'qa-worker-expired-recovery');
  assert.equal(health.leaseUntil, null);

  // A ten-day interruption is one grouped event per current recipient, not a replay.
  await pool.query('UPDATE "notificationJobHealth" SET "cursorTicketId"=0 WHERE "ownerId"=$1', [ownerId]);
  const late = await runNotificationTick('qa-worker-after-downtime', {
    database: cleanWorker,
    maxTickets: 10,
    now: () => new Date(now.getTime() + 10 * 24 * hour),
  });
  assert.deepEqual([late.processed, late.queued], [3, 6]);
  for (const id of workerTickets) {
    const history = await occurrences(id);
    assert.equal(history.length, 2);
    assert.deepEqual(JSON.parse(history[1].reasonsJson), ['unanswered', 'overdue']);
  }
  assert.equal(
    (
      await runNotificationTick('qa-worker-after-downtime-repeat', {
        database: cleanWorker,
        maxTickets: 10,
        now: () => new Date(now.getTime() + 10 * 24 * hour + 30 * 60_000),
      })
    ).queued,
    0,
  );

  // Worker failure after INSERT occurrence must roll back both data rows and release its job lease.
  await pool.query('UPDATE tickets SET status=\'resolved\' WHERE "ownerId"=$1', [ownerId]);
  const failedTicket = await ticket();
  const failingWorker = workerDatabase(async statement => {
    if (statement.sql.startsWith('INSERT INTO "mailOutbox"')) throw new Error('qa-worker-outbox-failure');
  });
  const failureAt = new Date(now.getTime() + 2 * hour);
  await assert.rejects(
    runNotificationTick('qa-worker-failure', { database: failingWorker, maxTickets: 1, now: () => failureAt }),
    /qa-worker-outbox-failure/,
  );
  assert.equal((await occurrences(failedTicket)).length, 0);
  assert.equal(
    (
      await pool.query('SELECT count(*)::integer AS n FROM "mailOutbox" WHERE "ownerId"=$1 AND "ticketId"=$2', [
        ownerId,
        failedTicket,
      ])
    ).rows[0].n,
    0,
  );
  health = await getReminderHealth(ownerId, cleanWorker);
  assert.equal(health.lastErrorCode, 'tick_failed');
  assert.equal(health.lastFailedAt, failureAt.toISOString());
  assert.equal(health.leaseUntil, null);
  assert.equal(health.lastInvocationId, 'qa-worker-failure');
  assert.equal(
    (await pool.query('SELECT "leaseToken" FROM "notificationJobHealth" WHERE "ownerId"=$1', [ownerId])).rows[0]
      .leaseToken,
    null,
  );
  const afterFailure = await runNotificationTick('qa-worker-recovered', {
    database: cleanWorker,
    maxTickets: 1,
    now: () => new Date(failureAt.getTime() + 30 * 60_000),
  });
  assert.equal(afterFailure.queued, 2);
  health = await getReminderHealth(ownerId, cleanWorker);
  assert.equal(health.lastErrorCode, null);
  assert.equal(
    health.lastFailedAt,
    failureAt.toISOString(),
    'Last failure remains available as history after successful recovery.',
  );
  assert.equal(health.lastInvocationId, 'qa-worker-recovered');

  await pool.query('UPDATE "notificationJobHealth" SET "lastSucceededAt"=$2 WHERE "ownerId"=$1', [
    ownerId,
    new Date(Date.now() - 66 * 60_000).toISOString(),
  ]);
  assert.equal((await getReminderHealth(ownerId, cleanWorker)).stale, true);
  await pool.query('UPDATE "notificationJobHealth" SET "lastSucceededAt"=$2 WHERE "ownerId"=$1', [
    ownerId,
    new Date().toISOString(),
  ]);
  assert.equal((await getReminderHealth(ownerId, cleanWorker)).stale, false);
  const unstarted = await getReminderHealth(`qa-missing-${randomUUID()}`, cleanWorker);
  assert.equal(unstarted.lastStartedAt, null);
  assert.equal(unstarted.stale, true);
  assert.equal(typeof unstarted.configured, 'boolean');
  assert.deepEqual(
    (await pool.query('SELECT id,"ownerId" FROM organizations WHERE id=\'daybook\'')).rows,
    daybookBefore,
    'The shared Daybook organization is unchanged.',
  );

  console.log(
    'QA recordatorios: permisos, relojes, transacciones y etapas; worker real: lease concurrente, cursor, recuperación, fallo/rollback, salud y ausencia de catch-up verificados con datos ficticios.',
  );
} finally {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    for (const table of [
      'mailDeliveryEvents',
      'pushDeliveries',
      'mailOutbox',
      'inboundMailReceipts',
      'ticketSatisfaction',
      'escalationOccurrences',
      'reminderOccurrences',
      'ticketEvents',
      'attachments',
      'messages',
      'ticketSlaOutcomes',
      'tickets',
      'escalationSettings',
      'notificationJobHealth',
      'notificationSettings',
      'settings',
      'members',
    ]) {
      await tx.query(`DELETE FROM "${table}" WHERE "ownerId"=$1`, [ownerId]);
    }
    await tx.query('DELETE FROM organizations WHERE id=$1 AND "ownerId"=$2', [orgId, ownerId]);
    await tx.query('COMMIT');
    assert.equal(
      (await tx.query('SELECT count(*)::integer AS n FROM tickets WHERE "ownerId"=$1', [ownerId])).rows[0].n,
      0,
    );
    assert.equal(
      (await tx.query('SELECT count(*)::integer AS n FROM organizations WHERE id=$1', [orgId])).rows[0].n,
      0,
    );
  } catch (error) {
    await tx.query('ROLLBACK');
    throw error;
  } finally {
    tx.release();
    await pool.end();
  }
}
