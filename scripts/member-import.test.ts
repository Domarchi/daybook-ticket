import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  IMPORT_MAX_ROWS,
  checkImportRows,
  detectDelimiter,
  importCsvCell,
  importLinksCsv,
  importProblemsCsv,
  importReady,
  importTemplateCsv,
  kindFromText,
  looseKey,
  parseCsv,
  readImportFile,
  type ImportContext,
} from '../lib/member-import-model';
import { emailAddress, shortText } from '../lib/server';
import { WORKSPACE_ROUTE_REGISTRY } from '../lib/workspace-route-registry';

const HEADER = 'Nombre;Correo;Empresa;ID del equipo;Tipo de equipo;N° de serie;Marca y modelo';
const file = (...lines: string[]) => readImportFile([HEADER, ...lines].join('\r\n'));
const empty: ImportContext = {
  companies: [{ id: 'c-andes', name: 'Constructora Andes' }],
  existingEmails: new Set(),
  equipmentByTag: new Map(),
  equipmentBySerial: new Map(),
  createMissingCompanies: false,
};

test('the CSV reader handles Excel in Spanish and in English: «;» or «,», quotes, CRLF and a BOM', () => {
  assert.equal(detectDelimiter('a;b;c\n1,5;2;3'), ';');
  assert.equal(detectDelimiter('a,b,c'), ',');
  assert.equal(detectDelimiter('a\tb\tc'), '\t');
  assert.equal(detectDelimiter('"a;b",c,d'), ',', 'separators inside quotes do not count');
  assert.deepEqual(parseCsv('﻿a;b\r\n"x;1";"di ""hola"""\r\n\r\n;\n'), [
    ['a', 'b'],
    ['x;1', 'di "hola"'],
  ]);
  assert.deepEqual(parseCsv('a,b\n"línea\nque sigue",2'), [
    ['a', 'b'],
    ['línea\nque sigue', '2'],
  ]);
  assert.throws(() => parseCsv('a;b\n"sin cerrar;2'), /comillas sin cerrar/);
});

test('columns are found by name, in any order and spelling; required ones must be there', () => {
  const read = readImportFile(
    'Serie,EMPRESA,correo electrónico,Nombre completo,Tipo,ID,Modelo,Área\n5cg1,Constructora Andes,ANA@Example.test,Ana,computador,nb-1,HP,TI',
  );
  assert.deepEqual(read.problems, []);
  assert.deepEqual(read.ignoredColumns, ['Área']);
  assert.deepEqual(read.rows[0], {
    line: 2,
    name: 'Ana',
    email: 'ANA@Example.test',
    company: 'Constructora Andes',
    assetTag: 'nb-1',
    kind: 'computador',
    serial: '5cg1',
    model: 'HP',
  });
  assert.match(
    readImportFile('Nombre;Correo\nAna;a@example.test').problems[0],
    /Faltan columnas: «Empresa», «ID del equipo»/,
  );
  assert.match(readImportFile('Nombre;Nombre;Correo').problems[0], /«Nombre» aparece dos veces/);
  assert.match(readImportFile(HEADER).problems[0], /solo el encabezado/);
  assert.match(readImportFile('').problems[0], /vacío/);
  const many = [
    HEADER,
    ...Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `P${i};p${i}@x.test;A;N-${i};Monitor;S${i};`),
  ];
  assert.match(readImportFile(many.join('\n')).problems[0], /hasta 500/);
  assert.equal(looseKey('  N° de  Serie '), 'n de serie');
  assert.equal(kindFromText('IMPRESORA'), 'printer');
  assert.equal(kindFromText('Computador'), 'computer');
  assert.equal(kindFromText('tostadora'), null);
});

test('a clean file is ready: names, emails, IDs and serials normalized; the company matched loosely', () => {
  const preview = checkImportRows(
    file(
      ' Rosa  Pérez ;ROSA@Empresa.cl;constructora andes;nb-0042;Computador; 5cg  1234x ;Dell Latitude 5440',
      'Tomás Soto;tomas@empresa.cl;Constructora Andes;MON-7;Monitor;CN-7;',
    ),
    empty,
  );
  assert.equal(importReady(preview), true);
  assert.deepEqual(preview.summary, {
    total: 2,
    valid: 2,
    withProblems: 0,
    newCompanies: [],
    newEquipment: 2,
    existingEquipment: 0,
  });
  const [rosa] = preview.rows;
  assert.equal(rosa.name, 'Rosa  Pérez', 'the name is trimmed as the invite form does');
  assert.equal(rosa.email, 'rosa@empresa.cl');
  assert.equal(rosa.companyId, 'c-andes');
  assert.equal(rosa.company, 'Constructora Andes');
  assert.equal(rosa.assetTag, 'NB-0042');
  assert.equal(rosa.kind, 'computer');
  assert.equal(rosa.serial, '5CG 1234X');
  assert.equal(rosa.model, 'Dell Latitude 5440');
});

test('every row problem is reported with its line, and one problem blocks the whole import', () => {
  const preview = checkImportRows(
    file(
      ';no-es-correo;Constructora Andes;Ñ-1;Tostadora;;',
      'Ana;ana@empresa.cl;Empresa Fantasma;NB-1;Monitor;S-1;',
      'Ana Bis;ANA@empresa.cl;Constructora Andes;nb-1;Monitor;s-1;',
    ),
    empty,
  );
  assert.equal(importReady(preview), false);
  assert.equal(preview.summary.withProblems, 3);
  const [first, second, third] = preview.rows.map(row => row.problems.join(' | '));
  assert.match(first, /Falta el nombre/);
  assert.match(first, /«no-es-correo» no es válido/);
  assert.match(first, /solo admite/);
  assert.match(first, /Tipo «Tostadora» desconocido/);
  assert.match(first, /número de serie/);
  assert.match(second, /La empresa «Empresa Fantasma» no existe/);
  assert.match(third, /El correo se repite en la línea 3/);
  assert.match(third, /El ID NB-1 se repite en la línea 3/);
  assert.match(third, /La serie S-1 se repite en la línea 3/);
  assert.match(importProblemsCsv(preview), /"4";"Ana Bis";"ana@empresa.cl";"El correo se repite/);
});

test('what already exists is checked: accounts, equipment of others, serials elsewhere; free equipment is reused', () => {
  const context: ImportContext = {
    ...empty,
    existingEmails: new Set(['rosa@empresa.cl']),
    equipmentByTag: new Map([
      ['NB-1', { id: 'a1', companyId: 'c-andes', archived: false, assignedName: 'Pedro', serial: 'S1' }],
      ['NB-2', { id: 'a2', companyId: 'c-andes', archived: false, assignedName: null, serial: '' }],
      ['NB-3', { id: 'a3', companyId: 'c-andes', archived: false, assignedName: null, serial: 'S3' }],
      ['NB-4', { id: 'a4', companyId: 'c-otra', archived: false, assignedName: null, serial: '' }],
    ]),
    equipmentBySerial: new Map([
      ['S1', { id: 'a1', assetTag: 'NB-1', archived: false }],
      ['S3', { id: 'a3', assetTag: 'NB-3', archived: false }],
      ['S9', { id: 'a9', assetTag: 'OLD-9', archived: true }],
    ]),
  };
  const preview = checkImportRows(
    file(
      'Rosa;rosa@empresa.cl;Constructora Andes;NB-10;Monitor;S10;',
      'Ana;ana@empresa.cl;Constructora Andes;NB-1;Monitor;S1;',
      'Luis;luis@empresa.cl;Constructora Andes;NB-2;Monitor;S2;',
      'Eva;eva@empresa.cl;Constructora Andes;NB-3;Monitor;s3;',
      'Iván;ivan@empresa.cl;Constructora Andes;NB-3B;Monitor;S3;',
      'Olga;olga@empresa.cl;Constructora Andes;NB-4;Monitor;S4;',
      'Raúl;raul@empresa.cl;Constructora Andes;NB-11;Monitor;S9;',
      'Sara;sara@empresa.cl;Constructora Andes;NB-3;Monitor;OTRA;',
    ),
    context,
  );
  const problems = preview.rows.map(row => row.problems.join(' | '));
  assert.match(problems[0], /ya tiene una cuenta o invitación/);
  assert.match(problems[1], /ya está asignado a Pedro/);
  assert.equal(problems[2], '', 'a free equipment without serial is assigned and gets the serial');
  assert.match(preview.rows[2].notes[0], /Se asigna el equipo NB-2/);
  assert.equal(problems[3], '', 'the same serial as recorded, other spelling');
  assert.match(problems[4], /La serie S3 ya está registrada en el equipo NB-3/);
  assert.match(problems[5], /pertenece a otra empresa/);
  assert.match(problems[6], /OLD-9, dado de baja/);
  assert.match(problems[7], /El ID NB-3 se repite en la línea 5|tiene registrada la serie S3/);
});

test('missing companies are created only when asked, once per name', () => {
  const rows = ['Ana;ana@x.test;Minera Sur;N-1;Mouse;S-1;', 'Leo;leo@x.test;minera  sur;N-2;Mouse;S-2;'];
  assert.equal(importReady(checkImportRows(file(...rows), empty)), false);
  const preview = checkImportRows(file(...rows), { ...empty, createMissingCompanies: true });
  assert.equal(importReady(preview), true);
  assert.deepEqual(preview.summary.newCompanies, ['Minera Sur']);
  assert.equal(preview.rows[1].company, 'Minera Sur', 'rows name a new company as it is created');
  assert.equal(preview.rows[0].companyId, null);
  assert.match(preview.rows[1].notes[0], /Se crea la empresa «Minera Sur»/);
});

test('the pure field rules match the invite form', () => {
  for (const value of ['', '  ', 'Ana', 'x'.repeat(160), 'x'.repeat(161)]) {
    const row = checkImportRows(file(`${value};a@x.test;Constructora Andes;N-1;Mouse;S-1;`), empty).rows[0];
    assert.equal(!row.problems.some(problem => /nombre/.test(problem)), shortText.safeParse(value).success, value);
  }
  for (const value of ['a@x.test', 'A@X.TEST', 'sin-arroba', `${'x'.repeat(250)}@x.test`]) {
    const row = checkImportRows(file(`Ana;${value};Constructora Andes;N-1;Mouse;S-1;`), empty).rows[0];
    assert.equal(!row.problems.some(problem => /correo/.test(problem)), emailAddress.safeParse(value).success, value);
  }
});

test('downloads open in Excel and never run a formula; the template reads back as a ready row', () => {
  assert.equal(importCsvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(importCsvCell('-1'), `"'-1"`);
  assert.equal(importCsvCell('Rosa'), '"Rosa"');
  const template = importTemplateCsv();
  assert.ok(template.startsWith('﻿"Nombre";"Correo"'));
  assert.equal(importReady(checkImportRows(readImportFile(template), empty)), true);
  const links = importLinksCsv(
    [{ name: 'Rosa', email: 'rosa@x.test', company: 'A', assetTag: 'NB-1', url: 'https://d.test/login?invite=ab' }],
    '2026-11-21T15:00:00.000Z',
  );
  assert.match(
    links,
    /"Enlace de invitación";"Vence"\r\n"Rosa";"rosa@x.test";"A";"NB-1";"https:\/\/d\.test\/login\?invite=ab";"21-11-2026/,
  );
});

test('the import route is admin-only, rate-limited, registered before members/:id and never queues mail', () => {
  const route = readFileSync('app/api/members/import/route.ts', 'utf8');
  assert.match(route, /requireAdmin\(await requireAccess\(request\)\)/);
  assert.match(route, /consumeRateLimit\(access, RATE_RULES\.memberImport\)/);
  const server = readFileSync('lib/member-import.ts', 'utf8');
  assert.doesNotMatch(server, /notificationStatements|mailOutbox|drainOutbox/, 'no invitation mail');
  assert.match(server, /acquireTicketWorkLock\(tx, access\.ownerId\)/, 'same lock as a single invitation');
  assert.match(server, /const preview = await check\(tx, fresh/, 'checked again inside the transaction');
  const importAt = WORKSPACE_ROUTE_REGISTRY.findIndex(route => route.pattern.test('members/import'));
  const memberAt = WORKSPACE_ROUTE_REGISTRY.findIndex(route => route.pattern.test('members/6f1b8a52'));
  assert.ok(importAt >= 0 && importAt < memberAt, 'members/import is matched before members/:id');
  assert.equal(WORKSPACE_ROUTE_REGISTRY[importAt].pattern.test('members/6f1b8a52'), false);
  const match = WORKSPACE_ROUTE_REGISTRY.find(route => route.pattern.test('members/import'));
  assert.equal(typeof (match?.handlers as Record<string, unknown>).POST, 'function');
  assert.ok(match?.handlers && 'maxDuration' in match.handlers);
});
