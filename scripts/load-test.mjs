/**
 * Local load test for the company-wide launch (Fase 7, L5). NEVER against production: it wipes the database it is
 * given and refuses anything that is not on this computer.
 *
 * It rebuilds a disposable database, activates the owner and N clients + M agents through the real invitation links
 * (sign-up over HTTP, as the login page does), seeds tickets and equipment, then simulates the browsers for a while:
 * a first "9 a.m." wave that opens the workspace, then each person polls the feed at the cadence of
 * `lib/poll-schedule.ts` (active, idle, deep idle or hidden tab) while some clients create tickets. It reports latency
 * per endpoint, errors, and the database CPU when the Postgres container is named. See docs/LOAD_TEST.md.
 *
 *   DAYBOOK_LOAD_TEST=1 DATABASE_URL=postgresql://…@127.0.0.1:…/… DAYBOOK_LOAD_BASE_URL=http://127.0.0.1:5191 \
 *   [DAYBOOK_LOAD_PG_CONTAINER=daybook-load-pg DAYBOOK_LOAD_PG_CPUS=0.25] \
 *   node scripts/load-test.mjs [--users 300] [--agents 10] [--seconds 180] [--tickets 3000] [--new-tickets-per-minute 10]
 *
 * The app must already run (`next start`) against the same database, with DAYBOOK_SITE_URL = DAYBOOK_LOAD_BASE_URL.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import pg from 'pg';

const LOCAL = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const { values: options } = parseArgs({
  options: {
    users: { type: 'string', default: '300' },
    agents: { type: 'string', default: '10' },
    seconds: { type: 'string', default: '180' },
    tickets: { type: 'string', default: '3000' },
    'new-tickets-per-minute': { type: 'string', default: '10' },
  },
});
const USERS = Number(options.users),
  AGENTS = Number(options.agents),
  SECONDS = Number(options.seconds),
  SEED_TICKETS = Number(options.tickets),
  NEW_TICKETS_PER_MINUTE = Number(options['new-tickets-per-minute']);

if (process.env.DAYBOOK_LOAD_TEST !== '1') throw new Error('Set DAYBOOK_LOAD_TEST=1: this script wipes the database.');
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
const base = new URL(process.env.DAYBOOK_LOAD_BASE_URL ?? '');
if (!LOCAL.has(databaseUrl.hostname)) throw new Error('DATABASE_URL must point to a local, disposable database.');
if (!LOCAL.has(base.hostname)) throw new Error('DAYBOOK_LOAD_BASE_URL must point to the app running on this computer.');
for (const name of ['RESEND_API_KEY', 'RESEND_INBOUND_API_KEY', 'VAPID_PRIVATE_KEY', 'ANTHROPIC_API_KEY'])
  if (process.env[name]) throw new Error(`Unset ${name}: the load test never talks to providers.`);

const pool = new pg.Pool({ connectionString: databaseUrl.href, max: 4 });
const hash = token => createHash('sha256').update(token).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pick = items => items[Math.floor(Math.random() * items.length)];

// ---------------------------------------------------------------- measurements
const samples = new Map();
async function call(name, path, { method = 'GET', cookie, body, headers = {} } = {}) {
  const started = performance.now();
  let status = 0;
  try {
    const response = await fetch(new URL(path, base), {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body ? { 'content-type': 'application/json', origin: base.origin } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    status = response.status;
    await response.arrayBuffer();
    return response;
  } catch {
    status = 0;
    return null;
  } finally {
    const entry = samples.get(name) ?? { times: [], errors: 0, statuses: {} };
    entry.times.push(performance.now() - started);
    if (status < 200 || status >= 400) entry.errors += 1;
    entry.statuses[status] = (entry.statuses[status] ?? 0) + 1;
    samples.set(name, entry);
  }
}
const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;

// ---------------------------------------------------------------- setup
async function resetDatabase() {
  await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
  const env = { ...process.env, DIRECT_DATABASE_URL: databaseUrl.href, DATABASE_URL: databaseUrl.href };
  execFileSync(process.execPath, ['scripts/migrate.mjs'], { env, stdio: 'inherit' });
  const directory = mkdtempSync(join(tmpdir(), 'daybook-load-'));
  try {
    const file = join(directory, 'invitation.json');
    execFileSync(process.execPath, ['scripts/provision-owner.mjs', '--output', file], {
      env: {
        ...env,
        DAYBOOK_SITE_URL: base.origin,
        DAYBOOK_OWNER_EMAIL: 'owner@example.test',
        DAYBOOK_OWNER_NAME: 'Propietaria de carga',
      },
      stdio: 'inherit',
    });
    return new URL(JSON.parse(readFileSync(file, 'utf8')).invitationUrl).searchParams.get('invite');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** The real sign-up of an invited person; each one from its own fictitious address, as different offices would. */
async function signUp(token, email, name, index) {
  const response = await fetch(new URL('/api/auth/sign-up/email', base), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: base.origin,
      'x-daybook-invite': token,
      'x-vercel-forwarded-for': `10.${(index >> 16) & 255}.${(index >> 8) & 255}.${index & 255}`,
    },
    body: JSON.stringify({ email, name, password: `Carga-${randomBytes(12).toString('hex')}` }),
  });
  if (!response.ok) throw new Error(`Sign-up of ${email} failed: ${response.status} ${await response.text()}`);
  const cookie = response.headers
    .getSetCookie()
    .map(line => line.split(';')[0])
    .join('; ');
  if (!cookie.includes('session_token')) throw new Error(`Sign-up of ${email} returned no session.`);
  return cookie;
}

async function invite(owner, people) {
  const now = new Date().toISOString(),
    expires = new Date(Date.now() + 72 * 3_600_000).toISOString(),
    tokens = new Map();
  for (const person of people) {
    const token = randomBytes(32).toString('hex');
    tokens.set(person.id, token);
    await pool.query(
      `INSERT INTO members (id,"organizationId","ownerId","userId",email,name,role,status,"invitedBy","createdAt","updatedAt","customerCompanyId","companyAccess","isTest")
       VALUES ($1,$2,$3,NULL,$4,$5,$6,'invited',$7,$8,$8,$9,'own',false)`,
      [
        person.id,
        owner.organizationId,
        owner.ownerId,
        person.email,
        person.name,
        person.role,
        owner.id,
        now,
        person.companyId,
      ],
    );
    await pool.query(
      'INSERT INTO invitations ("memberId","ownerId","tokenHash","expiresAt","createdAt") VALUES ($1,$2,$3,$4,$5)',
      [person.id, owner.ownerId, hash(token), expires, now],
    );
  }
  return tokens;
}

async function seed(owner, companies, clients, agents) {
  const now = Date.now();
  for (const client of clients) {
    await pool.query(
      `INSERT INTO "customerAssets" (id,"ownerId","companyId",name,category,serial,model,"assetTag","assignedContactMemberId","reminderBaselineAt","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,'Computador',$5,'HP 440 G9',$6,$7,$8,$8,$8)`,
      [
        randomUUID(),
        owner.ownerId,
        client.companyId,
        `Computador ${client.tag}`,
        `SN-${client.tag}`,
        client.tag,
        client.id,
        new Date().toISOString(),
      ],
    );
  }
  const statuses = ['open', 'open', 'open', 'resolved', 'resolved', 'resolved', 'resolved', 'closed'];
  for (let index = 0; index < SEED_TICKETS; index += 1) {
    const client = pick(clients),
      agent = Math.random() < 0.7 ? pick(agents) : null,
      created = new Date(now - Math.random() * 90 * 86_400_000).toISOString(),
      status = pick(statuses);
    const ticket = (
      await pool.query(
        `INSERT INTO tickets ("ownerId","creationKey",subject,"requesterName","requesterEmail","requesterMemberId",department,assignee,"assigneeMemberId",status,priority,"createdAt","updatedAt","dueAt","customerCompanyId")
         VALUES ($1,$2,$3,$4,$5,$6,'Soporte técnico',$7,$8,$9,'normal',$10,$10,$10,$11) RETURNING id`,
        [
          owner.ownerId,
          randomUUID(),
          `Carga ${index}: el computador no enciende`,
          client.name,
          client.email,
          client.id,
          agent?.name ?? '',
          agent?.id ?? null,
          status,
          created,
          client.companyId,
        ],
      )
    ).rows[0].id;
    for (const [author, memberId, role] of [
      [client.name, client.id, 'client'],
      ...(agent ? [[agent.name, agent.id, 'agent']] : []),
    ])
      await pool.query(
        'INSERT INTO messages ("ownerId","ticketId",author,"authorMemberId","authorRole",body,kind,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,\'reply\',$7)',
        [owner.ownerId, ticket, author, memberId, role, 'Mensaje ficticio de carga.', created],
      );
  }
  return companies;
}

// ---------------------------------------------------------------- simulated browsers
/** How long a tab waits between feed reads, as `pollDelay` decides for each kind of tab. */
const PROFILES = [
  { name: 'activa', share: 0.2, ms: 5_000 },
  { name: 'inactiva', share: 0.5, ms: 15_000 },
  { name: 'muy inactiva u oculta', share: 0.3, ms: 30_000 },
];
function profileFor(index, total) {
  let cut = 0;
  for (const profile of PROFILES) {
    cut += profile.share;
    if (index < cut * total) return profile;
  }
  return PROFILES.at(-1);
}

async function browse(person, deadline, waveMs) {
  await sleep(Math.random() * waveMs);
  await call('GET /api/workspace (abrir)', '/api/workspace', { cookie: person.cookie });
  if (person.role === 'client') await call('GET /api/equipment/mine', '/api/equipment/mine', { cookie: person.cookie });
  const every = person.role === 'agent' ? 5_000 : person.profile.ms;
  while (Date.now() < deadline) {
    await sleep(every * (0.9 + Math.random() * 0.2));
    if (Date.now() >= deadline) break;
    await call('GET /api/tickets/updates', '/api/tickets/updates', { cookie: person.cookie });
  }
}

async function createTickets(clients, deadline) {
  const gap = 60_000 / Math.max(NEW_TICKETS_PER_MINUTE, 0.001);
  while (Date.now() + gap < deadline) {
    await sleep(gap * (0.5 + Math.random()));
    const client = pick(clients);
    await call('POST /api/tickets', '/api/tickets', {
      method: 'POST',
      cookie: client.cookie,
      body: {
        operationId: randomUUID(),
        subject: 'Carga: no puedo imprimir',
        department: 'Soporte técnico',
        body: 'Ticket ficticio creado durante la prueba de carga.',
      },
    });
  }
}

/**
 * Database CPU from a streaming `docker stats`, if the Postgres container is named. Percent of one core, as docker
 * reports it (a one-shot `--no-stream` reading can come back as 0 %, so the stream is read instead).
 */
async function watchDatabase(deadline) {
  const container = process.env.DAYBOOK_LOAD_PG_CONTAINER;
  if (!container) return null;
  const readings = [];
  const stats = spawn('docker', ['stats', '--format', '{{.CPUPerc}};{{.MemUsage}}', container]);
  stats.stdout.on('data', chunk => {
    for (const match of String(chunk).matchAll(/([0-9.]+)%;([^\n\x1b]+)/g))
      readings.push({ cpu: Number.parseFloat(match[1]), memory: match[2].trim() });
  });
  await sleep(Math.max(0, deadline - Date.now()));
  stats.kill();
  return readings;
}

// ---------------------------------------------------------------- run
const started = Date.now();
console.log(`Preparando base local: ${USERS} clientes, ${AGENTS} agentes, ${SEED_TICKETS} tickets…`);
const ownerToken = await resetDatabase();
const ownerCookie = await signUp(ownerToken, 'owner@example.test', 'Propietaria de carga', 1);
const owner = (await pool.query(`SELECT id,"ownerId","organizationId" FROM members WHERE role='owner' LIMIT 1`))
  .rows[0];
const companies = Array.from({ length: Math.max(1, Math.ceil(USERS / 60)) }, (_, index) => ({
  id: randomUUID(),
  name: `Empresa de carga ${index + 1}`,
}));
for (const company of companies)
  await pool.query(
    'INSERT INTO "customerCompanies" (id,"organizationId","ownerId",name,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$5)',
    [company.id, owner.organizationId, owner.ownerId, company.name, new Date().toISOString()],
  );
const clients = Array.from({ length: USERS }, (_, index) => ({
  id: randomUUID(),
  role: 'client',
  name: `Cliente de carga ${index + 1}`,
  email: `cliente${index + 1}@example.test`,
  companyId: companies[index % companies.length].id,
  tag: `CG-${String(index + 1).padStart(4, '0')}`,
  profile: profileFor(index, USERS),
}));
const agents = Array.from({ length: AGENTS }, (_, index) => ({
  id: randomUUID(),
  role: 'agent',
  name: `Agente de carga ${index + 1}`,
  email: `agente${index + 1}@example.test`,
  companyId: null,
}));
const tokens = await invite(owner, [...clients, ...agents]);
const everyone = [...clients, ...agents];
for (let index = 0; index < everyone.length; index += 10)
  await Promise.all(
    everyone.slice(index, index + 10).map(async (person, offset) => {
      person.cookie = await signUp(tokens.get(person.id), person.email, person.name, 100 + index + offset);
    }),
  );
await seed(owner, companies, clients, agents);
const setupSeconds = Math.round((Date.now() - started) / 1000);
console.log(`Listo en ${setupSeconds} s. Simulando ${SECONDS} s de uso…`);

samples.clear();
const deadline = Date.now() + SECONDS * 1000,
  waveMs = Math.min(30_000, SECONDS * 250);
const [database] = await Promise.all([
  watchDatabase(deadline),
  ...everyone.map(person => browse(person, deadline, waveMs)),
  createTickets(clients, deadline),
  call('GET /api/workspace (propietaria)', '/api/workspace', { cookie: ownerCookie }),
]);

const endpoints = Object.fromEntries(
  [...samples].map(([name, entry]) => {
    const sorted = [...entry.times].sort((a, b) => a - b);
    return [
      name,
      {
        requests: sorted.length,
        perSecond: Number((sorted.length / SECONDS).toFixed(2)),
        errors: entry.errors,
        statuses: entry.statuses,
        p50: Math.round(percentile(sorted, 50)),
        p95: Math.round(percentile(sorted, 95)),
        p99: Math.round(percentile(sorted, 99)),
        max: Math.round(sorted.at(-1) ?? 0),
      },
    ];
  }),
);
const cpus = Number(process.env.DAYBOOK_LOAD_PG_CPUS || 0);
const cpu = database?.length
  ? (() => {
      const values = database.map(reading => reading.cpu).filter(Number.isFinite);
      const average = values.reduce((sum, value) => sum + value, 0) / values.length;
      const peak = Math.max(...values);
      return {
        averagePercentOfOneCore: Number(average.toFixed(1)),
        peakPercentOfOneCore: Number(peak.toFixed(1)),
        ...(cpus
          ? { averageOfLimit: `${Math.round(average / cpus)}%`, peakOfLimit: `${Math.round(peak / cpus)}%` }
          : {}),
        lastMemory: database.at(-1)?.memory,
      };
    })()
  : null;
const total = [...samples.values()].reduce((sum, entry) => sum + entry.times.length, 0),
  errors = [...samples.values()].reduce((sum, entry) => sum + entry.errors, 0);
console.log(
  JSON.stringify(
    {
      result: errors ? 'ERRORS' : 'PASS',
      scenario: {
        clients: USERS,
        agents: AGENTS,
        seconds: SECONDS,
        seededTickets: SEED_TICKETS,
        newTicketsPerMinute: NEW_TICKETS_PER_MINUTE,
        clientTabs: Object.fromEntries(PROFILES.map(profile => [profile.name, `${profile.ms / 1000} s`])),
      },
      totals: { requests: total, perSecond: Number((total / SECONDS).toFixed(1)), errors },
      endpoints,
      database: cpu,
      setupSeconds,
    },
    null,
    2,
  ),
);
await pool.end();
