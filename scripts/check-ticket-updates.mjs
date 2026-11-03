/** Focused ticket-feed checks against the isolated QA database only.
 * Run: node --env-file=.env.test.local scripts/check-ticket-updates.mjs
 * After opening the saved ticket in a local browser:
 *   node --env-file=.env.test.local scripts/check-ticket-updates.mjs --send-as-client
 *   node --env-file=.env.test.local scripts/check-ticket-updates.mjs --send-as-owner
 * An optional second argument supplies the test message. Browser credentials and
 * HTTP cookies are stored only in the ignored work/ directory with mode 0600.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const expectedQaHost = 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech';
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1', 'QA requires explicit isolated-database opt-in.');
assert.ok(process.env.DATABASE_URL && process.env.DAYBOOK_SITE_URL, 'Load .env.test.local before running QA.');
assert.equal(new URL(process.env.DATABASE_URL).hostname, expectedQaHost, 'Only the dedicated QA branch is allowed.');
assert.equal(process.env.DAYBOOK_QA_DATABASE_HOST, expectedQaHost, 'The expected QA hostname must match.');
assert.ok(!process.env.RESEND_API_KEY && !process.env.DAYBOOK_EMAIL_FROM, 'Email must remain disabled during QA.');
const origin = new URL(process.env.DAYBOOK_SITE_URL).origin;
assert.equal(origin, 'http://127.0.0.1:5173', 'Use the local QA app on port 5173.');
const ownerEmail = process.env.DAYBOOK_QA_OWNER_EMAIL || process.env.DAYBOOK_OWNER_EMAIL;
assert.ok(ownerEmail?.endsWith('@example.test'), 'The QA owner must use a fictitious email.');
const fixtureDirectory = new URL('../work/', import.meta.url);
const fixtureFile = new URL('ticket-updates-qa.json', fixtureDirectory);
let nextTestAddress = 120;

function actor(email, password) {
  return { email, password, cookies: {}, testIp: `192.0.2.${nextTestAddress++}` };
}

async function api(person, path, method = 'GET', body, extraHeaders = {}) {
  const cookie = Object.entries(person.cookies).map(([name, value]) => `${name}=${value}`).join('; ');
  const response = await fetch(`${origin}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      'x-vercel-forwarded-for': person.testIp,
      ...(cookie ? { cookie } : {}),
      ...(method !== 'GET' ? { origin } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const line of response.headers.getSetCookie()) {
    const [entry] = line.split(';');
    const divider = entry.indexOf('=');
    const name = entry.slice(0, divider), value = entry.slice(divider + 1);
    if (value) person.cookies[name] = value;
    else delete person.cookies[name];
  }
  const result = await response.json().catch(() => ({}));
  return { status: response.status, cacheControl: response.headers.get('cache-control'), body: result };
}

function expectStatus(result, expected, label) {
  // Do not include response bodies: invitations contain private activation URLs.
  assert.equal(result.status, expected, `${label}: HTTP ${result.status}, expected ${expected}`);
  return result.body;
}

async function feed(person, status = 200) {
  const result = await api(person, '/api/tickets/updates');
  const body = expectStatus(result, status, 'Ticket feed');
  assert.ok(result.cacheControl?.includes('no-store'), 'Ticket feed responses must not be cached.');
  return body;
}

async function saveFixture(fixture) {
  await mkdir(fixtureDirectory, { recursive: true, mode: 0o700 });
  await writeFile(fixtureFile, `${JSON.stringify(fixture, null, 2)}\n`, { mode: 0o600 });
  await chmod(fixtureFile, 0o600);
}

const mode = process.argv[2];
if (mode) {
  assert.ok(['--send-as-client', '--send-as-owner'].includes(mode), 'Unsupported QA action.');
  const fixture = JSON.parse(await readFile(fixtureFile, 'utf8'));
  assert.equal(fixture.origin, origin);
  assert.equal(fixture.databaseHost, expectedQaHost);
  const sender = mode === '--send-as-client' ? fixture.client : fixture.owner;
  assert.ok(sender.email.endsWith('@example.test'), 'Only a fictitious QA sender is allowed.');
  const current = await feed(sender);
  assert.equal(current.viewer.email, sender.email.toLowerCase());
  assert.ok(current.tickets.some(ticket => ticket.id === fixture.ticketId), 'The QA ticket must still be accessible.');
  const message = process.argv[3] || `Actualización automática del ${mode === '--send-as-client' ? 'cliente' : 'equipo'} QA ${new Date().toISOString()}`;
  const result = expectStatus(await api(sender, `/api/tickets/${fixture.ticketId}/messages`, 'POST', { body: message, kind: 'reply' }), 201, 'Send QA peer message');
  await saveFixture(fixture);
  console.log(JSON.stringify({ role: current.viewer.role, ticketId: fixture.ticketId, messageId: result.message.id, message }));
} else {
  const runId = `${Date.now()}-${randomUUID().slice(0, 6)}`;
  const owner = actor(ownerEmail, process.env.DAYBOOK_QA_OWNER_PASSWORD || 'Local-QA-only!Daybook-2026');
  const anonymous = actor('', '');
  await feed(anonymous, 401);

  // Reuse the pre-existing QA owner. Never provision or reset an existing owner.
  expectStatus(await api(owner, '/api/auth/sign-in/email', 'POST', { email: owner.email, password: owner.password }), 200, 'Existing QA owner login');
  const workspace = expectStatus(await api(owner, '/api/workspace'), 200, 'QA workspace');
  assert.equal(workspace.viewer.role, 'owner');
  assert.equal(workspace.viewer.email, ownerEmail);
  assert.equal(workspace.mailStatus?.configured, false, 'The target app must also have email disabled.');

  async function createClient(label) {
    const client = actor(`updates-${label.toLowerCase()}-${runId}@example.test`, `Qa-updates-${randomUUID()}!`);
    const invitation = expectStatus(await api(owner, '/api/members', 'POST', { name: `QA ${label}`, email: client.email, role: 'client' }), 201, 'Invite fictitious client');
    client.memberId = invitation.member.id;
    const token = new URL(invitation.invitationUrl).searchParams.get('invite');
    assert.ok(token, 'A new QA client needs an invitation token.');
    expectStatus(await api(client, '/api/auth/sign-up/email', 'POST', { email: client.email, password: client.password, name: `QA ${label}` }, { 'x-daybook-invite': token }), 200, 'Activate QA client');
    assert.equal((await feed(client)).viewer.role, 'client');
    return client;
  }

  const client = await createClient('Cliente');
  const otherClient = await createClient('Aislamiento');
  const createTicket = async (person, subject, body) => expectStatus(await api(person, '/api/tickets', 'POST', { subject, body, department: workspace.settings.departments[0], priority: 'normal' }), 201, 'Create QA ticket').ticket;
  const ticket = await createTicket(client, `QA conversación automática ${runId}`, 'Solicitud de prueba para comprobar actualizaciones automáticas.');
  const otherTicket = await createTicket(otherClient, `QA ticket ajeno ${runId}`, `Mensaje del cliente ajeno ${runId}`);
  const clientMessage = `Seguimiento público del cliente ${runId}`;
  const ownerMessage = `Respuesta pública del equipo ${runId}`;
  const internalNote = `Nota interna del equipo ${runId}`;
  expectStatus(await api(client, `/api/tickets/${ticket.id}/messages`, 'POST', { body: clientMessage, kind: 'reply' }), 201, 'Client follow-up');
  const ownerFeed = await feed(owner);
  assert.ok(ownerFeed.tickets.some(item => item.id === ticket.id));
  assert.ok(ownerFeed.messages.some(item => item.ticketId === ticket.id && item.body === clientMessage));
  expectStatus(await api(owner, `/api/tickets/${ticket.id}/messages`, 'POST', { body: ownerMessage, kind: 'reply' }), 201, 'Owner reply');
  expectStatus(await api(owner, `/api/tickets/${ticket.id}/messages`, 'POST', { body: internalNote, kind: 'note' }), 201, 'Owner internal note');
  const clientFeed = await feed(client);
  assert.equal(clientFeed.viewer.id, client.memberId);
  assert.ok(clientFeed.tickets.some(item => item.id === ticket.id));
  assert.ok(clientFeed.messages.some(item => item.ticketId === ticket.id && item.body === ownerMessage));
  assert.ok(!clientFeed.tickets.some(item => item.id === otherTicket.id), 'A client cannot see another client ticket.');
  assert.ok(!clientFeed.messages.some(item => item.ticketId === otherTicket.id || item.kind === 'note' || item.body === internalNote), 'A client cannot see another client messages or internal notes.');
  assert.deepEqual(Object.keys(clientFeed).sort(), ['messages', 'tickets', 'viewer'], 'Polling must not load unrelated workspace data.');
  const otherFeed = await feed(otherClient);
  assert.ok(!otherFeed.tickets.some(item => item.id === ticket.id));
  assert.ok(!otherFeed.messages.some(item => item.ticketId === ticket.id));
  assert.ok((await feed(owner)).messages.some(item => item.body === internalNote), 'Staff retains internal-note access.');
  expectStatus(await api(owner, `/api/members/${otherClient.memberId}`, 'PATCH', { status: 'revoked' }), 200, 'Revoke second QA client');
  await feed(otherClient, 403);
  // Keep the primary client active for the browser proof of incoming messages.
  const fixture = { origin, databaseHost: expectedQaHost, createdAt: new Date().toISOString(), ticketId: ticket.id, ticketSubject: ticket.subject, owner, client };
  await saveFixture(fixture);
  console.log(JSON.stringify({ result: 'passed', checks: ['unauthenticated', 'no-store', 'client-to-staff', 'staff-to-client', 'private-notes', 'client-isolation', 'revoked-session'], ticketId: ticket.id, ticketSubject: ticket.subject, fixtureFile: fileURLToPath(fixtureFile) }));
}
