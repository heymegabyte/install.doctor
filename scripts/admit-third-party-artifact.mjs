#!/usr/bin/env node
import { createHash, createPublicKey, verify } from 'node:crypto';
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const value = (flag, required = true) => {
  const index = args.indexOf(flag);
  const result = index < 0 ? undefined : args[index + 1];
  if (required && !result) throw new Error(`${flag} is required`);
  return result;
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const atomicJson = (path, body) => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o644, flag: 'wx' });
  renameSync(temporary, path);
};

try {
  const artifactPath = resolve(value('--artifact'));
  const publicKeyPath = resolve(value('--public-key'));
  const signaturePath = resolve(value('--signature'));
  const store = resolve(value('--store'));
  const upstream = new URL(value('--upstream'));
  if (!['https:', 'file:'].includes(upstream.protocol)) throw new Error('upstream must use HTTPS or a fixture file URL');
  const sourceRef = value('--source-ref');
  if (!/^[A-Za-z0-9][A-Za-z0-9._/@:+-]{0,255}$/.test(sourceRef)) throw new Error('source reference is invalid');
  const license = value('--license');
  if (!/^[A-Za-z0-9][A-Za-z0-9-.+]{0,63}$/.test(license)) throw new Error('license must be a bounded SPDX identifier');
  const maxBytes = Number(value('--max-bytes'));
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('max-bytes must be a positive integer');
  const size = statSync(artifactPath).size;
  if (size > maxBytes) throw new Error(`artifact exceeds bounded size (${size} > ${maxBytes})`);
  const bytes = readFileSync(artifactPath);
  const digest = sha256(bytes);
  const expectedSha256 = value('--sha256', false);
  if (expectedSha256 && expectedSha256 !== digest) throw new Error('artifact checksum does not match expected digest');
  const publicKeyPem = readFileSync(publicKeyPath, 'utf8');
  const publicKey = createPublicKey(publicKeyPem);
  const signature = Buffer.from(readFileSync(signaturePath, 'utf8').trim(), 'base64url');
  if (!verify(null, bytes, publicKey, signature)) throw new Error('artifact signature verification failed');
  const keyId = sha256(publicKey.export({ type: 'spki', format: 'der' }));
  const candidateId = sha256(Buffer.from(`${upstream.href}\n${sourceRef}\n${digest}`));
  const artifactName = basename(artifactPath).replace(/[^A-Za-z0-9._-]/g, '_');
  const mirrorRelative = join('objects', digest.slice(0, 2), `${digest}-${artifactName}`);
  const mirrorPath = join(store, mirrorRelative);
  mkdirSync(dirname(mirrorPath), { recursive: true });
  if (!existsSync(mirrorPath)) copyFileSync(artifactPath, mirrorPath, constants.COPYFILE_EXCL);
  if (sha256(readFileSync(mirrorPath)) !== digest) throw new Error('immutable mirror collision detected');
  const record = {
    schemaVersion: 1,
    candidateId,
    upstream: upstream.href,
    sourceRef,
    artifact: { name: artifactName, sha256: digest, size },
    verification: { algorithm: 'ed25519', keyId, signature: readFileSync(signaturePath, 'utf8').trim() },
    license: { spdx: license },
    mirror: { relativePath: mirrorRelative, sha256: digest },
    provenance: { admittedBy: 'desktop-tools-third-party-admission-v1', contentAddressed: true },
  };
  const recordPath = join(store, 'admissions', `${candidateId}.json`);
  if (existsSync(recordPath)) {
    const existing = JSON.parse(readFileSync(recordPath, 'utf8'));
    if (JSON.stringify(existing) !== JSON.stringify(record)) throw new Error('candidate record is immutable');
  } else atomicJson(recordPath, record);
  const admissionDir = join(store, 'admissions');
  const indexPath = join(store, 'index.json');
  const previous = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : { schemaVersion: 1, candidates: [] };
  if (previous.schemaVersion !== 1 || !Array.isArray(previous.candidates)) throw new Error('admission index is invalid');
  const candidates = [...new Set([...previous.candidates, candidateId])].sort();
  atomicJson(indexPath, { schemaVersion: 1, candidates });
  process.stdout.write(`${JSON.stringify({ status: 'PASS', candidateId, record: recordPath, mirror: mirrorPath, totalCandidates: candidates.length })}\n`);
} catch (error) {
  process.stderr.write(`artifact admission rejected: ${error.message}\n`);
  process.exitCode = 1;
}
