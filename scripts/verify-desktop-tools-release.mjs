#!/usr/bin/env node
// Offline-only verifier for a complete Desktop Tools signed release directory.
import { spawn } from 'node:child_process';
import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inspectDesktopReleaseDirectory } from '../packages/control-plane/scripts/desktop-release-publication.mjs';

const signerPattern = /^desktop-[a-z0-9][a-z0-9._-]{0,119}$/;

async function safePublicKey(pathInput) {
  const path = resolve(pathInput);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1 || info.size > 8_192) {
    throw new Error('public key is not one safe bounded regular file');
  }
  const text = (await readFile(path, 'utf8')).trim();
  if (!/^ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [^\r\n]{1,128})?$/.test(text)) throw new Error('public key is not a valid Ed25519 key');
  return text;
}

function verifySshSignature({ allowedSigners, signerId, signature, manifest }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('ssh-keygen', ['-Y', 'verify', '-f', allowedSigners, '-I', signerId,
      '-n', 'desktop.tools.release', '-s', signature], { stdio: ['pipe', 'ignore', 'pipe'] });
    let error = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { if (error.length < 8_192) error += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolvePromise() : reject(new Error(`SSHSIG verification failed (${code}): ${error.trim()}`)));
    child.stdin.end(manifest);
  });
}

export async function verifyDesktopToolsReleaseOffline({ directory, expectedReleaseId, signerId, publicKeyPath, now }) {
  if (!signerPattern.test(signerId ?? '')) throw new Error('invalid Desktop Tools signer identity');
  const publicKey = await safePublicKey(publicKeyPath);
  const scratch = await mkdtemp(join(tmpdir(), 'desktop-tools-offline-verify-'));
  await chmod(scratch, 0o700);
  try {
    const allowedSigners = join(scratch, 'allowed-signers');
    await writeFile(allowedSigners, `${signerId} ${publicKey}\n`, { mode: 0o600, flag: 'wx' });
    const release = await inspectDesktopReleaseDirectory(directory, expectedReleaseId, now);
    if (release.signerId !== signerId) throw new Error('release signer identity mismatch');
    await verifySshSignature({ allowedSigners, signerId, signature: join(resolve(directory), 'manifest.sig'),
      manifest: release.files.get('manifest') });
    return Object.freeze({ schemaVersion: 1, verified: true, product: release.product,
      releaseId: release.releaseId, signerId: release.signerId, opencodeVersion: release.opencodeVersion,
      manifestSha256: release.manifestSha256 });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [directory, releaseId, signerId, publicKeyPath] = process.argv.slice(2);
  if (!directory || !releaseId || !signerId || !publicKeyPath || process.argv.length !== 6) {
    process.stderr.write('usage: verify-desktop-tools-release.mjs DIRECTORY RELEASE_ID SIGNER_ID PUBLIC_KEY_FILE\n');
    process.exitCode = 64;
  } else {
    verifyDesktopToolsReleaseOffline({ directory, expectedReleaseId: releaseId, signerId, publicKeyPath })
      .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
      .catch(error => { process.stderr.write(`verify-desktop-tools-release: ${error instanceof Error ? error.message : 'unknown failure'}\n`); process.exitCode = 1; });
  }
}
