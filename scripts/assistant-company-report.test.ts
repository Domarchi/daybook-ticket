import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_TRENDS,
  companyReportForModel,
  matchCompany,
  reportMonth,
  validateCompanyReport,
} from '../lib/assistant-company-report';
import type { CompanyOperationalReport } from '../lib/knowledge-model';
import { isChatResponse, isReportOffer, monthLabel } from '../lib/assistant-ui';

const companies = [
  { id: 'a', name: 'Minera Los Andes SpA' },
  { id: 'b', name: 'Constructora Andes Sur' },
  { id: 'c', name: 'Clínica Ñuñoa' },
  { id: 'd', name: 'ACME' },
];

test('the tool input is a company name and an optional month', () => {
  assert.deepEqual(validateCompanyReport({ empresa: ' ACME ' }), { ok: true, value: { empresa: 'ACME', mes: null } });
  assert.deepEqual(validateCompanyReport({ empresa: 'ACME', mes: '2026-10' }), {
    ok: true,
    value: { empresa: 'ACME', mes: '2026-10' },
  });
  assert.equal(validateCompanyReport({ empresa: '' }).ok, false);
  assert.equal(validateCompanyReport({ empresa: 'ACME', mes: 'octubre' }).ok, false);
  assert.equal(validateCompanyReport({ empresa: 'x'.repeat(121) }).ok, false);
  assert.equal(validateCompanyReport('ACME').ok, false);
});

test('the month defaults to the current one in Santiago and is never in the future', () => {
  const now = Date.parse('2026-11-01T02:00:00Z'); // still 31 October in Santiago
  assert.deepEqual(reportMonth(null, now), { ok: true, value: '2026-10' });
  assert.deepEqual(reportMonth('2026-09', now), { ok: true, value: '2026-09' });
  assert.equal(reportMonth('2026-11', now).ok, false);
});

test('the company is found ignoring case and accents; several matches are a question, not a guess', () => {
  assert.deepEqual(matchCompany('acme', companies), { kind: 'one', company: companies[3] });
  assert.deepEqual(matchCompany('clinica nunoa', companies), { kind: 'one', company: companies[2] });
  assert.deepEqual(matchCompany('los andes', companies), { kind: 'one', company: companies[0] });
  const many = matchCompany('andes', companies);
  assert.equal(many.kind, 'many');
  assert.deepEqual(many.kind === 'many' && many.names, ['Minera Los Andes SpA', 'Constructora Andes Sur']);
  const none = matchCompany('Falabella', companies);
  assert.equal(none.kind, 'none');
  assert.equal(matchCompany('Minera Los Andes SpA (Santiago)', companies).kind, 'one');
});

test('the model sees counts and the top types, never the daily rows or the notes', () => {
  const trend = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ label: `Tipo ${index}`, count: count - index }));
  const report = {
    companyId: '00000000-0000-4000-8000-000000000000',
    companyName: 'ACME',
    period: { from: '2026-10-01', to: '2026-10-31', timeZone: 'America/Santiago' },
    generatedAt: '2026-11-12T00:00:00Z',
    summary: {
      created: 12,
      currentOpen: 3,
      currentPending: 1,
      currentOverdue: 2,
      resolutions: 10,
      slaMet: 9,
      slaBreached: 1,
      slaCompliancePercent: 90.04,
      publicReplies: 25,
      unknownResolved: 0,
      untyped: 4,
      withoutAsset: 6,
    },
    byType: trend(8),
    byAsset: trend(2),
    byDay: trend(20),
    coverageNotes: ['nota larga'],
  } as unknown as CompanyOperationalReport;
  const data = companyReportForModel(report, '2026-10');
  assert.equal(data.sla.porcentaje_cumplimiento, 90);
  assert.equal(data.tipos_mas_frecuentes.length, MAX_TRENDS);
  assert.deepEqual(data.carga_actual, { abiertos: 3, pendientes: 1, vencidos: 2 });
  const wire = JSON.stringify(data);
  assert.ok(!wire.includes('byDay') && !wire.includes('nota larga') && !wire.includes(report.companyId));
});

test('the chat only accepts well-formed report offers built by the server', () => {
  const offer = {
    kind: 'company_report',
    companyId: '00000000-0000-4000-8000-000000000000',
    companyName: 'ACME',
    month: '2026-10',
  };
  assert.equal(isReportOffer(offer), true);
  assert.equal(isReportOffer({ ...offer, companyId: '../../api/x' }), false);
  assert.equal(isReportOffer({ ...offer, month: '2026-13' }), false);
  assert.equal(isChatResponse({ reply: 'ok', remaining: 1, limit: 20, actions: [offer] }), true);
  assert.equal(isChatResponse({ reply: 'ok', remaining: 1, limit: 20, actions: [{ kind: 'x' }] }), false);
  assert.equal(monthLabel('2026-10'), 'octubre de 2026');
});
