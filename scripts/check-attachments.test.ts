import assert from 'node:assert/strict';
import test from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { attachmentFileInfo, AttachmentValidationError, MAX_ATTACHMENT_BYTES, validateAttachment } from '../lib/attachments-validation';
import { attachmentStorageConfig, readAttachmentBytes } from '../lib/attachments-storage';

function zip(entries: [string, string | Buffer][], options: { encrypted?: boolean; expandedSize?: number; corruptCrc?: boolean } = {}) {
  const files: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const filename = Buffer.from(name), data = Buffer.from(value), compressed = deflateRawSync(data), local = Buffer.alloc(30), directory = Buffer.alloc(46);
    const checksum = options.corruptCrc ? 123 : crc32(data), size = options.expandedSize ?? data.length;
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(options.encrypted ? 1 : 0, 6); local.writeUInt16LE(8, 8); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(filename.length, 26);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(options.encrypted ? 1 : 0, 8); directory.writeUInt16LE(8, 10); directory.writeUInt32LE(checksum, 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(size, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    files.push(local, filename, compressed); central.push(directory, filename); offset += local.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, directory, end]);
}
function office(extension: 'docx' | 'xlsx'): [string, string][] {
  const main = extension === 'docx' ? 'word/document.xml' : 'xl/workbook.xml';
  const contentType = extension === 'docx' ? 'wordprocessingml.document.main+xml' : 'spreadsheetml.sheet.main+xml';
  return [
    ['[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${main}" ContentType="application/vnd.openxmlformats-officedocument.${contentType}"/></Types>`],
    ['_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main}"/></Relationships>`],
    [main, extension === 'docx' ? '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>' : '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>'],
  ];
}
const validate = (bytes: Buffer, name: string) => validateAttachment(bytes, name, bytes.length);

test('accepts decoded PNG, JPEG and WebP content with canonical MIME types', async () => {
  for (const extension of ['png', 'jpeg', 'webp'] as const) {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#26548a' } }).toFormat(extension).toBuffer();
    assert.equal((await validate(bytes, `sample.${extension}`)).contentType, `image/${extension}`);
    await assert.rejects(validate(bytes, 'wrong.pdf'), AttachmentValidationError);
  }
});
test('image signature alone and a truncated image cannot approve a file', async () => {
  await assert.rejects(validate(Buffer.from('89504e470d0a1a0a00000000', 'hex'), 'broken.png'), AttachmentValidationError);
  const image = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#26548a' } }).jpeg().toBuffer();
  await assert.rejects(validate(image.subarray(0, image.length - 30), 'broken.jpg'), AttachmentValidationError);
});
test('PDF validation parses an actual document and rejects a forged header', async () => {
  const document = await PDFDocument.create(); document.addPage();
  assert.equal((await validate(Buffer.from(await document.save()), 'report.pdf')).contentType, 'application/pdf');
  await assert.rejects(validate(Buffer.from('%PDF-1.7\nnot a document\n%%EOF'), 'fake.pdf'), AttachmentValidationError);
});
test('text is UTF-8 without binary data, and CSV quotes must be balanced', async () => {
  assert.equal((await validate(Buffer.from('Soporte: información y solución\n'), 'notes.txt')).contentType, 'text/plain');
  await validate(Buffer.from('nombre;detalle\nJoaquín;"texto; con separador"\n'), 'contacts.csv');
  for (const [bytes, name] of [[Buffer.from([0xff, 0xfe]), 'bad.txt'], [Buffer.from('binary\x00data'), 'bad.txt'], [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'bad.txt'], [Buffer.from('a,"unclosed'), 'bad.csv']] as const) await assert.rejects(validate(bytes, name), AttachmentValidationError);
});
test('empty files, oversized files, mismatched declarations and unsafe filenames are rejected', async () => {
  await assert.rejects(validate(Buffer.alloc(0), 'empty.txt'), AttachmentValidationError);
  await assert.rejects(validate(Buffer.alloc(MAX_ATTACHMENT_BYTES + 1), 'large.txt'), AttachmentValidationError);
  await assert.rejects(validateAttachment(Buffer.from('hello'), 'a.txt', 4), AttachmentValidationError);
  for (const name of ['../secret.txt', 'a\\b.txt', 'a\r\n.txt', 'thing.svg', 'file.docm', 'file.xlsm', 'file.html', 'report\u202egpj.exe']) assert.throws(() => attachmentFileInfo(name), AttachmentValidationError);
});
test('DOCX and XLSX require real OOXML package, relationship, main document and valid XML', async () => {
  for (const extension of ['docx', 'xlsx'] as const) {
    const entries = office(extension);
    await validate(zip(entries), `document.${extension}`);
    await assert.rejects(validate(zip(entries.slice(0, 2)), `missing.${extension}`), AttachmentValidationError);
    await assert.rejects(validate(zip([...entries.slice(0, 2), [entries[2][0], '<unclosed>']]), `broken.${extension}`), AttachmentValidationError);
  }
  await assert.rejects(validate(zip(office('docx')), 'renamed.xlsx'), AttachmentValidationError);
});
test('Office rejects macros, executable embeddings, XML entities and duplicate paths', async () => {
  const valid = office('docx');
  for (const entries of [
    [...valid, ['word/vbaProject.bin', 'macro'] as [string, string]],
    [...valid, ['word/embeddings/payload.exe', 'MZ'] as [string, string]],
    [...valid, ['extra.xml', '<!DOCTYPE root [<!ENTITY x SYSTEM "file:///etc/passwd">]><root>&x;</root>'] as [string, string]],
    [...valid, ['extra.xml', '<root type="http://example.test/vba&#80;roject"/>'] as [string, string]],
    [...valid, valid[2]],
    [...valid, ['../escape.xml', '<root/>'] as [string, string]],
  ]) await assert.rejects(validate(zip(entries), 'unsafe.docx'), AttachmentValidationError);
});
test('Office bounds decompression and entry count and rejects encryption and corruption', async () => {
  const valid = office('docx');
  for (const options of [{ encrypted: true }, { expandedSize: 51 * 1024 * 1024 }, { corruptCrc: true }, { expandedSize: 1 }]) await assert.rejects(validate(zip(valid, options), 'unsafe.docx'), AttachmentValidationError);
  const tooMany: [string, string][] = [...valid, ...Array.from({ length: 1000 }, (_, i): [string, string] => [`extra${i}.xml`, '<root/>'])];
  await assert.rejects(validate(zip(tooMany), 'too-many.docx'), AttachmentValidationError);
});
test('QA and production stores cannot fall back to each other or SDK ambient credentials', () => {
  assert.equal(attachmentStorageConfig({ BLOB_READ_WRITE_TOKEN: 'ambient' }), null);
  assert.equal(attachmentStorageConfig({ DAYBOOK_BLOB_ENV: 'production', DAYBOOK_BLOB_PRODUCTION_READ_WRITE_TOKEN: 'prod' }), null);
  assert.equal(attachmentStorageConfig({ VERCEL_ENV: 'preview', DAYBOOK_BLOB_ENV: 'production', DAYBOOK_BLOB_PRODUCTION_READ_WRITE_TOKEN: 'prod' }), null);
  assert.equal(attachmentStorageConfig({ VERCEL_ENV: 'production', DAYBOOK_BLOB_ENV: 'qa', DAYBOOK_BLOB_QA_READ_WRITE_TOKEN: 'qa' }), null);
  assert.equal(attachmentStorageConfig({ DAYBOOK_BLOB_ENV: 'qa', DAYBOOK_BLOB_QA_READ_WRITE_TOKEN: 'qa', VERCEL_BLOB_API_URL: 'https://external.example' }), null);
  assert.equal(attachmentStorageConfig({ DAYBOOK_BLOB_ENV: 'qa', DAYBOOK_BLOB_QA_READ_WRITE_TOKEN: 'qa' })?.environment, 'qa');
  assert.equal(attachmentStorageConfig({ VERCEL_ENV: 'production', DAYBOOK_BLOB_ENV: 'production', DAYBOOK_BLOB_PRODUCTION_READ_WRITE_TOKEN: 'prod' })?.environment, 'production');
});
test('private storage reader bounds the actual streamed bytes and handles absent objects', async () => {
  let cancelled = false;
  const store = { remove: async () => {}, read: async () => ({ size: 4, stream: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Buffer.from('oversized')); }, cancel() { cancelled = true; } }) }) };
  await assert.rejects(readAttachmentBytes(store, 'private/path', 4));
  assert.equal(cancelled, true);
  assert.equal(await readAttachmentBytes({ ...store, read: async () => null }, 'missing', 4), null);
  assert.equal((await readAttachmentBytes({ ...store, read: async () => ({ size: 4, stream: new Response('test').body! }) }, 'private/path', 4))?.toString(), 'test');
});
