/**
 * Bulk import of client employees with their equipment (Fase 7, L2). Pure: reads the CSV, maps its columns and checks
 * every row against what already exists. The server (`lib/member-import.ts`) loads that context and writes; the screen
 * shows the same results before anything is written.
 */
import { assetTagProblem, normalizeAssetTag } from './asset-tag';
import {
  EQUIPMENT_KINDS,
  MODEL_MAX_LENGTH,
  duplicateSerialProblem,
  existingEquipmentProblem,
  normalizeModel,
  normalizeSerial,
  serialMismatchProblem,
  serialProblem,
  type EquipmentKind,
} from './client-equipment-model';
import { z } from 'zod';

/** The same rules as the invite form (`shortText` and `emailAddress` in lib/server.ts, which this pure module cannot import). */
const shortText = z.string().trim().min(1).max(160);
const emailAddress = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform(value => value.toLowerCase());

export const IMPORT_MAX_ROWS = 500;
/** About 500 rows of generous length. The request body is limited to this plus the JSON envelope. */
export const IMPORT_MAX_CHARS = 400_000;

export type ImportColumn = 'name' | 'email' | 'company' | 'assetTag' | 'kind' | 'serial' | 'model';
export const IMPORT_COLUMNS: { key: ImportColumn; label: string; required: boolean; aliases: string[] }[] = [
  { key: 'name', label: 'Nombre', required: true, aliases: ['nombre', 'nombre completo', 'nombre y apellido'] },
  {
    key: 'email',
    label: 'Correo',
    required: true,
    aliases: ['correo', 'correo de acceso', 'correo electronico', 'email', 'e-mail', 'mail'],
  },
  { key: 'company', label: 'Empresa', required: true, aliases: ['empresa', 'compania'] },
  {
    key: 'assetTag',
    label: 'ID del equipo',
    required: true,
    aliases: ['id del equipo', 'id equipo', 'id', 'etiqueta', 'id de inventario', 'codigo de inventario'],
  },
  { key: 'kind', label: 'Tipo de equipo', required: true, aliases: ['tipo de equipo', 'tipo', 'tipo equipo'] },
  {
    key: 'serial',
    label: 'N° de serie',
    required: true,
    aliases: ['n de serie', 'numero de serie', 'serie', 'serial', 'n serie', 'nro de serie', 'no de serie'],
  },
  { key: 'model', label: 'Marca y modelo', required: false, aliases: ['marca y modelo', 'modelo', 'marca'] },
];

/** Lower case, no accents, no «°/º», single spaces: how headers, company names and kinds are compared. */
export function looseKey(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[°º.]/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The separator Excel used: «;» in a Spanish locale, «,» elsewhere, or a tab. Counted outside quotes on line 1. */
export function detectDelimiter(text: string): ',' | ';' | '\t' {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const character of text) {
    if (character === '"') quoted = !quoted;
    else if (!quoted && (character === '\n' || character === '\r')) break;
    else if (!quoted && character in counts) counts[character as keyof typeof counts] += 1;
  }
  return counts[';'] >= counts[','] && counts[';'] >= counts['\t'] && counts[';'] > 0
    ? ';'
    : counts['\t'] > counts[',']
      ? '\t'
      : ',';
}

/** RFC 4180 with any of the three separators, CRLF or LF, and an optional BOM. Throws on an unclosed quote. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, ''),
    delimiter = detectDelimiter(text),
    rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    index = 0;
  while (index < text.length) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 2;
        continue;
      }
      if (character === '"') quoted = false;
      else field += character;
      index += 1;
      continue;
    }
    if (character === '"' && field === '') quoted = true;
    else if (character === delimiter) {
      row.push(field);
      field = '';
    } else if (character === '\r' || character === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (character === '\r' && text[index + 1] === '\n') index += 1;
    } else field += character;
    index += 1;
  }
  if (quoted) throw new Error('El archivo tiene comillas sin cerrar. Ábrelo en Excel y guárdalo de nuevo como CSV.');
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(cells => cells.some(cell => cell.trim() !== ''));
}

export type ImportRow = { line: number } & Record<ImportColumn, string>;
export type ImportFile = { rows: ImportRow[]; problems: string[]; ignoredColumns: string[] };

/** Maps the header to the known columns and returns the data rows with their line number in the file. */
export function readImportFile(text: string): ImportFile {
  if (text.length > IMPORT_MAX_CHARS)
    return {
      rows: [],
      problems: ['El archivo es demasiado grande. Divídelo en partes de hasta 500 personas.'],
      ignoredColumns: [],
    };
  let table: string[][];
  try {
    table = parseCsv(text);
  } catch (error) {
    return { rows: [], problems: [(error as Error).message], ignoredColumns: [] };
  }
  if (!table.length) return { rows: [], problems: ['El archivo está vacío.'], ignoredColumns: [] };
  const [header, ...data] = table;
  const positions = new Map<ImportColumn, number>(),
    ignoredColumns: string[] = [],
    problems: string[] = [];
  header.forEach((title, position) => {
    const key = looseKey(title);
    const column = IMPORT_COLUMNS.find(item => item.aliases.includes(key));
    if (!column) {
      if (key) ignoredColumns.push(title.trim());
    } else if (positions.has(column.key)) problems.push(`La columna «${column.label}» aparece dos veces.`);
    else positions.set(column.key, position);
  });
  const missing = IMPORT_COLUMNS.filter(column => column.required && !positions.has(column.key));
  if (missing.length)
    problems.push(
      `Faltan columnas: ${missing.map(column => `«${column.label}»`).join(', ')}. Usa la plantilla como guía.`,
    );
  if (!data.length) problems.push('El archivo no tiene filas con personas, solo el encabezado.');
  if (data.length > IMPORT_MAX_ROWS)
    problems.push(`El archivo tiene ${data.length} filas. Importa hasta ${IMPORT_MAX_ROWS} por vez.`);
  if (problems.length) return { rows: [], problems, ignoredColumns };
  // Line numbers count the header as line 1 and skip blank lines, as a spreadsheet shows them after removing them.
  const rows = data.map((cells, index) => {
    const row = { line: index + 2 } as ImportRow;
    for (const column of IMPORT_COLUMNS) row[column.key] = (cells[positions.get(column.key) ?? -1] ?? '').trim();
    return row;
  });
  return { rows, problems: [], ignoredColumns };
}

export function kindFromText(value: string): EquipmentKind | null {
  const key = looseKey(value);
  return (EQUIPMENT_KINDS.find(kind => looseKey(kind.label) === key || kind.id === key)?.id as EquipmentKind) ?? null;
}

/** What exists in the workspace for the rows of one file. Keys are normalized (lower-case email, upper-case ID/serial). */
export type ImportContext = {
  companies: { id: string; name: string }[];
  existingEmails: ReadonlySet<string>;
  equipmentByTag: ReadonlyMap<
    string,
    { id: string; companyId: string; archived: boolean; assignedName: string | null; serial: string }
  >;
  equipmentBySerial: ReadonlyMap<string, { id: string; assetTag: string | null; archived: boolean }>;
  createMissingCompanies: boolean;
};

export type ImportRowResult = {
  line: number;
  name: string;
  email: string;
  company: string;
  /** Null when the company will be created. */
  companyId: string | null;
  assetTag: string;
  kind: EquipmentKind | null;
  serial: string;
  model: string;
  problems: string[];
  /** What will happen that the admin may not expect: an existing equipment is assigned, a company is created. */
  notes: string[];
};
export type ImportPreview = {
  rows: ImportRowResult[];
  fileProblems: string[];
  ignoredColumns: string[];
  summary: {
    total: number;
    valid: number;
    withProblems: number;
    newCompanies: string[];
    newEquipment: number;
    existingEquipment: number;
  };
};

/** Checks every row; the import is all-or-nothing, so one row with problems blocks it. */
export function checkImportRows(file: ImportFile, context: ImportContext): ImportPreview {
  const companies = new Map(context.companies.map(company => [looseKey(company.name), company])),
    seenEmails = new Map<string, number>(),
    seenTags = new Map<string, number>(),
    seenSerials = new Map<string, number>(),
    newCompanies = new Map<string, string>();
  let newEquipment = 0,
    existingEquipment = 0;
  const rows = file.rows.map((row): ImportRowResult => {
    const problems: string[] = [],
      notes: string[] = [];
    const name = shortText.safeParse(row.name);
    if (!name.success) problems.push('Falta el nombre o es demasiado largo (hasta 160 caracteres).');
    const email = emailAddress.safeParse(row.email);
    const normalizedEmail = email.success ? email.data : row.email.trim().toLowerCase();
    if (!email.success) problems.push(row.email ? `El correo «${row.email}» no es válido.` : 'Falta el correo.');
    else if (context.existingEmails.has(normalizedEmail))
      problems.push('Este correo ya tiene una cuenta o invitación en el espacio.');
    else if (seenEmails.has(normalizedEmail))
      problems.push(`El correo se repite en la línea ${seenEmails.get(normalizedEmail)}.`);
    else seenEmails.set(normalizedEmail, row.line);

    const companyName = row.company.replace(/\s+/g, ' ').trim();
    const company = companies.get(looseKey(companyName)) ?? null;
    if (!companyName) problems.push('Falta la empresa.');
    else if (companyName.length > 160) problems.push('El nombre de la empresa es demasiado largo.');
    else if (!company) {
      if (context.createMissingCompanies) {
        const key = looseKey(companyName);
        if (!newCompanies.has(key)) newCompanies.set(key, companyName);
        notes.push(`Se crea la empresa «${newCompanies.get(key)}».`);
      } else problems.push(`La empresa «${companyName}» no existe. Créala o marca «Crear las empresas que falten».`);
    }

    const tagProblem = assetTagProblem(row.assetTag);
    const tag = normalizeAssetTag(row.assetTag);
    const kind = kindFromText(row.kind);
    const serialIssue = serialProblem(row.serial);
    const serial = normalizeSerial(row.serial);
    const model = normalizeModel(row.model);
    if (tagProblem) problems.push(tagProblem);
    else if (seenTags.has(tag)) problems.push(`El ID ${tag} se repite en la línea ${seenTags.get(tag)}.`);
    else seenTags.set(tag, row.line);
    if (!kind)
      problems.push(
        row.kind
          ? `Tipo «${row.kind}» desconocido. Usa: ${EQUIPMENT_KINDS.map(item => item.label).join(', ')}.`
          : 'Falta el tipo de equipo.',
      );
    if (serialIssue) problems.push(serialIssue);
    else if (seenSerials.has(serial))
      problems.push(`La serie ${serial} se repite en la línea ${seenSerials.get(serial)}.`);
    else seenSerials.set(serial, row.line);
    if (row.model.trim().length > MODEL_MAX_LENGTH)
      problems.push(`«Marca y modelo» admite hasta ${MODEL_MAX_LENGTH} caracteres.`);

    if (!tagProblem) {
      const existing = context.equipmentByTag.get(tag);
      if (existing) {
        const problem =
          existingEquipmentProblem(tag, existing, company?.id ?? '(nueva)') ??
          (serialIssue ? null : serialMismatchProblem(tag, existing.serial, serial));
        if (problem) problems.push(problem);
        else notes.push(`Se asigna el equipo ${tag}, que ya estaba en el inventario.`);
      }
      if (!serialIssue) {
        const other = context.equipmentBySerial.get(serial);
        if (other && other.id !== existing?.id) problems.push(duplicateSerialProblem(serial, other));
      }
      if (!problems.length) {
        if (existing) existingEquipment += 1;
        else newEquipment += 1;
      }
    }
    return {
      line: row.line,
      name: name.success ? name.data : row.name,
      email: normalizedEmail,
      company: company?.name ?? newCompanies.get(looseKey(companyName)) ?? companyName,
      companyId: company?.id ?? null,
      assetTag: tag,
      kind,
      serial,
      model,
      problems,
      notes,
    };
  });
  const withProblems = rows.filter(row => row.problems.length).length;
  return {
    rows,
    fileProblems: file.problems,
    ignoredColumns: file.ignoredColumns,
    summary: {
      total: rows.length,
      valid: rows.length - withProblems,
      withProblems,
      newCompanies: [...newCompanies.values()],
      newEquipment,
      existingEquipment,
    },
  };
}

export function importReady(preview: ImportPreview): boolean {
  return !preview.fileProblems.length && preview.summary.total > 0 && preview.summary.withProblems === 0;
}

/** A spreadsheet cell: quoted, with a leading apostrophe on anything a spreadsheet would run as a formula. */
export function importCsvCell(value: string | number): string {
  const text = String(value);
  return `"${(/^\s*[=+@\-\t\r]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
}
/** «;» and a BOM so Excel in Spanish opens it in columns with accents intact. */
export function importCsv(rows: (string | number)[][]): string {
  return `﻿${rows.map(row => row.map(importCsvCell).join(';')).join('\r\n')}\r\n`;
}

export function importTemplateCsv(): string {
  return importCsv([
    IMPORT_COLUMNS.map(column => column.label),
    ['Rosa Pérez', 'rosa.perez@empresa.cl', 'Constructora Andes', 'NB-0042', 'Computador', '5CG1234XYZ', 'HP 440 G9'],
  ]);
}

/** The file with the problems of each row, to fix it in the spreadsheet. */
export function importProblemsCsv(preview: ImportPreview): string {
  return importCsv([
    ['Línea', 'Nombre', 'Correo', 'Problemas'],
    ...preview.rows
      .filter(row => row.problems.length)
      .map(row => [row.line, row.name, row.email, row.problems.join(' ')]),
  ]);
}

export type ImportedInvitation = {
  name: string;
  email: string;
  company: string;
  assetTag: string;
  url: string;
};
/** The links to hand out. Anyone with a link can create that person's account: the screen says so. */
export function importLinksCsv(invitations: ImportedInvitation[], expiresAt: string): string {
  const expires = new Date(expiresAt).toLocaleString('es-CL', { timeZone: 'America/Santiago' });
  return importCsv([
    ['Nombre', 'Correo', 'Empresa', 'ID del equipo', 'Enlace de invitación', 'Vence'],
    ...invitations.map(item => [item.name, item.email, item.company, item.assetTag, item.url, expires]),
  ]);
}
