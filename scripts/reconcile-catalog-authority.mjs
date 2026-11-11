#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AUTHORITY_PATH = join(ROOT, 'config', 'catalog-authority.json');
const mode = process.argv[2] ?? '--check';

function fail(message) {
  throw new Error(message);
}

function bytes(path) {
  return readFileSync(path);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function same(left, right) {
  return left.length === right.length && left.equals(right);
}

function readAuthority() {
  const authority = JSON.parse(readFileSync(AUTHORITY_PATH, 'utf8'));
  if (authority.schemaVersion !== 1) fail('unsupported catalog authority schema');
  if (authority.canonicalSource !== 'software.yml') fail('software.yml must remain the canonical source');
  if (authority.canonicalGenerator !== 'packages/control-plane/scripts/gen-catalog.mjs') {
    fail('unexpected canonical catalog generator');
  }
  if (!Array.isArray(authority.derivedViews) || authority.derivedViews.length !== 2) {
    fail('catalog authority must enumerate every derived view');
  }
  if (!Array.isArray(authority.retiredAuthorities) || authority.retiredAuthorities.length < 1) {
    fail('catalog authority must retain retired-writer rollback evidence');
  }
  return authority;
}

function verifyRetirement(authority) {
  for (const record of authority.retiredAuthorities) {
    if (existsSync(join(ROOT, record.path))) fail(`retired catalog authority still exists: ${record.path}`);
    if (!/^[0-9a-f]{40}$/.test(record.gitBlob)) fail(`invalid rollback blob for ${record.path}`);
    const historical = execFileSync('git', ['cat-file', 'blob', record.gitBlob], { cwd: ROOT });
    if (sha256(historical) !== record.sha256) fail(`rollback digest mismatch for ${record.path}`);
    const retiredAt = Date.parse(record.retiredAt);
    const rollbackThrough = Date.parse(record.rollbackThrough);
    if (!Number.isFinite(retiredAt) || !Number.isFinite(rollbackThrough)
      || rollbackThrough - retiredAt < 90 * 24 * 60 * 60 * 1000) {
      fail(`rollback window is shorter than 90 days for ${record.path}`);
    }
    if (!record.restore.includes(record.gitBlob) || !record.restore.endsWith(record.path)) {
      fail(`rollback command is not bound to exact evidence for ${record.path}`);
    }
  }
}

function generateCatalog(generator, source, destination) {
  execFileSync(process.execPath, [generator, source, destination], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  if (!existsSync(destination) || statSync(destination).size === 0) fail('catalog generator emitted no bytes');
}

function generateIndex(builder, source, destination) {
  execFileSync('bash', [builder, source, destination], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  if (!existsSync(destination) || statSync(destination).size === 0) fail('command index generator emitted no bytes');
}

function verifyIndexParity(indexPath, catalogPath) {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const byIdentity = new Map(catalog.map(entry => [`${entry.name}\0${entry.bin}`, entry]));
  const providers = ['brew', 'apt', 'dnf', 'pacman', 'cask', 'choco', 'scoop', 'go', 'cargo', 'npm', 'pipx', 'pip', 'gem', 'apk'];
  const seen = new Set();
  const index = readFileSync(indexPath, 'utf8').replace(/\n$/, '');
  for (const line of index.split('\n')) {
    const fields = line.split('\t');
    if (fields.length !== providers.length + 2) fail(`invalid command-index row width: ${fields[0] ?? '<empty>'}`);
    const [bin, name, ...coordinates] = fields;
    const identity = `${name}\0${bin}`;
    if (seen.has(identity)) fail(`duplicate command-index identity: ${name}/${bin}`);
    seen.add(identity);
    const entry = byIdentity.get(identity);
    const selected = Object.fromEntries(providers.flatMap((provider, index) => (
      coordinates[index] ? [[provider, coordinates[index]]] : []
    )));
    if (Object.keys(selected).length === 0) continue;
    if (!entry) fail(`command-index identity absent from release catalog: ${name}/${bin}`);
    for (const [provider, coordinate] of Object.entries(selected)) {
      if (entry.pkgs[provider] !== coordinate) {
        fail(`provider parity mismatch for ${name}/${bin}/${provider}`);
      }
    }
  }
}

function reconcile(authority) {
  const source = join(ROOT, authority.canonicalSource);
  const generator = join(ROOT, authority.canonicalGenerator);
  const builder = join(ROOT, 'home', 'dot_local', 'bin', 'executable_cnf-build-index');
  const checkedIn = join(ROOT, 'packages', 'control-plane', 'src', 'catalog.json');
  const tempRoot = mkdtempSync(join(dirname(checkedIn), '.catalog-authority-'));
  try {
    const catalogOne = join(tempRoot, 'catalog-one.json');
    const catalogTwo = join(tempRoot, 'catalog-two.json');
    const indexOne = join(tempRoot, 'index-one.tsv');
    const indexTwo = join(tempRoot, 'index-two.tsv');
    generateCatalog(generator, source, catalogOne);
    generateCatalog(generator, source, catalogTwo);
    generateIndex(builder, source, indexOne);
    generateIndex(builder, source, indexTwo);
    if (!same(bytes(catalogOne), bytes(catalogTwo))) fail('catalog generation is not byte-for-byte deterministic');
    if (!same(bytes(indexOne), bytes(indexTwo))) fail('command-index generation is not byte-for-byte deterministic');
    verifyIndexParity(indexOne, catalogOne);
    if (mode === '--write') {
      renameSync(catalogOne, checkedIn);
    } else if (mode === '--check') {
      if (!same(bytes(catalogOne), bytes(checkedIn))) {
        fail('checked-in catalog drifted; run `npm run catalog:generate`');
      }
    } else {
      fail('usage: reconcile-catalog-authority.mjs [--check|--write]');
    }
    return {
      source: authority.canonicalSource,
      catalogSha256: sha256(bytes(checkedIn)),
      commandIndexSha256: sha256(bytes(indexOne)),
      retiredAuthorities: authority.retiredAuthorities.length,
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

export function verifyCatalogAuthority() {
  const authority = readAuthority();
  verifyRetirement(authority);
  return reconcile(authority);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const result = verifyCatalogAuthority();
    process.stdout.write(`${JSON.stringify({ status: 'verified', ...result })}\n`);
  } catch (error) {
    process.stderr.write(`catalog authority reconciliation failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
