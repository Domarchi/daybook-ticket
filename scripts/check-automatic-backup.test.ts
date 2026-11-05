import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { BACKUP_TABLES, encryptBackup, sha256, type WorkspaceBackup } from '../lib/backup-format';
import { automaticBackupConfiguration, automaticBackupDue, automaticBackupPath, automaticBackupRetentionCandidates, AutomaticBackupError,
  AUTOMATIC_BACKUP_MAX_BYTES, publicAutomaticBackupRun, santiagoBackupClock, type AutomaticBackupRun } from '../lib/automatic-backup-model';
import { automaticBackupDiagnostic, executeAutomaticBackup, verifyAutomaticBackupArchive, type AutomaticBackupClaim, type AutomaticBackupJobRepository } from '../lib/automatic-backup';
import { automaticBackupStorage, readAutomaticBackupStream, type AutomaticBackupStorage } from '../lib/automatic-backup-storage';

const now = new Date('2026-11-05T12:00:00.000Z');
const env = { VERCEL_ENV: 'preview', DAYBOOK_BLOB_ENV: 'qa', DAYBOOK_BLOB_QA_READ_WRITE_TOKEN: 'fictional-private-qa-store',
  DAYBOOK_AUTOMATIC_BACKUP_ENABLED: 'true', DAYBOOK_AUTOMATIC_BACKUP_KEY_QA: 'fictional-qa-only-key-43-characters-xxxxxxxxxxxxxxxx',
  DAYBOOK_AUTOMATIC_BACKUP_STORAGE_BUDGET_MIB: '512', DAYBOOK_AUTOMATIC_BACKUP_MONTHLY_TRANSFER_BUDGET_MIB: '4096',
  DAYBOOK_AUTOMATIC_BACKUP_PLAN_CHECKED_AT: '2026-11-01T00:00:00.000Z' };
const config = automaticBackupConfiguration(env, now);
function backup(): WorkspaceBackup { return { format: 'daybook.workspace.v1', ownerId: 'fictional-owner', organizationId: 'fictional-org', createdAt: now.toISOString(), omissions: [], files: [],
  tables: BACKUP_TABLES.map(name => ({ name, columns: [], rows: [], sha256: sha256('') })) }; }
function run(overrides: Partial<AutomaticBackupRun> = {}): AutomaticBackupRun {
  return { id: randomUUID(), ownerId: 'fictional-owner', environment: 'qa', localDate: '2026-11-05', status: 'processing', attempts: 1,
    keyId: null, archiveSha256: null, sizeBytes: null, reservedBytes: AUTOMATIC_BACKUP_MAX_BYTES, rowCount: null, fileCount: null, errorCode: null,
    createdAt: now.toISOString(), updatedAt: now.toISOString(), uploadedAt: null, verifiedAt: null, deletedAt: null, ...overrides };
}
function harness(overrides: { corrupt?: boolean; loseUploadResponse?: boolean; allowSave?: boolean; allowComplete?: boolean } = {}) {
  const value = run(), events: string[] = [], objects = new Map<string, Buffer>();
  const claim = { access: { ownerId: value.ownerId }, token: randomUUID(), run: value, settings: { retention: 7 }, cleanupOnly: false } as AutomaticBackupClaim;
  const repository: AutomaticBackupJobRepository = {
    async saveArchive(current, archive) { events.push('save'); if (overrides.allowSave === false) return false; Object.assign(current.run, archive); return true; },
    async complete() { events.push('complete'); return overrides.allowComplete !== false; },
    async fail(_claim, code) { events.push(`fail:${code}`); },
  };
  const storage: AutomaticBackupStorage = {
    async write(path, bytes) { events.push('write'); assert.equal(objects.has(path), false, 'Ciphertext may never be overwritten.'); objects.set(path, Buffer.from(bytes)); if (overrides.loseUploadResponse) throw new Error('PRIVATE_PROVIDER_DETAIL'); },
    async read(path) { events.push('read'); const bytes = objects.get(path); return bytes ? overrides.corrupt ? Buffer.alloc(bytes.length) : Buffer.from(bytes) : null; },
    async remove(path) { events.push('remove'); objects.delete(path); },
  };
  const options = { config, storage, create: async () => { events.push('create'); return backup(); }, deadline: Date.now() + 60_000 };
  return { claim, repository, storage, options, events, objects };
}

test('automatic backups fail closed without the correct environment key, store, reviewed plan and explicit budgets', () => {
  assert.equal(config.ready, true); assert.equal(config.environment, 'qa'); assert.equal(config.keyId.length, 16);
  for (const key of ['DAYBOOK_AUTOMATIC_BACKUP_ENABLED', 'DAYBOOK_AUTOMATIC_BACKUP_KEY_QA', 'DAYBOOK_BLOB_QA_READ_WRITE_TOKEN', 'DAYBOOK_AUTOMATIC_BACKUP_STORAGE_BUDGET_MIB', 'DAYBOOK_AUTOMATIC_BACKUP_MONTHLY_TRANSFER_BUDGET_MIB', 'DAYBOOK_AUTOMATIC_BACKUP_PLAN_CHECKED_AT']) {
    assert.equal(automaticBackupConfiguration({ ...env, [key]: undefined }, now).ready, false, key);
  }
  for (const changes of [{ VERCEL_ENV: 'production' }, { DAYBOOK_BLOB_ENV: 'production' }, { VERCEL_BLOB_API_URL: 'https://untrusted.example.test' },
    { DAYBOOK_AUTOMATIC_BACKUP_PLAN_CHECKED_AT: '2026-09-01T00:00:00Z' }, { DAYBOOK_AUTOMATIC_BACKUP_PLAN_CHECKED_AT: '2027-01-01T00:00:00Z' },
    { DAYBOOK_AUTOMATIC_BACKUP_STORAGE_BUDGET_MIB: '2048' }, { DAYBOOK_AUTOMATIC_BACKUP_KEY_QA: 'too-short' }]) assert.equal(automaticBackupConfiguration({ ...env, ...changes }, now).ready, false);
});

test('Santiago wall-clock scheduling handles missed half-hours and DST without retroactive catch-up', () => {
  assert.deepEqual(santiagoBackupClock(new Date('2026-11-05T06:30:00Z')), { date: '2026-11-05', time: '03:30' });
  const settings = { enabled: true, localTime: '03:00', updatedAt: now.toISOString() };
  assert.equal(automaticBackupDue(settings, new Date('2026-11-05T05:30:00Z')), null);
  assert.equal(automaticBackupDue(settings, new Date('2026-11-05T06:30:00Z')), '2026-11-05');
  assert.equal(automaticBackupDue({ ...settings, enabled: false }, now), null);
  assert.deepEqual(santiagoBackupClock(new Date('2026-04-05T02:30:00Z')), santiagoBackupClock(new Date('2026-04-05T03:30:00Z')));
  assert.equal(automaticBackupDue({ ...settings, localTime: '00:30' }, new Date('2026-09-06T04:00:00Z')), '2026-09-06', 'A skipped local hour becomes due on the first later tick.');
});

test('private storage paths are deterministic and public status never exposes crypto metadata or URLs', () => {
  const value = run({ keyId: 'PRIVATE_KEY_ID', archiveSha256: 'PRIVATE_HASH' });
  const path = automaticBackupPath('qa', value.ownerId, value.id);
  assert.match(path, /^daybook\/qa\/automatic-backups\/[a-f0-9]{64}\/[a-f0-9-]{36}\.daybook$/);
  assert.equal(path.includes(value.ownerId), false); assert.equal(path, automaticBackupPath('qa', value.ownerId, value.id));
  assert.throws(() => automaticBackupPath('qa', value.ownerId, '../foreign'), AutomaticBackupError);
  assert.doesNotMatch(JSON.stringify(publicAutomaticBackupRun(value)), /PRIVATE_|https:|keyId|archiveSha256/);
});

test('completion requires upload, a fresh private read, successful decryption and every manifest hash', async () => {
  const h = harness();
  assert.deepEqual(await executeAutomaticBackup(h.claim, h.repository, h.options), { result: 'complete', id: h.claim.run.id });
  assert.deepEqual(h.events, ['create', 'save', 'write', 'read', 'complete']);
  const bytes = [...h.objects.values()][0]; assert.equal(verifyAutomaticBackupArchive(bytes, config, h.claim.run).ownerId, 'fictional-owner');
  for (const changes of [{ ownerId: 'other-owner' }, { rowCount: 1 }, { fileCount: 1 }, { keyId: 'wrong' }, { archiveSha256: 'wrong' }, { sizeBytes: bytes.length + 1 }]) assert.throws(() => verifyAutomaticBackupArchive(bytes, config, { ...h.claim.run, ...changes }), AutomaticBackupError);
  assert.throws(() => verifyAutomaticBackupArchive(bytes, { ...config, key: 'a-different-43-character-private-encryption-key-xxxxxxxxxx' }, h.claim.run), AutomaticBackupError);
});

test('read-back corruption and a lost lease prevent completion without exposing provider details', async () => {
  const corrupt = harness({ corrupt: true });
  assert.deepEqual(await executeAutomaticBackup(corrupt.claim, corrupt.repository, corrupt.options), { result: 'failed', code: 'archive_verification_failed' });
  assert.equal(corrupt.events.includes('complete'), false);
  const stale = harness({ allowSave: false });
  assert.deepEqual(await executeAutomaticBackup(stale.claim, stale.repository, stale.options), { result: 'failed', code: 'lease_lost' });
  assert.equal(stale.events.includes('write'), false);
  const expired = harness({ allowComplete: false });
  assert.equal((await executeAutomaticBackup(expired.claim, expired.repository, expired.options)).result, 'failed');
  const timeout = harness();
  assert.deepEqual(await executeAutomaticBackup(timeout.claim, timeout.repository, { ...timeout.options, deadline: Date.now() - 1 }), { result: 'failed', code: 'time_budget_reached' });
  assert.deepEqual(timeout.events, ['fail:time_budget_reached']);
});

test('a lost upload response resumes the existing archive instead of creating or sending it again', async () => {
  const h = harness({ loseUploadResponse: true });
  assert.deepEqual(await executeAutomaticBackup(h.claim, h.repository, h.options), { result: 'failed', code: 'backup_unavailable' });
  assert.doesNotMatch(JSON.stringify(h.events), /PRIVATE_PROVIDER_DETAIL/);
  h.events.length = 0;
  assert.equal((await executeAutomaticBackup(h.claim, h.repository, h.options)).result, 'complete');
  assert.deepEqual(h.events, ['read', 'complete']); assert.equal(h.objects.size, 1);
});

test('retention preserves the latest verified backup even after failures and interrupted deletion', () => {
  const verified = Array.from({ length: 9 }, (_, index) => run({ status: 'complete', verifiedAt: `2026-11-${String(index + 1).padStart(2, '0')}T00:00:00Z` }));
  const failed = run({ status: 'failed', attempts: 3 }), interrupted = run({ status: 'deleting' });
  const candidates = automaticBackupRetentionCandidates([...verified, failed, interrupted], 7, now);
  assert.deepEqual(new Set(candidates.map(row => row.id)), new Set([verified[0].id, verified[1].id, failed.id, interrupted.id]));
  assert.equal(candidates.some(row => row.id === verified[8].id), false);
  assert.equal(automaticBackupRetentionCandidates([verified[8], failed], 0, now).some(row => row.id === verified[8].id), false);
});

test('private download stream enforces metadata and actual streamed size before buffering', async () => {
  const stream = (bytes: Buffer) => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });
  assert.deepEqual(await readAutomaticBackupStream(stream(Buffer.from('abc')), 3), Buffer.from('abc'));
  await assert.rejects(readAutomaticBackupStream(stream(Buffer.from('abcd')), 3), AutomaticBackupError);
  await assert.rejects(readAutomaticBackupStream(stream(Buffer.from('ab')), 3), AutomaticBackupError);
  await assert.rejects(readAutomaticBackupStream(stream(Buffer.from('abc')), AUTOMATIC_BACKUP_MAX_BYTES + 1), AutomaticBackupError);
});

test('decryption rejects tampered archives even if an attacker can replace the outer metadata hash', () => {
  const bytes = encryptBackup(backup(), config.key); bytes[bytes.length - 1] ^= 1;
  assert.throws(() => verifyAutomaticBackupArchive(bytes, config, { ownerId: 'fictional-owner', keyId: config.keyId, archiveSha256: sha256(bytes), sizeBytes: bytes.length, rowCount: 0, fileCount: 0 }), AutomaticBackupError);
});

test('the separate backup endpoint authenticates and checks its operational switch before any database access', async () => {
  const keys = ['DATABASE_URL', 'DAYBOOK_NOTIFICATION_JOB_SECRET', 'DAYBOOK_NOTIFICATION_JOB_ENABLED', 'DAYBOOK_AUTOMATIC_BACKUP_ENABLED'] as const;
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    delete process.env.DATABASE_URL; delete process.env.DAYBOOK_AUTOMATIC_BACKUP_ENABLED;
    process.env.DAYBOOK_NOTIFICATION_JOB_SECRET = 'fictional-backup-job-secret-only-qa-32';
    process.env.DAYBOOK_NOTIFICATION_JOB_ENABLED = 'true';
    const { POST, maxDuration } = await import('../app/api/internal/backup-tick/route');
    assert.equal(maxDuration, 300);
    const body = JSON.stringify({ invocationId: 'qa_backup_auth', scheduledAt: new Date().toISOString() });
    const request = (secret?: string) => new Request('https://qa.example.test/api/internal/backup-tick', { method: 'POST', body,
      headers: secret ? { authorization: `Bearer ${secret}` } : {} });
    assert.equal((await POST(request())).status, 401);
    process.env.DAYBOOK_NOTIFICATION_JOB_ENABLED = 'false';
    assert.equal((await POST(request(process.env.DAYBOOK_NOTIFICATION_JOB_SECRET))).status, 503);
    process.env.DAYBOOK_NOTIFICATION_JOB_ENABLED = 'true';
    const response = await POST(request(process.env.DAYBOOK_NOTIFICATION_JOB_SECRET));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, result: { result: 'paused', code: 'operator_paused' } });
  } finally {
    for (const key of keys) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
});

test('failure diagnostics expose only bounded stage/class/code metadata and cannot change outcome', async () => {
  const h = harness({ loseUploadResponse: true }), diagnostics: unknown[] = [];
  const result = await executeAutomaticBackup(h.claim, h.repository, { ...h.options, diagnostic: detail => { diagnostics.push(detail); } });
  assert.deepEqual(result, { result: 'failed', code: 'backup_unavailable' });
  assert.equal((diagnostics[0] as { stage: string }).stage, 'archive_upload');
  assert.doesNotMatch(JSON.stringify(diagnostics), /PRIVATE_PROVIDER_DETAIL|fictional-qa-only|https:|daybook\/qa/);
  const hostile = Object.assign(new Error('postgresql://private:secret@host/private'), { code: 'PRIVATE_SECRET', name: 'SECRET_NAME', cause: { code: 'ENOTFOUND', message: 'PRIVATE_URL' } });
  assert.deepEqual(automaticBackupDiagnostic(hostile, 'source_snapshot', 999999999, -3), { stage: 'source_snapshot', elapsedMs: 3600000, stageElapsedMs: 0, errorName: 'Error', errorCode: null });
  const other = harness({ allowSave: false });
  assert.equal((await executeAutomaticBackup(other.claim, other.repository, { ...other.options, diagnostic: () => { throw new Error('diagnostic unavailable'); } })).result, 'failed');
});

test('private chunked backup reads use authenticated HEAD metadata and retain exact stream limits', async () => {
  const path = automaticBackupPath('qa', 'fictional-owner', randomUUID());
  async function readCase(reportedSize: number, metadataSize: number, options: { actual?: string; failHead?: boolean; foreignPath?: boolean } = {}) {
    let heads = 0, cancelled = false;
    // Close only when the consumer requests its next chunk, keeping cancellation observable.
    let pulled = false;
    const finite = new ReadableStream<Uint8Array>({ pull(controller) { if (pulled) controller.close(); else { pulled = true; controller.enqueue(Buffer.from(options.actual || 'abc')); } }, cancel() { cancelled = true; } });
    const commands = {
      async get(input: string, init: { token: string; access: string; useCache: boolean }) {
        assert.equal(input, path); assert.equal(init.token, env.DAYBOOK_BLOB_QA_READ_WRITE_TOKEN); assert.equal(init.access, 'private'); assert.equal(init.useCache, false);
        return { statusCode: 200, stream: finite, blob: { size: reportedSize } };
      },
      async head(input: string, init: { token: string; abortSignal: AbortSignal }) {
        heads++; assert.equal(input, path); assert.equal(init.token, env.DAYBOOK_BLOB_QA_READ_WRITE_TOKEN); assert.ok(init.abortSignal);
        if (options.failHead) throw new Error('Fictitious metadata failure');
        return { pathname: options.foreignPath ? `${path}-foreign` : path, size: metadataSize };
      },
      async put() { assert.fail('No upload expected.'); }, async del() { assert.fail('No deletion expected.'); },
    } as unknown as NonNullable<Parameters<typeof automaticBackupStorage>[1]>;
    const storage = automaticBackupStorage(env, commands);
    try { return { bytes: await storage.read(path), heads, cancelled }; }
    catch (error) { return { error, heads, cancelled }; }
  }
  for (const length of [0, -1, Number.NaN, 1.5]) {
    const result = await readCase(length, 3); assert.deepEqual(result.bytes, Buffer.from('abc')); assert.equal(result.heads, 1);
  }
  const known = await readCase(3, 9); assert.deepEqual(known.bytes, Buffer.from('abc')); assert.equal(known.heads, 0);
  for (const [reported, metadata, options] of [
    [0, AUTOMATIC_BACKUP_MAX_BYTES + 1, {}], [0, 0, {}], [0, 3, { actual: 'abcd' }], [0, 3, { failHead: true }],
    [0, 3, { foreignPath: true }], [AUTOMATIC_BACKUP_MAX_BYTES + 1, 3, {}],
  ] as const) {
    const result = await readCase(reported, metadata, options); assert.ok(result.error);
    if (!('actual' in options)) assert.equal(result.cancelled, true);
  }
});
