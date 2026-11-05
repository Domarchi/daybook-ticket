import assert from 'node:assert/strict';
import test from 'node:test';
import { isTestTicket, productionTicketSql } from '../lib/test-data';
import { parseMetricsQuery } from '../lib/agent-metrics-model';

test('test designation is explicit, reversible and independent of names/addresses', () => {
  const ticket = { requesterMemberId: 'client', subject: 'PRUEBA TEST demo', isTest: false };
  assert.equal(isTestTicket(ticket, [{ id: 'client', isTest: false }]), false);
  assert.equal(isTestTicket(ticket, [{ id: 'client', isTest: true }]), true);
  assert.equal(isTestTicket({ ...ticket, isTest: true, requesterMemberId: null }, []), true);
  assert.equal(isTestTicket(ticket, [{ id: 'other', isTest: true }]), false);
  assert.match(productionTicketSql('t'), /test_requester\."ownerId"=t\."ownerId"/);
  assert.throws(() => productionTicketSql('t; DROP'), /alias/);
});

test('metrics omit tests by default and accept one exact explicit boolean', () => {
  assert.equal(parseMetricsQuery(new URLSearchParams()).includeTests, undefined);
  assert.equal(parseMetricsQuery(new URLSearchParams('includeTests=true')).includeTests, true);
  assert.equal(parseMetricsQuery(new URLSearchParams('includeTests=false')).includeTests, false);
  for (const params of ['includeTests=1', 'includeTests=TRUE', 'includeTests=true&includeTests=false']) assert.throws(() => parseMetricsQuery(new URLSearchParams(params)));
});
