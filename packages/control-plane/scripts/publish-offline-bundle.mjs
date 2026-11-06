#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishOfflineBundle } from './offline-bundle-publication.mjs';
import { createR2PublicationStorage } from './r2-publication-storage.mjs';

function required(name, minimum = 1) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length < minimum) throw new Error(`${name} is required`);
  return value;
}

async function safeFile(path, maximum) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > maximum) throw new Error(`unsafe authority input: ${path}`);
  return readFile(path);
}

async function run(file, arguments_, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, arguments_, { env: { PATH: process.env.PATH ?? '' }, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = []; const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(Buffer.concat(stdout)) : reject(new Error(`authority signature operation failed (${code}): ${Buffer.concat(stderr).toString('utf8').slice(0, 200)}`)));
    child.stdin.end(stdin);
  });
}

async function main() {
  const [requestPath, delegationPath, requestAuthorityDelegationPath, requestAuthorityPath, manifestPath, bundlePath] = process.argv.slice(2);
  if (!bundlePath || process.argv.length !== 8) throw new Error('usage: publish-offline-bundle.mjs REQUEST OFFLINE_DELEGATION REQUEST_AUTHORITY_DELEGATION REQUEST_AUTHORITY MANIFEST BUNDLE');
  const signingKey = required('INSTALL_DOCTOR_OFFLINE_SIGNING_KEY_PATH');
  const releaseRootKey = required('INSTALL_DOCTOR_RELEASE_ROOT_PUBLIC_KEY_PATH');
  const releaseRootSignerId = required('INSTALL_DOCTOR_RELEASE_ROOT_SIGNER_ID');
  const keyInfo = await lstat(signingKey);
  if (!keyInfo.isFile() || keyInfo.isSymbolicLink() || (keyInfo.mode & 0o077) !== 0) throw new Error('offline signing key path is unsafe');
  const request = JSON.parse((await safeFile(requestPath, 1_048_576)).toString('utf8'));
  const delegation = JSON.parse((await safeFile(delegationPath, 65_536)).toString('utf8'));
  const requestAuthorityDelegation = JSON.parse((await safeFile(requestAuthorityDelegationPath, 65_536)).toString('utf8'));
  const requestAuthority = JSON.parse((await safeFile(requestAuthorityPath, 65_536)).toString('utf8'));
  if (requestAuthority.producerRunId !== required('INSTALL_DOCTOR_REQUEST_RUN_ID')
    || requestAuthority.producerWorkflowSha !== required('GITHUB_WORKFLOW_SHA')) {
    throw new Error('request authority is not bound to the independently verified producer run and immutable revision');
  }
  const manifest = JSON.parse((await safeFile(manifestPath, 1_048_576)).toString('utf8'));
  const bundle = await safeFile(bundlePath, 1_073_741_824);
  const claims = {
    repository: required('GITHUB_REPOSITORY'), repositoryId: required('GITHUB_REPOSITORY_ID'),
    repositoryOwnerId: required('GITHUB_REPOSITORY_OWNER_ID'), ref: required('GITHUB_REF'), eventName: required('GITHUB_EVENT_NAME'),
    environment: required('INSTALL_DOCTOR_AUTHORITY_ENVIRONMENT'), workflowRef: required('GITHUB_WORKFLOW_REF'),
    workflowSha: required('GITHUB_WORKFLOW_SHA'), runId: required('GITHUB_RUN_ID'), runAttempt: required('GITHUB_RUN_ATTEMPT'),
    actorId: required('GITHUB_ACTOR_ID'),
  };
  const stage = await mkdtemp(join(tmpdir(), 'install-doctor-offline-authority-'));
  await chmod(stage, 0o700);
  try {
    const sign = async (namespace, bytes) => {
      const payload = join(stage, `payload-${namespace.replaceAll('.', '-')}`);
      await writeFile(payload, bytes, { flag: 'wx', mode: 0o600 });
      await run('ssh-keygen', ['-Y', 'sign', '-q', '-f', signingKey, '-n', namespace, payload], Buffer.alloc(0));
      return (await readFile(`${payload}.sig`)).toString('base64');
    };
    const verifyReleaseRootSignature = async (value, signatureField, namespace) => {
      const allowedSigners = join(stage, 'release-root-allowed-signers');
      const signature = join(stage, `${namespace.replaceAll('.', '-')}.sig`);
      const publicKey = (await safeFile(releaseRootKey, 8_192)).toString('utf8').trim();
      try { await writeFile(allowedSigners, `${releaseRootSignerId} ${publicKey}\n`, { mode: 0o600, flag: 'wx' }); } catch {}
      await writeFile(signature, Buffer.from(value[signatureField], 'base64'), { mode: 0o600, flag: 'wx' });
      const unsigned = { ...value }; delete unsigned[signatureField];
      try {
        await run('ssh-keygen', ['-Y', 'verify', '-f', allowedSigners, '-I', releaseRootSignerId, '-n', namespace, '-s', signature], Buffer.from(`${JSON.stringify(unsigned)}\n`));
        return true;
      } catch { return false; }
    };
    const verifyDelegation = async ({ delegation: value }) => verifyReleaseRootSignature(value, 'releaseRootSignature', 'install.doctor.offline-signer-delegation');
    const verifyRequestAuthorityDelegation = async ({ delegation: value }) => verifyReleaseRootSignature(value, 'releaseRootSignature', 'install.doctor.offline-request-authority-delegation');
    const verifyRequestAuthority = async ({ authority, delegation: authorityDelegation }) => {
      const allowedSigners = join(stage, 'request-authority-allowed-signers');
      const signature = join(stage, 'request-authority.sig');
      await writeFile(allowedSigners, `${authorityDelegation.signerId} ${authorityDelegation.publicKey}\n`, { mode: 0o600, flag: 'wx' });
      await writeFile(signature, Buffer.from(authority.authoritySignature, 'base64'), { mode: 0o600, flag: 'wx' });
      const unsigned = { ...authority }; delete unsigned.authoritySignature;
      try {
        await run('ssh-keygen', ['-Y', 'verify', '-f', allowedSigners, '-I', authorityDelegation.signerId,
          '-n', authorityDelegation.namespace, '-s', signature], Buffer.from(`${JSON.stringify(unsigned)}\n`));
        return true;
      } catch { return false; }
    };
    const storage = createR2PublicationStorage({
      endpoint: required('INSTALL_DOCTOR_OFFLINE_R2_ENDPOINT'), bucket: required('INSTALL_DOCTOR_OFFLINE_R2_BUCKET'),
      accessKeyId: required('INSTALL_DOCTOR_OFFLINE_R2_ACCESS_KEY_ID', 16), secretAccessKey: required('INSTALL_DOCTOR_OFFLINE_R2_SECRET_ACCESS_KEY', 32),
    });
    const result = await publishOfflineBundle({ request, delegation, requestAuthorityDelegation, requestAuthority, manifest, bundle, claims, storage, sign, verifyDelegation, verifyRequestAuthorityDelegation, verifyRequestAuthority,
      now: Math.floor(Date.now() / 1_000), authorityVersion: required('GITHUB_WORKFLOW_SHA') });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`publish-offline-bundle: ${error instanceof Error ? error.message : 'unknown failure'}\n`);
  process.exitCode = 1;
});
