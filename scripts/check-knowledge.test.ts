import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, StandardFonts, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import {
  knowledgeContentSchema,
  knowledgePublicationSchema,
  knowledgeSearchTokens,
  monthlyReportPeriod,
  companyReportSchema,
  pauseKnowledgeFeaturesJson,
} from '../lib/knowledge-model';
import { companyReportCsv, companyReportPdf, wrapPdfText } from '../lib/company-report-export';
import { KnowledgeDraftStore, knowledgeDraftKey } from '../lib/knowledge-drafts';
import {
  BACKUP_TABLES,
  BACKUP_TABLE_PROFILES,
  SERVICE_CONTEXT_BACKUP_PROFILE,
  validateBackup,
  sha256,
} from '../lib/backup-format';
import { compatibleBackupColumns } from '../lib/backup-format';
import { knowledgeReportFixture } from './knowledge-report-fixture';

test('knowledge input rejects extra private scopes and duplicate publication companies', () => {
  assert.ok(
    knowledgeContentSchema.safeParse({ title: 'Conexión', category: 'Red', body: 'Revisar el cableado.' }).success,
  );
  assert.equal(
    knowledgeContentSchema.safeParse({ title: 'A', category: 'B', body: 'C', published: true }).success,
    false,
  );
  assert.equal(knowledgeContentSchema.safeParse({ title: 'A', category: 'B', body: 'x'.repeat(40001) }).success, false);
  const id = '00000000-0000-4000-8000-000000000001';
  assert.equal(
    knowledgePublicationSchema.safeParse({ operationId: id, expectedVersion: 0, revisionId: id, companyIds: [id, id] })
      .success,
    false,
  );
  assert.deepEqual(knowledgeSearchTokens('Tengo problemas con conexión, conexión e impresora para mi oficina'), [
    'problemas',
    'conexión',
    'impresora',
    'oficina',
  ]);
  assert.equal(knowledgeSearchTokens(Array.from({ length: 50 }, (_, i) => `token${i}`).join(' ')).length, 8);
});
test('monthly periods respect Santiago DST, leap years and the current partial month', () => {
  const company = '00000000-0000-4000-8000-000000000002',
    now = new Date('2026-11-05T15:00:00Z');
  assert.equal(monthlyReportPeriod(company, '2024-02', false, now).to, '2024-02-29');
  const september = monthlyReportPeriod(company, '2026-09', false, now);
  assert.equal(september.fromInstant, '2026-09-01T04:00:00.000Z');
  assert.equal(september.untilInstant, '2026-10-01T03:00:00.000Z');
  assert.equal(monthlyReportPeriod(company, '2026-11', false, now).to, '2026-11-05');
  assert.throws(() => monthlyReportPeriod(company, '2026-12', false, now));
  assert.throws(() => monthlyReportPeriod(company, '2026-13', false, now));
});
test('knowledge drafts retain their original version and stay isolated by account and article', () => {
  const memory = new Map<string, string>(),
    storage = {
      getItem: (key: string) => memory.get(key) || null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
    },
    store = new KnowledgeDraftStore(storage),
    base = { baseVersion: 3, title: 'Título', category: 'General', body: 'Notas del equipo', changeNote: '' };
  store.write('agente A', 7, base);
  assert.notEqual(knowledgeDraftKey('agente A', 7), knowledgeDraftKey('agente B', 7));
  assert.equal(store.read('agente B', 7, { ...base, body: '' }).body, '');
  assert.equal(store.read('agente A', 8, { ...base, body: '' }).body, '');
  assert.equal(new KnowledgeDraftStore(storage).read('agente A', 7, { ...base, baseVersion: 4 }).baseVersion, 3);
  store.clear('agente A', 7);
  assert.equal(store.read('agente A', 7, { ...base, body: '' }).body, '');
  const unavailable = new KnowledgeDraftStore({
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  });
  unavailable.write('A', 1, base);
  assert.equal(unavailable.read('A', 1, { ...base, body: '' }).body, base.body);
});
test('report snapshots reject unexpected content and invalid count values', () => {
  const report = knowledgeReportFixture().report;
  assert.ok(companyReportSchema.safeParse(report).success);
  assert.equal(companyReportSchema.safeParse({ ...report, conversation: 'private' }).success, false);
  assert.equal(
    companyReportSchema.safeParse({ ...report, summary: { ...report.summary, created: -1 } }).success,
    false,
  );
  assert.equal(
    companyReportSchema.safeParse({ ...report, byType: Array.from({ length: 52 }, () => ({ label: 'A', count: 1 })) })
      .success,
    false,
  );
});
test('monthly CSV preserves Unicode and neutralizes spreadsheet formula and delimiter injection', () => {
  const fixture = knowledgeReportFixture();
  fixture.report.companyName = '=HYPERLINK("https://example.test","x")';
  fixture.report.byType = [
    { label: ' \n+SUM(1,1),"área"', count: 2 },
    { label: '日本語 y conexión', count: 1 },
  ];
  const csv = companyReportCsv(fixture);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=HYPERLINK(""https://example.test""'));
  assert.ok(csv.includes('"\' \n+SUM(1,1),""área"""'));
  assert.ok(csv.includes('日本語 y conexión'));
  assert.equal(csv.includes('requesterEmail'), false);
});
test('PDF layout measures long words and safely handles unsupported glyphs', async () => {
  const doc = await PDFDocument.create(),
    font = await doc.embedFont(StandardFonts.Helvetica),
    lines = wrapPdfText(font, 'A'.repeat(300) + ' configuración 🔐 日本語', 10, 120);
  assert.ok(lines.length > 10);
  assert.ok(lines.every(line => font.widthOfTextAtSize(line, 10) <= 120));
  assert.ok(lines.join(' ').includes('configuración'));
  assert.ok(lines.join(' ').includes('?'));
});
test('monthly PDF is a readable paginated branded document without contacting providers', async () => {
  const fetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    throw new Error('Network disabled');
  };
  try {
    const bytes = await companyReportPdf(knowledgeReportFixture(true));
    assert.ok(Buffer.from(bytes).subarray(0, 5).equals(Buffer.from('%PDF-')));
    const doc = await PDFDocument.load(bytes);
    assert.ok(doc.getPageCount() >= 3);
    assert.equal(doc.getAuthor(), 'Daybook');
    assert.ok(doc.getPages().every(page => page.getWidth() === 595 && page.getHeight() === 842));
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = fetch;
  }
});
async function pdfPageTexts(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map(page => {
    const contents = page.node.Contents(),
      parts = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
    return parts
      .flatMap(part => {
        const stream = doc.context.lookup(part);
        assert.ok(stream instanceof PDFRawStream);
        const operators = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
        return [...operators.matchAll(/<([a-f\d]+)>\s*Tj/gi)].map(match =>
          Buffer.from(match[1], 'hex').toString('latin1'),
        );
      })
      .join('\n');
  });
}
function compactPdfFixture() {
  const fixture = knowledgeReportFixture();
  fixture.report.byType = fixture.report.byType.slice(0, 2);
  fixture.report.byAsset = fixture.report.byAsset.slice(0, 2);
  fixture.report.byDay = fixture.report.byDay.slice(0, 1);
  return fixture;
}
test('a coverage block that fits one page moves together rather than leaving its title or a paragraph fragment behind', async () => {
  const fixture = compactPdfFixture();
  fixture.report.coverageNotes = Array.from(
    { length: 5 },
    (_, i) => `SCOPE_${i}_START ${'Texto de cobertura que conserva el contexto del informe. '.repeat(3)}SCOPE_${i}_END`,
  );
  const frozen = JSON.stringify(fixture),
    pages = await pdfPageTexts(await companyReportPdf(fixture));
  const coveragePage = pages.findIndex(page => page.includes('Alcance de este informe'));
  assert.ok(coveragePage > 0, 'The compact tables leave insufficient room for the complete coverage block.');
  for (let i = 0; i < 5; i++) {
    assert.equal(
      pages.findIndex(page => page.includes(`SCOPE_${i}_START`)),
      coveragePage,
    );
    assert.equal(
      pages.findIndex(page => page.includes(`SCOPE_${i}_END`)),
      coveragePage,
    );
  }
  assert.equal(pages.filter(page => page.includes('Alcance de este informe')).length, 1);
  assert.equal(JSON.stringify(fixture), frozen);
});
test('long coverage breaks only between complete paragraphs and labels every continuation page', async () => {
  const fixture = compactPdfFixture();
  fixture.report.coverageNotes = Array.from(
    { length: 10 },
    (_, i) =>
      `LONG_${i}_START ${'La cobertura de este informe se conserva sin reconstruir historia. '.repeat(13)}LONG_${i}_END`,
  );
  assert.ok(fixture.report.coverageNotes.every(note => note.length <= 1000));
  const pages = await pdfPageTexts(await companyReportPdf(fixture)),
    scopePages = pages.map((page, index) => ({ page, index })).filter(({ page }) => /LONG_\d+_START/.test(page));
  assert.ok(scopePages.length >= 2);
  for (let i = 0; i < 10; i++) {
    const start = pages.findIndex(page => page.includes(`LONG_${i}_START`));
    assert.ok(start >= 0);
    assert.equal(
      pages.findIndex(page => page.includes(`LONG_${i}_END`)),
      start,
      `Paragraph ${i} must remain whole.`,
    );
  }
  assert.equal(
    pages.findIndex(page => page.includes('El CSV conserva el texto original.')),
    pages.findIndex(page => page.includes('LONG_9_END')),
    'The closing note stays with the final paragraph.',
  );
  for (const { page } of scopePages) assert.ok(page.includes('Alcance de este informe'));
  assert.equal(scopePages[0].page.includes('(continuaci'), false);
  for (const { page } of scopePages.slice(1)) assert.ok(page.includes('(continuaci'));
});
test('backup accepts complete historical table profiles and rejects mixed or foreign-tenant rows', () => {
  for (const profile of BACKUP_TABLE_PROFILES) {
    const manifest = {
      format: 'daybook.workspace.v1',
      ownerId: 'A',
      organizationId: 'A',
      createdAt: '2026-11-05T15:00:00Z',
      tables: profile.map(name => ({ name, columns: [], rows: [], sha256: sha256('') })),
      files: [],
      omissions: [],
    };
    assert.equal(validateBackup(manifest).tables.length, profile.length);
  }
  const manifest = {
    format: 'daybook.workspace.v1',
    ownerId: 'A',
    organizationId: 'A',
    createdAt: '2026-11-05T15:00:00Z',
    tables: SERVICE_CONTEXT_BACKUP_PROFILE.map(name => ({
      name,
      columns: [] as string[],
      rows: [] as Record<string, string>[],
      sha256: sha256(''),
    })),
    files: [],
    omissions: [],
  };
  const mixed = structuredClone(manifest);
  mixed.tables[0].name = 'knowledgeEvents' as (typeof mixed.tables)[number]['name'];
  assert.throws(() => validateBackup(mixed), /missing required/);
  assert.ok(BACKUP_TABLES.indexOf('articles') < BACKUP_TABLES.indexOf('knowledgeArticleRevisions'));
  assert.ok(BACKUP_TABLES.indexOf('knowledgeArticleRevisions') < BACKUP_TABLES.indexOf('knowledgeArticlePublications'));
  const foreign = structuredClone(manifest);
  foreign.tables[0].columns = ['ownerId'];
  foreign.tables[0].rows = [{ ownerId: 'B' }];
  foreign.tables[0].sha256 = sha256('{"ownerId":"B"}');
  assert.throws(() => validateBackup(foreign), /workspace mismatch/);
});
test('recovery permits only named additive columns and preserves required schema checks', () => {
  assert.equal(
    compatibleBackupColumns(
      'articles',
      ['id', 'title', 'body', 'version', 'contentRevision', 'reviewState', 'archived'],
      ['id', 'title', 'body'],
    ),
    true,
  );
  assert.equal(compatibleBackupColumns('articles', ['id', 'body', 'ownerId', 'version'], ['id', 'body']), false);
  assert.equal(compatibleBackupColumns('other', ['id', 'version'], ['id']), false);
  assert.equal(compatibleBackupColumns('messages', ['id', 'body', 'replyToMessageId'], ['id', 'body']), true);
  assert.equal(compatibleBackupColumns('mailOutbox', ['id', 'sourceMessageId', 'serviceReminderId'], ['id']), true);
});

test('recovery pauses knowledge while preserving security, MFA and workspace control choices', () => {
  assert.deepEqual(
    JSON.parse(pauseKnowledgeFeaturesJson('{"knowledge":true,"security":true,"workspaces":true,"custom":true}')),
    { knowledge: false, security: true, workspaces: true, custom: true },
  );
  assert.deepEqual(JSON.parse(pauseKnowledgeFeaturesJson('broken')), { knowledge: false });
});

test('frozen reports keep their original classification basis when export labels evolve', () => {
  const legacy = knowledgeReportFixture(),
    before = JSON.stringify(legacy),
    current = structuredClone(legacy);
  current.report.classificationBasis = 'verified-period-cutoff';
  assert.ok(companyReportCsv(legacy).includes('Equipos vinculados actualmente'));
  assert.ok(companyReportCsv(current).includes('Equipos verificables al cierre'));
  assert.equal(JSON.stringify(legacy), before);
});
