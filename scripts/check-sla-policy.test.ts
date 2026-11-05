import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import type { AccessContext } from '../lib/access';
import { deleteServicePolicy, deleteServicePolicySchema, saveServicePolicy, saveServicePolicySchema } from '../lib/service-policies';
import {
  addSlaHours, calculateTicketDueAt, createLegacyServicePolicySnapshot,
  readServicePolicySnapshot, serviceCalendarSchema, slaHoursSchema, SlaCalculationError,
  type ServiceCalendar,
} from '../lib/sla-policy';

const hours = { urgent: 4, high: 8, normal: 24, low: 72 };
const office: ServiceCalendar = { mode: 'business', timeZone: 'America/Santiago',
  week: [1, 2, 3, 4, 5].map(day => ({ day, start: '09:00', end: '18:00' })), holidays: [] };
const always = createLegacyServicePolicySnapshot(hours).calendar;
const weekly = (timeZone: string, day: number, start: string, end: string): ServiceCalendar => ({ mode: 'business', timeZone, week: [{ day, start, end }], holidays: [] });

/** Independent minute-by-minute UTC oracle. It does not convert local
 * boundaries or use the implementation's offset/interval arithmetic. */
function minuteOracle(start: string, minutes: number, calendar: ServiceCalendar): string {
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: calendar.timeZone, calendar: 'iso8601', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  let cursor = Date.parse(start), worked = 0;
  for (let guard = 0; guard < 15 * 24 * 60; guard++, cursor += 60_000) {
    const p = Object.fromEntries(formatter.formatToParts(cursor).map(part => [part.type, part.value]));
    const date = `${p.year}-${p.month}-${p.day}`, time = `${p.hour}:${p.minute}`;
    const day = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
    if (!calendar.holidays.includes(date) && calendar.week.some(window => window.day === day && window.start <= time && time < window.end)) worked++;
    if (worked === minutes) return new Date(cursor + 60_000).toISOString();
  }
  throw new Error('Oracle window exhausted');
}

test('legacy 24/7 keeps deadlines, fractional hours, leap dates and milliseconds', () => {
  assert.equal(addSlaHours('2026-11-04T17:14:36.751Z', 2, always), '2026-11-04T19:14:36.751Z');
  assert.equal(addSlaHours('2028-02-28T23:30:00.125Z', 1.25, always), '2028-02-29T00:45:00.125Z');
  assert.equal(addSlaHours('2026-11-08T02:30:00.001Z', 0, office), '2026-11-08T02:30:00.001Z');
  assert.equal(calculateTicketDueAt('2026-11-04T00:00:00.000Z', 'low', createLegacyServicePolicySnapshot(hours)), '2026-11-07T00:00:00.000Z');
});

test('office deadlines skip weekends and start after closed hours', () => {
  assert.equal(addSlaHours('2026-11-06T19:00:00.000Z', 4, office), '2026-11-09T14:00:00.000Z');
  assert.equal(addSlaHours('2026-11-09T02:30:00.000Z', 1, office), '2026-11-09T13:00:00.000Z');
  assert.equal(addSlaHours('2026-11-06T21:00:00.000Z', 1, office), '2026-11-09T13:00:00.000Z');
  assert.equal(addSlaHours('2026-11-06T20:30:00.125Z', 2, office), '2026-11-09T13:30:00.125Z');
});

test('local holidays and split shifts are excluded without postponing an open segment', () => {
  assert.equal(addSlaHours('2026-11-06T19:00:00.000Z', 4, { ...office, holidays: ['2026-11-09'] }), '2026-11-10T14:00:00.000Z');
  const lunch = { ...office, week: [{ day: 3, start: '09:00', end: '13:00' }, { day: 3, start: '14:00', end: '18:00' }] };
  assert.equal(addSlaHours('2026-11-04T15:30:00.000Z', 2, lunch), '2026-11-04T18:30:00.000Z');
  assert.equal(addSlaHours('2026-11-04T15:00:00.000Z', 1, lunch), '2026-11-04T16:00:00.000Z', 'A deadline may equal the closing boundary.');
});

test('Santiago midnight DST skips nonexistent hours and includes repeated open hours', () => {
  const spring = weekly('America/Santiago', 7, '00:00', '02:00');
  assert.equal(addSlaHours('2026-09-06T03:30:00.000Z', 1, spring), '2026-09-06T05:00:00.000Z');
  const autumn = weekly('America/Santiago', 6, '23:00', '24:00');
  assert.equal(addSlaHours('2026-04-05T02:00:00.000Z', 2, autumn), '2026-04-05T04:00:00.000Z');
});

test('DST boundaries inside a shift handle gaps and both occurrences of a repeated hour', () => {
  assert.equal(addSlaHours('2026-03-08T06:00:00.000Z', 2, weekly('America/New_York', 7, '01:00', '04:00')), '2026-03-08T08:00:00.000Z');
  assert.equal(addSlaHours('2026-03-08T06:00:00.000Z', 1, weekly('America/New_York', 7, '02:30', '04:00')), '2026-03-08T08:00:00.000Z');
  assert.equal(addSlaHours('2026-11-01T05:30:00.000Z', 0.75, weekly('America/New_York', 7, '01:30', '02:30')), '2026-11-01T06:45:00.000Z');
  assert.equal(addSlaHours('2026-11-01T05:30:00.000Z', 1.5, weekly('America/New_York', 7, '01:30', '02:30')), '2026-11-01T07:30:00.000Z');
});

test('calendar arithmetic agrees with an independent minute oracle across DST transitions', () => {
  const cases: [string, number, ServiceCalendar][] = [
    ['2026-03-08T06:00:00.000Z', 180, weekly('America/New_York', 7, '01:00', '04:00')],
    ['2026-03-08T06:00:00.000Z', 45, weekly('America/New_York', 7, '02:30', '04:00')],
    ['2026-11-01T05:30:00.000Z', 90, weekly('America/New_York', 7, '01:30', '02:30')],
    ['2026-09-06T03:30:00.000Z', 60, weekly('America/Santiago', 7, '00:00', '02:00')],
    ['2026-04-05T02:00:00.000Z', 120, weekly('America/Santiago', 6, '23:00', '24:00')],
    ['2026-11-06T20:30:00.000Z', 120, office],
  ];
  for (const [start, minutes, calendar] of cases) assert.equal(addSlaHours(start, minutes / 60, calendar), minuteOracle(start, minutes, calendar));
});

test('a full local week is continuously open across DST and a skipped local calendar day', () => {
  for (const [zone, start] of [['America/Santiago', '2026-09-05T20:17:30.125Z'], ['America/New_York', '2026-11-01T00:17:30.125Z'], ['Pacific/Apia', '2011-12-29T20:17:30.125Z']]) {
    const calendar: ServiceCalendar = { mode: 'business', timeZone: zone, week: [1, 2, 3, 4, 5, 6, 7].map(day => ({ day, start: '00:00', end: '24:00' })), holidays: [] };
    assert.equal(addSlaHours(start, 48, calendar), new Date(Date.parse(start) + 48 * 3_600_000).toISOString());
  }
});

test('host time zone does not change a company deadline', () => {
  const previous = process.env.TZ;
  try {
    const answers = ['UTC', 'Pacific/Honolulu', 'Asia/Tokyo'].map(zone => { process.env.TZ = zone; return addSlaHours('2026-11-06T20:30:00.125Z', 2, office); });
    assert.equal(new Set(answers).size, 1);
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('calendar validation rejects ambiguous configuration, invalid dates and unknown fields', () => {
  for (const invalid of [
    { ...office, timeZone: 'Not/A_Zone' }, { ...office, timeZone: '+01:00' },
    { ...office, week: [] }, { ...office, holidays: ['2026-02-30'] }, { ...office, holidays: ['2026-11-04', '2026-11-04'] },
    { ...office, week: [{ day: 1, start: '22:00', end: '02:00' }] },
    { ...office, week: [{ day: 1, start: '24:00', end: '24:00' }] },
    { ...office, week: [{ day: 1, start: '09:00', end: '12:00' }, { day: 1, start: '11:00', end: '15:00' }] },
    { ...office, ownerId: 'another-owner' },
  ]) assert.equal(serviceCalendarSchema.safeParse(invalid).success, false);
  assert.equal(serviceCalendarSchema.safeParse({ ...office, week: [{ day: 1, start: '00:00', end: '24:00' }] }).success, true);
  assert.equal(slaHoursSchema.safeParse({ ...hours, normal: 0 }).success, false);
  assert.equal(slaHoursSchema.safeParse({ ...hours, high: Infinity }).success, false);
});

test('stored snapshots remain independent and invalid snapshots never silently become current policy', () => {
  const input = { ...hours }, policy = createLegacyServicePolicySnapshot(input);
  input.normal = 99;
  assert.equal(policy.slaHours.normal, 24);
  assert.deepEqual(readServicePolicySnapshot(JSON.stringify(policy)), policy);
  for (const invalid of [null, '', '{bad', '{}', { ...policy, version: 2 }, { ...policy, slaHours: { ...hours, urgent: -1 } }]) assert.equal(readServicePolicySnapshot(invalid), null);
});

test('impossible sparse calendars and invalid input terminate with a classified error', () => {
  assert.throws(() => addSlaHours('not-a-date', 4, office), SlaCalculationError);
  assert.throws(() => addSlaHours('2026-11-04T00:00:00Z', NaN, office), SlaCalculationError);
  assert.throws(() => addSlaHours('2026-11-04T00:00:00Z', 8760, weekly('UTC', 1, '09:00', '09:01')), SlaCalculationError);
});

test('policy writes require the observed UUID or explicit inherited null as well as its version', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  for (const expectedId of [null, id]) {
    assert.equal(saveServicePolicySchema.safeParse({ expectedId, expectedVersion: 0, calendar: always, slaHours: hours }).success, true);
    assert.equal(deleteServicePolicySchema.safeParse({ expectedId, expectedVersion: 0 }).success, true);
  }
  for (const expectedId of [undefined, '', 'not-a-uuid', 1]) {
    assert.equal(saveServicePolicySchema.safeParse({ expectedId, expectedVersion: 1, calendar: always, slaHours: hours }).success, false);
    assert.equal(deleteServicePolicySchema.safeParse({ expectedId, expectedVersion: 1 }).success, false);
  }
});

test('a deleted or recreated same-version policy rejects stale saves and deletes before any write', async () => {
  const oldId = '00000000-0000-4000-8000-000000000001', newId = '00000000-0000-4000-8000-000000000002';
  const member = { id: '00000000-0000-4000-8000-000000000003', name: 'Fictitious owner', email: 'owner@example.test', role: 'owner' as const,
    status: 'active' as const, hasAccount: true, customerCompanyId: null, companyAccess: 'own' as const, createdAt: '2026-11-04T00:00:00.000Z', updatedAt: '2026-11-04T00:00:00.000Z' };
  const access: AccessContext = { ownerId: 'fictional-owner', organizationId: 'fictional-org', userId: 'fictional-user', member, role: 'owner' };
  for (const currentId of [null, newId]) {
    const queries: string[] = [];
    const tx = { query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (sql.startsWith('SELECT * FROM members')) return { rows: [{ ...member, ownerId: access.ownerId, organizationId: access.organizationId, userId: access.userId }] };
      if (sql.includes('FROM "servicePolicies"') && sql.endsWith('FOR UPDATE')) return { rows: currentId ? [{ id: currentId, version: 1 }] : [] };
      throw new Error('A stale policy must fail before any data mutation');
    } } as unknown as PoolClient;
    await assert.rejects(saveServicePolicy(tx, access, 'default', { expectedId: oldId, expectedVersion: 1, calendar: always, slaHours: hours }), error => (error as { status?: number }).status === 409);
    await assert.rejects(deleteServicePolicy(tx, access, 'default', { expectedId: oldId, expectedVersion: 1 }), error => (error as { status?: number }).status === 409);
    assert.equal(queries.some(sql => /^(INSERT|UPDATE|DELETE)\b/.test(sql)), false);
  }
});
