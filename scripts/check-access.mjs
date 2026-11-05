/** End-to-end RBAC checks against a local app and an isolated PostgreSQL test branch.
 * Creates fictitious accounts/tickets and uses real Daybook sessions. The expected
 * database host and explicit test opt-in are mandatory. Never point at production.
 * Run: node --env-file=.env.test.local --import tsx scripts/check-access.mjs http://127.0.0.1:5173
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { provisionOwner } from './provision-owner.mjs';
import { readAllTicketPages, readAllConversationPages } from './qa-paged-read.mjs';
import { safeTicketReturnPath, ticketReturnPath, ticketLoginPath } from '../lib/return-path.ts';
assert.equal(ticketReturnPath('42'), '/?ticket=42');
assert.equal(ticketLoginPath('/?ticket=42'), '/login?return_to=%2F%3Fticket%3D42');
for (const value of [null, ['42'], '0', '-1', '1.5', '9007199254740992']) assert.equal(ticketReturnPath(value), '/');
for (const value of ['//example.test', 'https://example.test', '/?ticket=42&next=https://example.test', '/?ticket=42#external', '/login', '/?ticket=0']) assert.equal(safeTicketReturnPath(value), '/');
const origin = new URL(process.argv[2] || 'http://127.0.0.1:5173').origin;
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Esta prueba solo admite una vista previa local.');
assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1', 'Autoriza explícitamente una base de pruebas aislada.');
assert.ok(process.env.DATABASE_URL && process.env.DAYBOOK_QA_DATABASE_HOST, 'Falta la conexión y el hostname esperado de la rama de pruebas.');
assert.equal(new URL(process.env.DATABASE_URL).hostname, process.env.DAYBOOK_QA_DATABASE_HOST, 'La conexión debe apuntar exactamente a la rama de pruebas.');
assert.equal(process.env.DAYBOOK_QA_DATABASE_HOST, 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
assert.equal(new URL(process.env.DAYBOOK_SITE_URL).origin, origin, 'La URL de la app de prueba debe coincidir con el origen local.');
assert.ok(!process.env.RESEND_API_KEY && !process.env.DAYBOOK_EMAIL_FROM, 'El correo debe estar desactivado durante QA.');
const database = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const runId = `${Date.now()}-${randomUUID().slice(0, 6)}`;
const ownerEmail = process.env.DAYBOOK_QA_OWNER_EMAIL || process.env.DAYBOOK_OWNER_EMAIL;
assert.ok(ownerEmail?.endsWith('@example.test'), 'El propietario QA debe usar un correo ficticio @example.test.');
const ownerPassword = process.env.DAYBOOK_QA_OWNER_PASSWORD || 'Local-QA-only!Daybook-2026';
const owner = { cookies: new Map() };
const anonymous = { cookies: new Map() };
const operationIds = new Set(), ticketIds = new Set(), memberIds = new Set(), articleIds = new Set();
let nextTestAddress = 1;
function updateCookies(actor, response) {
  for (const line of response.headers.getSetCookie()) {
    const [entry] = line.split(';');
    const split = entry.indexOf('=');
    const name = entry.slice(0, split), value = entry.slice(split + 1);
    if (value) actor.cookies.set(name, value); else actor.cookies.delete(name);
  }
}
async function api(actor, path, method = 'GET', body, extraHeaders = {}) {
  if (body && method === 'POST' && (path === '/api/tickets' || /^\/api\/tickets\/\d+\/messages$/.test(path))) {
    body = { ...body, operationId: body.operationId ?? randomUUID() };
    operationIds.add(body.operationId);
  }
  if (body && method === 'PATCH' && /^\/api\/tickets\/\d+$/.test(path) && ('assigneeMemberId' in body || 'assignee' in body) && body.expectedVersion === undefined) {
    const row = (await database.query('SELECT version FROM tickets WHERE id=$1', [Number(path.split('/').at(-1))])).rows[0];
    body = { ...body, expectedVersion: row?.version ?? 0 };
  }
  // Vercel overwrites this trusted edge header in production. The local test
  // server needs a synthetic source address per browser to exercise rate limits.
  actor.testIp ||= `192.0.2.${nextTestAddress++}`;
  const cookie = [...actor.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  const response = await fetch(`${origin}${path}`, {
    method, redirect: 'manual',
    headers: { 'x-vercel-forwarded-for': actor.testIp, ...(cookie ? { cookie } : {}), ...(method !== 'GET' ? { origin } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  updateCookies(actor, response);
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  if (response.ok && method === 'POST') {
    if (path === '/api/tickets' && payload.ticket?.id) ticketIds.add(payload.ticket.id);
    if (path === '/api/members' && payload.member?.id) memberIds.add(payload.member.id);
    if (path === '/api/articles' && payload.article?.id) articleIds.add(payload.article.id);
  }
  return { ...payload, status: response.status };
}
function expectStatus(result, status, label) {
  assert.equal(result.status, status, `${label}: ${JSON.stringify(result)}`);
  return result;
}
const workspace = async actor => {
  const result = await api(actor, '/api/workspace');
  if (result.status !== 200) return result;
  assert.ok(result.tickets.length <= 50); assert.deepEqual(result.messages, []);
  return { ...result, tickets: await readAllTicketPages(async path => expectStatus(await api(actor, path), 200, 'Página autorizada de tickets')) };
};
const conversation = (actor, ticketId) => readAllConversationPages(async path => expectStatus(await api(actor, path), 200, 'Página autorizada de conversación'), ticketId);
const post = (actor, path, body, headers) => api(actor, path, 'POST', body, headers);
const patch = (actor, path, body, headers) => api(actor, path, 'PATCH', body, headers);
function inviteToken(url) { return new URL(url).searchParams.get('invite'); }
async function invite(name, role, actor = owner) {
  const email = `${role}-${name.toLowerCase()}-${runId}@example.test`;
  const result = expectStatus(await post(actor, '/api/members', { name: `QA ${name}`, email, role }), 201, `Invitar ${role}`);
  assert.ok(inviteToken(result.invitationUrl));
  assert.equal(result.member.hasAccount, false);
  assert.equal(result.member.status, 'invited');
  assert.equal('userId' in result.member, false);
  return { ...result, email, cookies: new Map(), password: `Qa-local-${randomUUID()}!` };
}
async function register(actor) {
  const result = await post(actor, '/api/auth/sign-up/email', { email: actor.email, password: actor.password, name: 'Nombre que no debe reemplazar la invitación' }, { 'x-daybook-invite': inviteToken(actor.invitationUrl) });
  expectStatus(result, 200, 'Aceptar invitación con contraseña');
  assert.ok(actor.cookies.size, 'Registro debe emitir cookie real');
  const data = expectStatus(await workspace(actor), 200, 'Cuenta registrada accede al portal');
  assert.equal(data.viewer.id, actor.member.id);
  assert.equal(data.viewer.name, actor.member.name);
  assert.equal(data.viewer.hasAccount, true);
}

try {
assert.equal((await database.query('SELECT count(*)::int AS n FROM "pushSubscriptions" WHERE active=true')).rows[0].n, 0, 'QA no puede tener dispositivos push activos.');
expectStatus(await workspace(anonymous), 401, 'Anónimo sin acceso');
const deepLink = await fetch(`${origin}/?ticket=42`, { redirect: 'manual' });
assert.ok([302, 303, 307, 308].includes(deepLink.status), 'Un enlace de ticket sin sesión redirige al login');
const loginRedirect = new URL(deepLink.headers.get('location'), origin);
assert.equal(loginRedirect.pathname, '/login');
assert.equal(loginRedirect.searchParams.get('return_to'), '/?ticket=42', 'Conservar el ticket para después del login');
expectStatus(await api(anonymous, '/api/workspace', 'GET', undefined, { 'oai-authenticated-user-id': 'forged', 'oai-authenticated-user-email': ownerEmail }), 401, 'Cabeceras Sites no reemplazan sesión Daybook');
const setupBefore = await database.query('SELECT COUNT(*)::integer AS total FROM organizations');
expectStatus(await post(anonymous, '/api/setup', {}), 403, 'Setup público no permite reclamar el espacio');
expectStatus(await post(anonymous, '/api/setup', {}, {
  'oai-authenticated-user-id': 'forged',
  'oai-authenticated-user-email': ownerEmail,
  'oai-authenticated-user-name': 'Propietario falso',
}), 403, 'Las cabeceras Sites falsificadas no habilitan el propietario');
assert.equal((await database.query('SELECT COUNT(*)::integer AS total FROM organizations')).rows[0].total, setupBefore.rows[0].total, 'El setup público no escribe organizaciones');
let signIn = await post(owner, '/api/auth/sign-in/email', { email: ownerEmail, password: ownerPassword });
if (signIn.status !== 200) {
  const setup = await provisionOwner(database, { email: ownerEmail, name: 'QA propietario', siteUrl: origin });
  expectStatus(await post(owner, '/api/auth/sign-up/email', { email: ownerEmail, password: ownerPassword, name: 'QA propietario' }, { 'x-daybook-invite': inviteToken(setup.invitationUrl) }), 200, 'Crear contraseña del propietario');
}
let ownerSpace = expectStatus(await workspace(owner), 200, 'Sesión propietaria');
assert.equal(ownerSpace.viewer.role, 'owner');
assert.equal(ownerSpace.mailStatus.configured, false, 'Desactiva el proveedor de correo antes de ejecutar esta prueba.');
const ownerId = ownerSpace.viewer.id;
const department = ownerSpace.settings.departments[0];
expectStatus(await post(anonymous, '/api/auth/sign-up/email', { email: `uninvited-${runId}@example.test`, name: 'Sin invitación', password: ownerPassword }), 403, 'Registro libre bloqueado');
expectStatus(await patch(owner, '/api/settings', { tagline: 'CSRF test' }, { origin: 'https://another-origin.example.test' }), 403, 'Origen externo bloqueado');
expectStatus(await patch(owner, `/api/members/${ownerId}`, { status: 'revoked' }), 403, 'Owner no se revoca');
const a = await invite('Alice', 'client');
const b = await invite('Bob', 'client');
const agent = await invite('Agent', 'agent');
await register(a); await register(b); await register(agent);
assert.equal((await database.query('SELECT COUNT(*)::integer AS total FROM invitations WHERE "memberId" = ANY($1)', [[a.member.id, b.member.id, agent.member.id]])).rows[0].total, 0, 'Aceptar la invitación consume sus tokens');
expectStatus(await post(owner, '/api/members', { name: 'Duplicado', email: a.email.toUpperCase(), role: 'client' }), 409, 'Correo normalizado no duplica membresía');
expectStatus(await post(owner, `/api/members/${a.member.id}/invite`, {}), 400, 'No renueva invitación aceptada');
expectStatus(await post(agent, '/api/members', { name: 'No autorizado', email: `forbidden-${runId}@example.test`, role: 'client' }), 403, 'Agente no administra accesos');
expectStatus(await patch(a, '/api/settings', { brandName: 'Ataque' }), 403, 'Cliente no modifica configuración');
expectStatus(await post(a, '/api/articles', { title: 'Ataque', category: 'QA', body: 'No permitido', published: true }), 403, 'Cliente no crea artículos');
expectStatus(await api(a, '/api/notifications'), 403, 'Cliente no consulta correo operativo');
expectStatus(await api(agent, '/api/notifications'), 403, 'Agente no consulta correo operativo');
const draft = expectStatus(await post(owner, '/api/articles', { title: `QA privado ${runId}`, category: 'QA', body: 'Privado para el equipo.', published: false }), 201, 'Crear borrador');
const published = expectStatus(await post(owner, '/api/articles', { title: `QA público ${runId}`, category: 'QA', body: 'Ayuda pública.', published: true }), 201, 'Publicar ayuda');
const renamedArticle = expectStatus(await patch(owner, `/api/articles/${published.article.id}`, { title: `QA público editado ${runId}` }), 200, 'Editar título sin cambiar publicación');
assert.equal(renamedArticle.article.published, true, 'PATCH parcial conserva published=true');
expectStatus(await patch(owner, `/api/articles/${published.article.id}`, {}), 400, 'PATCH de artículo vacío no modifica datos');
const createData = { subject: `QA aislamiento ${runId}`, body: 'Solicitud del cliente Alice.', department, priority: 'high' };
expectStatus(await post(a, '/api/tickets', { ...createData, ownerId: 'other' }), 400, 'Owner no puede inyectarse');
expectStatus(await post(a, '/api/tickets', { ...createData, requesterMemberId: b.member.id }), 403, 'Cliente no elige otro solicitante');
expectStatus(await post(a, '/api/tickets', { ...createData, assigneeMemberId: agent.member.id }), 403, 'Cliente no asigna equipo');
const ticketA = expectStatus(await post(a, '/api/tickets', { ...createData, requesterName: 'Falso', requesterEmail: b.email }), 201, 'Cliente crea ticket').ticket;
assert.equal(ticketA.requesterMemberId, a.member.id);
assert.equal(ticketA.requesterEmail, a.email);
assert.equal(ticketA.requesterName, a.member.name);
const ticketB = expectStatus(await post(b, '/api/tickets', { ...createData, subject: `QA Bob ${runId}`, body: 'Mensaje privado de Bob' }), 201, 'Segundo cliente crea ticket').ticket;
const secret = `NOTA-CONFIDENCIAL-${runId}`;
expectStatus(await post(agent, `/api/tickets/${ticketA.id}/messages`, { body: secret, kind: 'note' }), 201, 'Agente crea nota interna');
expectStatus(await post(agent, `/api/tickets/${ticketA.id}/messages`, { body: 'Respuesta pública del equipo', kind: 'reply' }), 201, 'Agente responde al cliente');
expectStatus(await post(a, `/api/tickets/${ticketA.id}/messages`, { body: 'Seguimiento del cliente', kind: 'reply' }), 201, 'Cliente responde a su ticket');
expectStatus(await patch(owner, `/api/tickets/${ticketA.id}`, { status: 'resolved' }), 200, 'Resolver caso antes del seguimiento');
expectStatus(await post(agent, `/api/tickets/${ticketA.id}/messages`, { body: 'Nota tras resolver', kind: 'note' }), 201, 'Nota interna en ticket resuelto');
assert.equal((await workspace(owner)).tickets.find(ticket => ticket.id === ticketA.id).status, 'resolved', 'Nota interna no reabre');
expectStatus(await post(agent, `/api/tickets/${ticketA.id}/messages`, { body: 'Confirmación del equipo tras resolver', kind: 'reply' }), 201, 'Respuesta del equipo en ticket resuelto');
assert.equal((await workspace(owner)).tickets.find(ticket => ticket.id === ticketA.id).status, 'resolved', 'Respuesta del equipo no reabre');
const followupAt = Date.now();
expectStatus(await post(a, `/api/tickets/${ticketA.id}/messages`, { body: 'El problema continúa', kind: 'reply' }), 201, 'Seguimiento cliente reabre ticket');
const reopened = (await workspace(a)).tickets.find(ticket => ticket.id === ticketA.id);
assert.equal(reopened.status, 'open', 'Seguimiento del cliente vuelve a la bandeja abierta');
assert.ok(Math.abs(Date.parse(reopened.dueAt) - (followupAt + ownerSpace.settings.slaHours.high * 3600000)) < 10000, 'Ticket reabierto recibe un nuevo plazo desde la respuesta');
expectStatus(await post(a, `/api/tickets/${ticketA.id}/messages`, { body: 'Nota ilegal', kind: 'note' }), 403, 'Cliente no crea notas');
expectStatus(await post(b, `/api/tickets/${ticketA.id}/messages`, { body: 'ID ajeno', kind: 'reply' }), 404, 'Cliente no accede por ID adivinado');
expectStatus(await patch(a, `/api/tickets/${ticketA.id}`, { status: 'resolved' }), 403, 'Cliente no modifica gestión del ticket');
let aSpace = expectStatus(await workspace(a), 200, 'Recargar cliente A');
assert.ok(aSpace.tickets.some(t => t.id === ticketA.id));
assert.ok(!aSpace.tickets.some(t => t.id === ticketB.id));
const aMessages = await conversation(a, ticketA.id);
assert.ok(aMessages.some(m => m.body === 'Respuesta pública del equipo'));
assert.ok(!aMessages.some(m => m.kind === 'note' || m.body === secret || m.ticketId === ticketB.id));
expectStatus(await api(a, `/api/tickets/${ticketB.id}/conversation`), 404, 'Cliente no abre conversación ajena');
assert.deepEqual(aSpace.members, []);
assert.deepEqual(aSpace.settings.agents, []);
assert.equal(aSpace.mailStatus, null);
assert.ok(!aSpace.articles.some(article => article.id === draft.article.id));
assert.ok(aSpace.articles.some(article => article.id === published.article.id));
const bSpace = expectStatus(await workspace(b), 200, 'Recargar cliente B');
assert.ok(!bSpace.tickets.some(t => t.id === ticketA.id));
expectStatus(await api(b, `/api/tickets/${ticketA.id}/conversation`), 404, 'Cliente B no abre conversación A');
assert.ok((await conversation(agent, ticketA.id)).some(m => m.body === secret));
expectStatus(await patch(owner, `/api/tickets/${ticketA.id}`, { assigneeMemberId: a.member.id }), 400, 'Cliente no es agente asignable');
const assigned = expectStatus(await patch(owner, `/api/tickets/${ticketA.id}`, { assigneeMemberId: agent.member.id }), 200, 'Asignar agente activo').ticket;
assert.equal(assigned.assignee, agent.member.name);
assert.equal(assigned.assigneeMemberId, agent.member.id);
assert.equal((await patch(owner, `/api/tickets/${ticketA.id}`, { assigneeMemberId: null })).ticket.assigneeMemberId, null);
const legacy = expectStatus(await post(owner, '/api/tickets', { ...createData, subject: `QA legacy ${runId}`, requesterName: a.member.name, requesterEmail: a.email }), 201, 'Crear ticket sin vínculo de cuenta').ticket;
assert.ok(!(await workspace(a)).tickets.some(t => t.id === legacy.id), 'Coincidir por email no concede acceso a datos históricos');
expectStatus(await patch(owner, `/api/tickets/${legacy.id}`, { requesterMemberId: a.member.id }), 200, 'Vincular ticket histórico explícitamente');
assert.ok((await workspace(a)).tickets.some(t => t.id === legacy.id));
expectStatus(await patch(owner, `/api/members/${agent.member.id}`, { role: 'admin' }), 200, 'Owner asciende admin');
assert.equal((await workspace(agent)).viewer.role, 'admin', 'Rol se verifica en cada solicitud con la misma sesión');
expectStatus(await post(agent, '/api/members', { name: 'Admin ilegal', email: `bad-admin-${runId}@example.test`, role: 'admin' }), 403, 'Admin no crea otros admins');
expectStatus(await patch(agent, `/api/members/${ownerId}`, { status: 'revoked' }), 403, 'Admin no altera owner');
expectStatus(await patch(agent, `/api/members/${agent.member.id}`, { role: 'agent' }), 403, 'Sin cambios de permisos propios');
const pending = await invite('Pending', 'client', agent);
expectStatus(await patch(agent, `/api/members/${pending.member.id}`, { status: 'active' }), 400, 'Cuenta sin registro no se activa administrativamente');
const renewed = expectStatus(await post(agent, `/api/members/${pending.member.id}/invite`, {}), 200, 'Rotar invitación pendiente');
assert.notEqual(renewed.invitationUrl, pending.invitationUrl);
const pendingMail = expectStatus(await api(agent, '/api/notifications'), 200, 'Revisar renovación de invitación').notifications.filter(item => item.recipientEmail === pending.email && item.event === 'invitation');
assert.equal(pendingMail.filter(item => item.status === 'cancelled').length, 1, 'Renovar cancela el enlace anterior pendiente de correo');
assert.equal(pendingMail.filter(item => item.status === 'awaiting_configuration').length, 1, 'Solo queda la invitación vigente pendiente');
expectStatus(await patch(owner, `/api/members/${agent.member.id}`, { status: 'revoked' }), 200, 'Revocar administrador');
expectStatus(await workspace(agent), 403, 'Cookie existente pierde acceso al revocar');
expectStatus(await patch(owner, `/api/tickets/${ticketA.id}`, { assigneeMemberId: agent.member.id }), 400, 'Cuenta revocada no es asignable');
expectStatus(await patch(owner, `/api/members/${agent.member.id}`, { status: 'active', role: 'agent' }), 200, 'Restaurar cuenta existente');
expectStatus(await workspace(agent), 200, 'Cuenta restaurada recupera acceso');
expectStatus(await patch(owner, `/api/members/${a.member.id}`, { status: 'revoked' }), 200, 'Revocar cliente');
expectStatus(await workspace(a), 403, 'Cliente revocado pierde acceso inmediato');
expectStatus(await post(a, `/api/tickets/${ticketA.id}/messages`, { body: 'Sesión revocada', kind: 'reply' }), 403, 'Revocación impide escritura');
const mail = expectStatus(await api(owner, '/api/notifications'), 200, 'Revisar cola con proveedor desactivado');
assert.equal((await workspace(owner)).mailStatus.configured, false);
assert.ok(!JSON.stringify(mail).includes('actionUrl'), 'La lista operativa no filtra tokens de invitación');
expectStatus(await post(agent, '/api/auth/sign-out', {}), 200, 'Cerrar sesión');
expectStatus(await workspace(agent), 401, 'Sesión cerrada no accede');

const rateLimits = await database.query('SELECT "lastRequest" FROM "authRateLimit" ORDER BY "lastRequest" DESC LIMIT 1');
assert.ok(rateLimits.rows.length && Number(rateLimits.rows[0].lastRequest) > 2147483647, 'El limitador persiste milisegundos sin desbordar int32');
const expired = await invite('Expired', 'client');
await database.query('UPDATE invitations SET "expiresAt" = $1 WHERE "memberId" = $2', [new Date(Date.now() - 60000).toISOString(), expired.member.id]);
expectStatus(await post(expired, '/api/auth/sign-up/email', { email: expired.email, password: expired.password, name: 'QA expirado' }, { 'x-daybook-invite': inviteToken(expired.invitationUrl) }), 403, 'Invitación expirada no permite registro');
assert.equal((await database.query('SELECT COUNT(*)::integer AS total FROM "authUser" WHERE email = $1', [expired.email])).rows[0].total, 0, 'Invitación expirada no crea cuenta');
expectStatus(await post(anonymous, '/api/auth/sign-up/email', { email: pending.email, password: pending.password, name: 'QA enlace antiguo' }, { 'x-daybook-invite': inviteToken(pending.invitationUrl) }), 403, 'Token rotado no permite registro');
expectStatus(await post(anonymous, '/api/auth/sign-up/email', { email: b.email, password: b.password, name: 'QA reutilizado' }, { 'x-daybook-invite': inviteToken(b.invitationUrl) }), 403, 'Token aceptado no se reutiliza');

const concurrent = await invite('Concurrent', 'client');
const contenders = [{ cookies: new Map() }, { cookies: new Map() }];
const results = await Promise.all(contenders.map(actor => post(actor, '/api/auth/sign-up/email', { email: concurrent.email, password: concurrent.password, name: 'QA concurrente' }, { 'x-daybook-invite': inviteToken(concurrent.invitationUrl) })));
assert.ok(results.some(result => result.status === 200), 'Una aceptación concurrente completa el registro');
assert.ok(results.every(result => [200, 400, 403, 409, 422].includes(result.status)), 'La aceptación concurrente no produce un error interno');
assert.equal((await database.query('SELECT COUNT(*)::integer AS total FROM "authUser" WHERE email = $1', [concurrent.email])).rows[0].total, 1, 'Aceptación concurrente crea solo una cuenta');
assert.equal((await database.query('SELECT COUNT(*)::integer AS total FROM "authAccount" a JOIN "authUser" u ON u.id = a."userId" WHERE u.email = $1 AND a."providerId" = $2', [concurrent.email, 'credential'])).rows[0].total, 1, 'Aceptación concurrente crea solo una contraseña');
assert.equal((await database.query('SELECT status FROM members WHERE id = $1', [concurrent.member.id])).rows[0].status, 'active');
await assert.rejects(provisionOwner(database, { email: ownerEmail, name: 'QA duplicado', siteUrl: origin }), 'No se vuelve a provisionar un propietario activado');

const badSignIns = [];
for (let attempt = 0; attempt < 6; attempt++) badSignIns.push(await post(anonymous, '/api/auth/sign-in/email', { email: ownerEmail, password: 'Wrong-password-for-QA!' }));
assert.ok(badSignIns.slice(0, 5).every(result => result.status === 401), 'El login rechaza contraseñas incorrectas');
assert.equal(badSignIns[5].status, 429, 'El sexto intento activa el límite persistente');
console.log('Daybook acceso verificado: propietario sin ChatGPT, invitaciones, sesiones, roles, aislamiento, notas internas, artículos, asignación, reapertura/SLA, revocación, expiración y concurrencia, rate limit y correo desactivado.');
} finally {
  try {
    const tickets = [...ticketIds], members = [...memberIds];
    await database.query('DELETE FROM "mailDeliveryEvents" WHERE "outboxId" IN (SELECT id FROM "mailOutbox" WHERE "ticketId"=ANY($1::int[]) OR "recipientMemberId"=ANY($2::text[]))', [tickets, members]);
    await database.query('DELETE FROM "pushDeliveries" WHERE "eventId" IN (SELECT id FROM "mailOutbox" WHERE "ticketId"=ANY($1::int[]) OR "recipientMemberId"=ANY($2::text[]))', [tickets, members]);
    await database.query('DELETE FROM "mailOutbox" WHERE "ticketId"=ANY($1::int[]) OR "recipientMemberId"=ANY($2::text[])', [tickets, members]);
    await database.query('DELETE FROM operations WHERE "operationId"=ANY($1::text[])', [[...operationIds]]);
    for (const table of ['inboundMailReceipts', 'ticketSatisfaction', 'escalationOccurrences', 'reminderOccurrences']) await database.query(`DELETE FROM "${table}" WHERE "ticketId"=ANY($1::int[])`, [tickets]);
    await database.query('DELETE FROM "ticketEvents" WHERE "ticketId"=ANY($1::int[])', [tickets]);
    await database.query('DELETE FROM "ticketSlaOutcomes" WHERE "ticketId"=ANY($1::int[])', [tickets]);
    await database.query('DELETE FROM messages WHERE "ticketId"=ANY($1::int[])', [tickets]);
    await database.query('DELETE FROM tickets WHERE id=ANY($1::int[])', [tickets]);
    await database.query('DELETE FROM articles WHERE id=ANY($1::int[])', [[...articleIds]]);
    await database.query('DELETE FROM invitations WHERE "memberId"=ANY($1::text[])', [members]);
    await database.query('DELETE FROM members WHERE id=ANY($1::text[])', [members]);
    await database.query('DELETE FROM "authUser" WHERE email LIKE $1', [`%${runId}@example.test`]);
    assert.equal((await database.query('SELECT count(*)::int AS n FROM members WHERE id=ANY($1::text[])', [members])).rows[0].n, 0);
    assert.equal((await database.query('SELECT count(*)::int AS n FROM tickets WHERE id=ANY($1::int[])', [tickets])).rows[0].n, 0);
    console.log('QA acceso: fixtures de esta ejecución eliminados.');
  } finally { await database.end(); }
}
