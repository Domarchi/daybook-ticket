import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import {
  AgentMetricsReport,
  MetricsQueryError,
  agentMetricsCsv,
  metricsCsvCell,
  metricsDayStart,
  parseMetricsQuery,
} from '../lib/agent-metrics-model';
import { getAgentMetrics, recordSlaOutcome } from '../lib/agent-metrics';
import type { AccessContext } from '../lib/access';

const now = new Date('2026-11-04T19:00:00.000Z');
test('metrics date filters use Santiago civil days, including both DST transitions', () => {
  assert.equal(metricsDayStart('2026-11-04'), '2026-11-04T03:00:00.000Z');
  assert.equal((Date.parse(metricsDayStart('2026-09-07')) - Date.parse(metricsDayStart('2026-09-06'))) / 3600_000, 23);
  assert.equal((Date.parse(metricsDayStart('2026-04-05')) - Date.parse(metricsDayStart('2026-04-04'))) / 3600_000, 25);
  const query = parseMetricsQuery(new URLSearchParams('from=2026-09-06&to=2026-09-06'), now);
  assert.equal(query.fromInstant, '2026-09-06T04:00:00.000Z');
  assert.equal(query.untilInstant, '2026-09-07T03:00:00.000Z');
});

test('metrics default period is thirty local calendar days and every filter is bounded', () => {
  const period = parseMetricsQuery(new URLSearchParams(), now);
  assert.equal(period.from, '2026-10-06');
  assert.equal(period.to, '2026-11-04');
  assert.equal(
    parseMetricsQuery(new URLSearchParams(), new Date('2026-11-05T02:30:00Z')).to,
    '2026-11-04',
    'UTC has already advanced a date, Santiago has not',
  );
  for (const input of [
    'to=garbage',
    'from=2026-02-30&to=2026-03-01',
    'from=2026-11-04&to=2026-11-03',
    'to=2026-11-05',
    'from=2024-01-01&to=2026-11-04',
    'from=2026-11-01&from=2026-11-02',
    'companyId=bad',
    'ownerId=other',
  ])
    assert.throws(() => parseMetricsQuery(new URLSearchParams(input), now), MetricsQueryError, input);
  assert.doesNotThrow(() => parseMetricsQuery(new URLSearchParams('from=2025-11-04&to=2026-11-04'), now));
});

test('CSV cells neutralize spreadsheet formulas and preserve quotes and unknown measurements', () => {
  for (const input of ['=SUM(A1)', '+cmd', '-1', '@X', '\tcommand', '  =1'])
    assert.ok(metricsCsvCell(input).startsWith('"\''));
  assert.equal(metricsCsvCell('Ana "A"'), '"Ana ""A"""');
  assert.equal(metricsCsvCell(null), '""');
  const report: AgentMetricsReport = {
    period: { ...parseMetricsQuery(new URLSearchParams(), now), timeZone: 'America/Santiago' },
    generatedAt: now.toISOString(),
    coverage: {
      unknownPublicReplies: 0,
      unknownFirstResponseTickets: 0,
      unattributedResolutions: 0,
      historicalResolvedWithoutMeasurement: 1,
    },
    agents: [
      {
        memberId: 'a',
        name: '=DANGER()',
        role: 'agent',
        status: 'active',
        currentOpen: 1,
        currentPending: 0,
        publicReplies: 0,
        firstResponseCount: 0,
        averageFirstResponseHours: null,
        resolutions: 0,
        measurableResolutions: 0,
        averageResolutionHours: null,
        slaMet: 0,
        slaBreached: 0,
        slaCompliancePercent: null,
      },
    ],
  };
  const csv = agentMetricsCsv(report);
  assert.ok(csv.includes('America/Santiago'));
  assert.ok(csv.includes('"\'=DANGER()"'));
  assert.ok(csv.includes(',"","0","0",""'));
});

test('metrics deny a client or agent before any database query', async () => {
  const tx = {
    query: () => {
      throw new Error('A forbidden metrics request must not query data');
    },
  } as unknown as PoolClient;
  for (const role of ['client', 'agent'])
    await assert.rejects(
      getAgentMetrics(tx, { role } as AccessContext, parseMetricsQuery(new URLSearchParams(), now)),
      error => (error as { status?: number }).status === 403,
    );
});

test('recorded outcomes reject impossible clocks and cannot attach to another tenant', async () => {
  const input = {
    ownerId: 'owner',
    ticketId: 1,
    actorMemberId: 'actor',
    startedAt: '2026-11-04T12:00:00.000Z',
    dueAt: '2026-11-04T16:00:00.000Z',
    resolvedAt: '2026-11-04T15:00:00.000Z',
    customerCompanyId: null,
    policySnapshot: null,
  };
  let calls = 0;
  const tx = {
    query: async () => {
      calls++;
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PoolClient;
  await assert.rejects(
    recordSlaOutcome(tx, { ...input, startedAt: '2026-11-04T16:00:00.000Z' }),
    error => (error as { status?: number }).status === 400,
  );
  assert.equal(calls, 0);
  await assert.rejects(recordSlaOutcome(tx, input), error => (error as { status?: number }).status === 400);
  assert.equal(calls, 1);
});
