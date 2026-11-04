import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { fromBufferPromise } from 'yauzl';
import { crc32 } from 'node:zlib';
import { SaxesParser } from 'saxes';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_OFFICE_EXPANDED_BYTES = 50 * 1024 * 1024;
export const MAX_OFFICE_ENTRIES = 1000;
export const attachmentMimeTypes = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;
export type AttachmentExtension = keyof typeof attachmentMimeTypes;
export class AttachmentValidationError extends Error {}
function invalid(message = 'El contenido del archivo no corresponde a un formato permitido.'): never { throw new AttachmentValidationError(message); }

export function attachmentFileInfo(name: string) {
  const normalized = name.normalize('NFC').trim();
  if (!normalized || normalized.length > 180 || /[\x00-\x1f\x7f/\\\u202a-\u202e\u2066-\u2069]/u.test(normalized)) invalid('El nombre del archivo no es válido.');
  const extension = normalized.split('.').at(-1)?.toLowerCase() as AttachmentExtension;
  if (!Object.hasOwn(attachmentMimeTypes, extension)) invalid('Usa PNG, JPEG, WebP, PDF, TXT, CSV, DOCX o XLSX.');
  return { name: normalized, extension, contentType: attachmentMimeTypes[extension] };
}

function textContent(bytes: Buffer) {
  let value: string;
  try { value = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return invalid('Los archivos de texto deben usar UTF-8.'); }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value)) invalid('El archivo contiene datos binarios, no texto.');
  // HTML/SVG/XML are not downloadable text formats supported by this product.
  if (/^\s*(?:<!doctype|<html\b|<svg\b|<\?xml)/i.test(value)) invalid();
  return value;
}

function checkCsv(value: string) {
  // Validate quoted fields without imposing a locale-specific delimiter or column count.
  let quoted = false, fieldStart = true, closedQuote = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (quoted) {
      if (char === '"') { if (value[i + 1] === '"') i++; else { quoted = false; closedQuote = true; } }
    } else if (char === ',' || char === ';' || char === '\t' || char === '\n' || char === '\r') {
      fieldStart = true; closedQuote = false;
    } else if (char === '"') {
      if (!fieldStart || closedQuote) invalid('El CSV contiene comillas incompletas.');
      quoted = true; fieldStart = false;
    } else {
      if (closedQuote && char !== ' ') invalid('El CSV contiene una celda entrecomillada inválida.');
      fieldStart = false;
    }
  }
  if (quoted) invalid('El CSV contiene comillas incompletas.');
}

async function validateOffice(bytes: Buffer, extension: 'docx' | 'xlsx') {
  const archive = await fromBufferPromise(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true });
  const seen = new Set<string>();
  const roots = new Map<string, string>();
  const contentTypes = new Map<string, string>();
  const documentTargets = new Set<string>();
  let expanded = 0, count = 0;
  try {
    if (archive.entryCount > MAX_OFFICE_ENTRIES) invalid('El documento contiene demasiados archivos internos.');
    for await (const entry of archive.eachEntry()) {
      if (++count > MAX_OFFICE_ENTRIES) invalid();
      const path = entry.fileName;
      const lower = path.toLowerCase();
      if (seen.has(lower) || /(?:^|\/)\.\.(?:\/|$)|\\|^\/|^[a-z]:/i.test(path)) invalid();
      seen.add(lower);
      if (entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod)) invalid('No se admiten documentos cifrados.');
      if (/vba|macros?|activex|(?:^|\/)(?:embeddings|customui)(?:\/|$)|\.(?:exe|dll|js|vbs|ps1|bin)$/i.test(path)) invalid('No se admiten macros ni contenido ejecutable incrustado.');
      if (expanded + entry.uncompressedSize > MAX_OFFICE_EXPANDED_BYTES) invalid('El documento supera 50 MiB al descomprimirse.');
      if (path.endsWith('/')) continue;
      const stream = await archive.openReadStreamPromise(entry);
      let size = 0, checksum = 0;
      const chunks: Buffer[] = [];
      const xml = path.endsWith('.xml') || path.endsWith('.rels');
      for await (const chunk of stream) {
        const data = Buffer.from(chunk);
        expanded += data.length; size += data.length; checksum = crc32(data, checksum);
        if (expanded > MAX_OFFICE_EXPANDED_BYTES || size > entry.uncompressedSize) { stream.destroy(); invalid('El documento supera los límites de descompresión.'); }
        if (xml) chunks.push(data);
      }
      if (size !== entry.uncompressedSize || checksum !== entry.crc32) invalid('El documento está dañado.');
      if (xml) {
        const xmlBytes = Buffer.concat(chunks);
        const encoding = xmlBytes[0] === 255 && xmlBytes[1] === 254 ? 'utf-16le' : xmlBytes[0] === 254 && xmlBytes[1] === 255 ? 'utf-16be' : 'utf-8';
        const content = new TextDecoder(encoding, { fatal: true }).decode(xmlBytes);
        if (/<!DOCTYPE|<!ENTITY|macroEnabled|vbaProject|activeX|oleObject/i.test(content)) invalid('No se admiten macros ni contenido activo incrustado.');
        const parser = new SaxesParser({ xmlns: true });
        parser.on('error', () => invalid('El documento contiene XML dañado.'));
        parser.on('opentag', tag => {
          // Inspect decoded values too: character references must not hide an
          // executable relationship or macro content type from validation.
          if (Object.values(tag.attributes).some(attr => /macroEnabled|vbaProject|activeX|oleObject/i.test(attr.value))) invalid('No se admiten macros ni contenido activo incrustado.');
          if (!roots.has(path)) roots.set(path, tag.local);
          if (path === '[Content_Types].xml' && tag.local === 'Override') {
            const attrs = Object.values(tag.attributes);
            contentTypes.set(attrs.find(attr => attr.local === 'PartName')?.value || '', attrs.find(attr => attr.local === 'ContentType')?.value || '');
          }
          if (path === '_rels/.rels' && tag.local === 'Relationship') {
            const attrs = Object.values(tag.attributes);
            if (attrs.find(attr => attr.local === 'Type')?.value.endsWith('/officeDocument')) documentTargets.add((attrs.find(attr => attr.local === 'Target')?.value || '').replace(/^\//, ''));
          }
        });
        parser.write(content).close();
      }
    }
    const main = extension === 'docx' ? 'word/document.xml' : 'xl/workbook.xml';
    const expected = extension === 'docx' ? 'wordprocessingml.document.main+xml' : 'spreadsheetml.sheet.main+xml';
    if (roots.get('[Content_Types].xml') !== 'Types' || roots.get('_rels/.rels') !== 'Relationships' || !contentTypes.get(`/${main}`)?.endsWith(expected) || !documentTargets.has(main) || roots.get(main) !== (extension === 'docx' ? 'document' : 'workbook')) invalid('El archivo no es un documento Office válido.');
  } finally { archive.close(); }
}

/** Parse actual content; declarations and filename extensions alone never approve a file. */
export async function validateAttachment(bytes: Buffer, name: string, declaredSize: number) {
  const info = attachmentFileInfo(name);
  if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES || bytes.length !== declaredSize) invalid('El tamaño del archivo no coincide con la carga reservada o supera 10 MiB.');
  try {
    if (['png', 'jpg', 'jpeg', 'webp'].includes(info.extension)) {
      const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning', animated: true });
      const metadata = await image.metadata();
      const expected = info.extension === 'jpg' ? 'jpeg' : info.extension;
      if (metadata.format !== expected || (metadata.pages || 1) > 100) invalid();
      await image.stats(); // Decode pixels as well as parsing the header.
    } else if (info.extension === 'pdf') {
      if (!bytes.subarray(0, 8).toString('ascii').match(/^%PDF-\d\.\d/) || !bytes.subarray(-2048).includes(Buffer.from('%%EOF'))) invalid();
      const document = await PDFDocument.load(bytes, { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false });
      if (!document.getPageCount()) invalid();
    } else if (info.extension === 'txt' || info.extension === 'csv') {
      const value = textContent(bytes);
      if (info.extension === 'csv') checkCsv(value);
    } else if (info.extension === 'docx' || info.extension === 'xlsx') await validateOffice(bytes, info.extension);
  } catch (error) {
    if (error instanceof AttachmentValidationError) throw error;
    invalid('No se pudo validar el archivo. Comprueba que no esté dañado, cifrado o en un formato distinto.');
  }
  return { name: info.name, contentType: info.contentType, size: bytes.length };
}
