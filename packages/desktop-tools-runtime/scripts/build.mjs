#!/usr/bin/env node
import { gzipSync } from 'node:zlib';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist');

function octal(value, length) { return `${value.toString(8).padStart(length - 1, '0')}\0`; }
function tarEntry(name, bytes, mode) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write(octal(mode, 8), 100, 8, 'ascii');
  header.write(octal(0, 8), 108, 8, 'ascii');
  header.write(octal(0, 8), 116, 8, 'ascii');
  header.write(octal(bytes.length, 12), 124, 12, 'ascii');
  header.write(octal(0, 12), 136, 12, 'ascii');
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  header.write('root', 265, 4, 'ascii');
  header.write('root', 297, 4, 'ascii');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  const padding = Buffer.alloc((512 - (bytes.length % 512)) % 512);
  return Buffer.concat([header, bytes, padding]);
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true, mode: 0o700 });
const supervisorSource = await readFile(join(root, 'src', 'desktop-tools-supervisor.mjs'), 'utf8');
const evidenceSource = await readFile(join(root, 'src', 'session-evidence.mjs'), 'utf8');
const bundledEvidence = evidenceSource
  .replace(/^import .*;\n/gm, '')
  .replaceAll('export ', '')
  .replace(/\bfail\(/g, 'evidenceFail(')
  .replaceAll('canonical', 'evidenceCanonical')
  .replaceAll('digestPattern', 'evidenceDigestPattern');
const supervisor = supervisorSource.replace("import { initializeSessionEvidence, loadSessionContext, persistSessionContext } from './session-evidence.mjs';", bundledEvidence.trim());
if (supervisor === supervisorSource) throw new Error('session evidence import was not bundled');
await writeFile(join(output, 'desktop-tools-supervisor.mjs'), supervisor, { mode: 0o700 });
await chmod(join(output, 'desktop-tools-supervisor.mjs'), 0o700);
const entries = [];
for (const name of ['runtime-policy.json', 'supervisor-api.schema.json', 'typed-tools.json']) {
  const bytes = await readFile(join(root, 'contracts', name));
  entries.push(tarEntry(`contracts/${name}`, bytes, 0o600));
}
entries.push(Buffer.alloc(1024));
await writeFile(join(output, 'desktop-tools-tools.tar.gz'), gzipSync(Buffer.concat(entries), { level: 9, mtime: 0 }), { mode: 0o600 });
