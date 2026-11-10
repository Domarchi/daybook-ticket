import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readAllConversationPages } from './qa-paged-read.mjs';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
assert.equal(process.env.DAYBOOK_SITE_URL, 'http://127.0.0.1:5173');
assert.equal(
  new URL(process.env.DATABASE_URL).hostname,
  'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech',
);
assert.equal(process.env.DAYBOOK_BLOB_ENV, 'qa');
assert.ok(process.env.DAYBOOK_BLOB_QA_READ_WRITE_TOKEN && !process.env.DAYBOOK_BLOB_PRODUCTION_READ_WRITE_TOKEN);
const fixture = JSON.parse(await readFile('work/team-release-qa.json', 'utf8'));
const { owner } = fixture,
  origin = fixture.origin;
async function request(person, path, method = 'GET', body) {
  return fetch(origin + path, {
    method,
    headers: {
      origin,
      'x-vercel-forwarded-for': person.ip,
      cookie: Object.entries(person.cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function api(person, path, method = 'GET', body, expected = 200) {
  const response = await request(person, path, method, body);
  const text = await response.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${path}: HTTP ${response.status}, non-JSON response (${text.length} bytes)`);
  }
  assert.equal(response.status, expected, `${path}: ${value.error || response.status}`);
  return value;
}
const agent = fixture.agent;
const note = { operationId: randomUUID(), body: 'Regresión de replay privado tras cambio de rol.', kind: 'note' };
await api(agent, `/api/tickets/${fixture.ticketId}/messages`, 'POST', note, 201);
try {
  await api(owner, `/api/members/${agent.id}`, 'PATCH', {
    role: 'client',
    customerCompanyId: fixture.companyA,
    companyAccess: 'manager',
  });
  await api(agent, `/api/tickets/${fixture.ticketId}/messages`, 'POST', note, 403);
  const feed = await api(agent, '/api/tickets/updates');
  assert.deepEqual(feed.messages, []);
  const messages = await readAllConversationPages(path => api(agent, path), fixture.ticketId);
  assert.ok(messages.every(m => m.kind !== 'note' && m.body !== note.body));
} finally {
  await api(owner, `/api/members/${agent.id}`, 'PATCH', {
    role: 'agent',
    customerCompanyId: null,
    companyAccess: 'own',
  });
}
console.log(
  JSON.stringify({
    result: 'PASS',
    checks: ['cached-internal-note-denied-after-role-downgrade', 'private-note-not-in-feed', 'agent-restored'],
  }),
);
