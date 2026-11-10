/** Local-only build; no env files, credentials, installation or remote commands.
 * Reproduces Neon's index.mjs + ZIP deployment format with existing esbuild and
 * Node 24's ZIP primitives. Prints metadata, never the archive/base64.
 */
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { crc32, deflateRawSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'outputs', 'notification-pinger');
await mkdir(output, { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: ['functions/notification-pinger/index.ts'],
  bundle: true,
  write: false,
  outfile: 'index.mjs',
  format: 'esm',
  platform: 'node',
  target: 'node24',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
});
if (result.outputFiles.length !== 1) throw new Error('Expected a single self-contained entry.');
const entry = join(output, 'index.mjs');
await writeFile(entry, result.outputFiles[0].contents, { mode: 0o600 });
const loaded = await import(pathToFileURL(entry).href);
if (typeof loaded.default?.fetch !== 'function') throw new Error('Bundle must export a fetch handler.');
const zipPath = join(output, 'function.zip');
// A single-file standard ZIP: local record + central directory + end record.
// Fixed timestamp (1980-01-01), permissions and no extra fields make it reproducible.
const data = Buffer.from(result.outputFiles[0].contents),
  name = Buffer.from('index.mjs');
const compressed = deflateRawSync(data, { level: 6 }),
  checksum = crc32(data);
const local = Buffer.alloc(30);
local.writeUInt32LE(0x04034b50, 0);
local.writeUInt16LE(20, 4);
local.writeUInt16LE(8, 8);
local.writeUInt16LE(33, 12);
local.writeUInt32LE(checksum, 14);
local.writeUInt32LE(compressed.length, 18);
local.writeUInt32LE(data.length, 22);
local.writeUInt16LE(name.length, 26);
const central = Buffer.alloc(46);
central.writeUInt32LE(0x02014b50, 0);
central.writeUInt16LE((3 << 8) | 20, 4);
central.writeUInt16LE(20, 6);
central.writeUInt16LE(8, 10);
central.writeUInt16LE(33, 14);
central.writeUInt32LE(checksum, 16);
central.writeUInt32LE(compressed.length, 20);
central.writeUInt32LE(data.length, 24);
central.writeUInt16LE(name.length, 28);
central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(1, 8);
end.writeUInt16LE(1, 10);
end.writeUInt32LE(central.length + name.length, 12);
end.writeUInt32LE(local.length + name.length + compressed.length, 16);
await writeFile(zipPath, Buffer.concat([local, name, compressed, central, name, end]), { mode: 0o600 });
const archive = await readFile(zipPath);
const base64Path = `${zipPath}.base64`;
await writeFile(base64Path, archive.toString('base64'), { mode: 0o600 });
const metadata = {
  entrypoint: 'index.mjs',
  runtime: 'nodejs24',
  zipPath,
  base64Path,
  bytes: archive.byteLength,
  sha256: createHash('sha256').update(archive).digest('hex'),
  esbuildInputs: ['functions/notification-pinger/index.ts', 'functions/notification-pinger/handler.ts'],
};
await writeFile(join(output, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(metadata));
