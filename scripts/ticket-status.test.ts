import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  isFinished,
  isTicketQueue,
  statusChangeProblem,
  statusLabel,
  statusLabelCoarse,
  statusOptions,
  statusView,
} from '../lib/ticket-status';
import { ticketStatus } from '../lib/server';
import { savedViewFiltersSchema } from '../lib/work-organization-model';
import { normalizeTeamFilters } from '../hooks/use-team-filters';

test('the four visible states come from the stored status and whether someone is responsible', () => {
  assert.equal(statusView({ status: 'open', assigneeMemberId: null }), 'unassigned');
  assert.equal(statusView({ status: 'open', assigneeMemberId: 'm1' }), 'in_progress');
  assert.equal(statusView({ status: 'resolved', assigneeMemberId: null }), 'resolved');
  assert.equal(statusView({ status: 'closed', assigneeMemberId: 'm1' }), 'closed');
  assert.equal(statusLabel({ status: 'open', assigneeMemberId: null }), 'Sin asignar');
  assert.equal(statusLabel({ status: 'open', assigneeMemberId: 'm1' }), 'En proceso');
  assert.equal(statusLabel({ status: 'resolved' }), 'Solucionado');
  assert.equal(statusLabel({ status: 'closed' }), 'Cerrado');
  assert.equal(statusLabelCoarse('open'), 'Abierto');
  assert.equal(statusLabelCoarse('closed'), 'Cerrado');
});

test('the retired "En espera" is read as open work and is never written again', () => {
  assert.equal(statusLabel({ status: 'pending', assigneeMemberId: null }), 'Sin asignar');
  assert.equal(statusLabel({ status: 'pending', assigneeMemberId: 'm1' }), 'En proceso');
  assert.equal(isFinished('pending'), false);
  assert.equal(ticketStatus.parse('pending'), 'open', 'a tab opened before the change still works');
  assert.equal(ticketStatus.parse('closed'), 'closed');
  assert.throws(() => ticketStatus.parse('waiting'));
});

test('closing follows solving, and a closed ticket only goes back to open', () => {
  assert.equal(statusChangeProblem('resolved', 'closed'), null);
  assert.match(String(statusChangeProblem('open', 'closed')), /solucionado/);
  assert.match(String(statusChangeProblem('pending', 'closed')), /solucionado/);
  assert.equal(statusChangeProblem('closed', 'open'), null);
  assert.match(String(statusChangeProblem('closed', 'resolved')), /reabrirse/);
  assert.equal(statusChangeProblem('open', 'resolved'), null);
  assert.equal(statusChangeProblem('resolved', 'open'), null);
  assert.equal(statusChangeProblem('closed', 'closed'), null);
});

test('the status control offers only the moves that are allowed', () => {
  const values = (status: string, assigneeMemberId: string | null = null) =>
    statusOptions({ status, assigneeMemberId }).map(option => `${option.value}:${option.label}`);
  assert.deepEqual(values('open'), ['open:Sin asignar', 'resolved:Solucionado']);
  assert.deepEqual(values('open', 'm1'), ['open:En proceso', 'resolved:Solucionado']);
  assert.deepEqual(values('resolved'), ['open:Sin asignar', 'resolved:Solucionado', 'closed:Cerrado']);
  assert.deepEqual(values('closed', 'm1'), ['open:En proceso', 'closed:Cerrado']);
});

test('queues: the new ones are accepted and saved filters with the old ones still load', () => {
  for (const queue of ['all', 'unassigned', 'inprogress', 'resolved', 'closed', 'mine', 'overdue', 'open', 'pending'])
    assert.equal(isTicketQueue(queue), true, queue);
  assert.equal(isTicketQueue('waiting'), false);
  assert.equal(savedViewFiltersSchema.parse({ queue: 'pending' }).queue, 'pending');
  assert.equal(savedViewFiltersSchema.parse({ queue: 'closed' }).queue, 'closed');
  assert.equal(normalizeTeamFilters({ queue: 'pending' }).queue, 'all');
  assert.equal(normalizeTeamFilters({ queue: 'open' }).queue, 'all');
  assert.equal(normalizeTeamFilters({ queue: 'inprogress' }).queue, 'inprogress');
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test('no query treats only "resolved" as finished: closed tickets would count as open work', () => {
  const offenders = ['lib', 'app']
    .flatMap(dir => sourceFiles(dir))
    .flatMap(path =>
      readFileSync(path, 'utf8')
        .split('\n')
        .map((line, index) => ({ path, line: index + 1, text: line }))
        .filter(({ text }) => /status\s*<>\s*'resolved'|status\s*!==\s*'resolved'/.test(text)),
    )
    .map(({ path, line }) => `${path}:${line}`)
    // The satisfaction survey is created at the very moment a ticket is solved, so there "resolved" is exact.
    .filter(place => !place.startsWith('lib/satisfaction.ts:'));
  assert.deepEqual(offenders, []);
});

test('screens no longer offer "En espera" or call a ticket "Resuelto"', () => {
  const offenders = sourceFiles('app')
    .filter(path => !path.includes('/api/'))
    .filter(path =>
      /'En espera'|"En espera"|>\s*En espera|'Resuelto'|'Marcar resuelto'/.test(readFileSync(path, 'utf8')),
    );
  assert.deepEqual(offenders, []);
});
