#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  activateRelease, activateSamePayloadRenewal, inspectActiveReleaseFreshness, inspectPublishedRelease, prepareSamePayloadRenewal,
  publishRelease, reconcileActivationReceipt,
} from './release-publication.mjs';
import {
  activateDesktopRelease, inspectPublishedDesktopRelease, publishDesktopRelease, reconcileDesktopActivationReceipt
} from './desktop-release-publication.mjs';
import { createR2PublicationStorage } from './r2-publication-storage.mjs';

function requiredEnvironment(name, minimum = 1) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length < minimum) throw new Error(`${name} is required`);
  return value;
}

async function command(file, arguments_, input) {
  await new Promise((resolve, reject) => {
    const child = spawn(file, arguments_, { stdio: ['pipe', 'ignore', 'pipe'], env: { PATH: process.env.PATH ?? '' } });
    let error = '';
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`signature verification failed (${code}): ${error.slice(0, 200)}`)));
    child.stdin.end(input);
  });
}

async function createSignatureVerifier(product = 'legacy-install-doctor') {
  const desktop = product === 'desktop-tools';
  const environmentPrefix = desktop ? 'DESKTOP_TOOLS' : 'INSTALL_DOCTOR';
  const signerId = requiredEnvironment(`${environmentPrefix}_RELEASE_SIGNER_ID`);
  const publicKeyPath = requiredEnvironment(`${environmentPrefix}_RELEASE_PUBLIC_KEY`);
  const info = await lstat(publicKeyPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 32 || info.size > 8_192) throw new Error('release public key path is unsafe');
  const publicKey = (await readFile(publicKeyPath, 'utf8')).trim();
  if (!/^ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [^\r\n]{1,128})?$/.test(publicKey)) throw new Error('release public key is not a canonical Ed25519 key');
  const allowedNamespaces = desktop
    ? ['desktop.tools.release', 'desktop.tools.release-renewal-plan']
    : ['install.doctor.release', 'install.doctor.release-renewal-plan'];
  return async ({ manifest, signature, signerId: manifestSignerId, namespace = allowedNamespaces[0] }) => {
    if (manifestSignerId !== signerId) throw new Error('manifest signer is not the configured release signer');
    if (!allowedNamespaces.includes(namespace)) throw new Error('signature namespace is not allowed');
    const stage = await mkdtemp(join(tmpdir(), `${desktop ? 'desktop-tools' : 'install-doctor'}-release-verify-`));
    await chmod(stage, 0o700);
    try {
      const allowedSigners = join(stage, 'allowed-signers');
      const signaturePath = join(stage, 'manifest.sig');
      await writeFile(allowedSigners, `${signerId} ${publicKey}\n`, { mode: 0o600 });
      await writeFile(signaturePath, signature, { mode: 0o600 });
      await command('ssh-keygen', ['-Y', 'verify', '-f', allowedSigners, '-I', signerId, '-n', namespace, '-s', signaturePath], manifest);
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  };
}

function storageFromEnvironment(prefix) {
  return createR2PublicationStorage({
    endpoint: requiredEnvironment(`${prefix}_ENDPOINT`),
    bucket: requiredEnvironment(`${prefix}_BUCKET`),
    accessKeyId: requiredEnvironment(`${prefix}_ACCESS_KEY_ID`, 16),
    secretAccessKey: requiredEnvironment(`${prefix}_SECRET_ACCESS_KEY`, 32),
  });
}

async function main() {
  const [action, ...arguments_] = process.argv.slice(2);
  const product = action?.startsWith('desktop-') ? 'desktop-tools' : 'legacy-install-doctor';
  const verifySignature = await createSignatureVerifier(product);
  if (action === 'desktop-publish' && arguments_.length === 2) {
    const [directory, releaseId] = arguments_;
    const releaseStorage = storageFromEnvironment('DESKTOP_TOOLS_RELEASE_R2');
    const receipt = await publishDesktopRelease({ directory, expectedReleaseId: releaseId, storage: releaseStorage, verifySignature });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    return;
  }
  if (action === 'desktop-activate' && (arguments_.length === 5 || arguments_.length === 7)) {
    const [releaseId, channel, expectedEtagValue, activationId, activatedAt, kind = 'promote', rollbackOfActivationId = null] = arguments_;
    const releaseStorage = storageFromEnvironment('DESKTOP_TOOLS_RELEASE_R2');
    const channelStorage = storageFromEnvironment('DESKTOP_TOOLS_CHANNEL_R2');
    const release = await inspectPublishedDesktopRelease({ expectedReleaseId: releaseId, storage: releaseStorage, verifySignature });
    const receipt = await activateDesktopRelease({ channel, release, storage: channelStorage,
      expectedEtag: expectedEtagValue === '-' ? undefined : expectedEtagValue,
      activationId, activatedAt, kind, rollbackOfActivationId });
    const { pointer, ...safeReceipt } = receipt;
    process.stdout.write(`${JSON.stringify({ ...safeReceipt, pointer })}\n`);
    if (receipt.status !== 'activated') process.exitCode = 75;
    return;
  }
  if (action === 'desktop-reconcile' && arguments_.length === 2) {
    const [channel, activationId] = arguments_;
    const receipt = await reconcileDesktopActivationReceipt({ channel, activationId,
      storage: storageFromEnvironment('DESKTOP_TOOLS_CHANNEL_R2') });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    return;
  }
  if (action === 'publish' && arguments_.length === 2) {
    const [directory, releaseId] = arguments_;
    const releaseStorage = storageFromEnvironment('INSTALL_DOCTOR_RELEASE_R2');
    const receipt = await publishRelease({ directory, expectedReleaseId: releaseId, storage: releaseStorage, verifySignature });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    return;
  }
  if (action === 'activate' && (arguments_.length === 5 || arguments_.length === 7)) {
    const [releaseId, channel, expectedEtagValue, activationId, activatedAt, kind = 'promote', rollbackOfActivationId = null] = arguments_;
    const releaseStorage = storageFromEnvironment('INSTALL_DOCTOR_RELEASE_R2');
    const channelStorage = storageFromEnvironment('INSTALL_DOCTOR_CHANNEL_R2');
    const release = await inspectPublishedRelease({ expectedReleaseId: releaseId, storage: releaseStorage, verifySignature });
    const receipt = await activateRelease({
      channel, release, storage: channelStorage, expectedEtag: expectedEtagValue === '-' ? undefined : expectedEtagValue,
      activationId, activatedAt, kind, rollbackOfActivationId,
    });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    if (receipt.status !== 'activated') process.exitCode = 75;
    return;
  }
  if (action === 'freshness' && (arguments_.length === 1 || arguments_.length === 2)) {
    const [channel, renewalWindow = '345600'] = arguments_;
    if (!/^[1-9][0-9]{3,6}$/.test(renewalWindow)) throw new Error('renewal window must be an integer number of seconds');
    const result = await inspectActiveReleaseFreshness({
      channel,
      channelStorage: storageFromEnvironment('INSTALL_DOCTOR_CHANNEL_R2'),
      releaseStorage: storageFromEnvironment('INSTALL_DOCTOR_RELEASE_R2'),
      verifySignature,
      renewalWindowSeconds: Number(renewalWindow),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === 'renewal-required') process.exitCode = 75;
    if (result.status === 'expired') process.exitCode = 78;
    return;
  }
  if (action === 'renew' && arguments_.length === 5) {
    const [releaseId, channel, createdValue, expiresValue, outputDirectory] = arguments_;
    if (!/^[1-9][0-9]*$/.test(createdValue) || !/^[1-9][0-9]*$/.test(expiresValue)) throw new Error('renewal timestamps must be canonical positive integers');
    const renewal = await prepareSamePayloadRenewal({
      channel,
      channelStorage: storageFromEnvironment('INSTALL_DOCTOR_CHANNEL_R2'),
      releaseStorage: storageFromEnvironment('INSTALL_DOCTOR_RELEASE_R2'),
      verifySignature, newReleaseId: releaseId, createdAt: Number(createdValue), expiresAt: Number(expiresValue),
    });
    await mkdir(outputDirectory, { mode: 0o700 });
    const sourceDirectory = join(outputDirectory, 'source');
    const unsignedDirectory = join(outputDirectory, 'unsigned');
    await mkdir(sourceDirectory, { mode: 0o700 });
    await mkdir(unsignedDirectory, { mode: 0o700 });
    const writeInventory = async (directory, files) => {
      for (const [name, bytes] of files) {
        const mode = ['provision.sh', 'install-doctor-engine.mjs', 'start'].includes(name) ? 0o700 : 0o600;
        await writeFile(join(directory, name), bytes, { mode, flag: 'wx' });
      }
    };
    await writeInventory(sourceDirectory, renewal.sourceFiles);
    await writeInventory(unsignedDirectory, renewal.files);
    const { sourceFiles: _sourceFiles, files: _files, ...plan } = renewal;
    await writeFile(join(outputDirectory, 'renewal-plan.json'), `${JSON.stringify(plan)}\n`, { mode: 0o600, flag: 'wx' });
    process.stdout.write(`${JSON.stringify({ ...plan, outputDirectory })}\n`);
    return;
  }
  if (action === 'activate-renewal' && arguments_.length === 4) {
    const [planPath, planSignaturePath, activationId, activatedAt] = arguments_;
    const planInfo = await lstat(planPath);
    if (!planInfo.isFile() || planInfo.isSymbolicLink() || planInfo.size < 2 || planInfo.size > 16_384) throw new Error('renewal plan path is unsafe');
    const signatureInfo = await lstat(planSignaturePath);
    if (!signatureInfo.isFile() || signatureInfo.isSymbolicLink() || signatureInfo.size < 1 || signatureInfo.size > 8_192) throw new Error('renewal plan signature path is unsafe');
    const planBytes = await readFile(planPath);
    await verifySignature({
      manifest: planBytes, signature: await readFile(planSignaturePath),
      signerId: requiredEnvironment('INSTALL_DOCTOR_RELEASE_SIGNER_ID'), namespace: 'install.doctor.release-renewal-plan',
    });
    const renewalPlan = JSON.parse(planBytes.toString('utf8'));
    const receipt = await activateSamePayloadRenewal({
      renewalPlan, activationId, activatedAt, verifySignature,
      channelStorage: storageFromEnvironment('INSTALL_DOCTOR_CHANNEL_R2'),
      releaseStorage: storageFromEnvironment('INSTALL_DOCTOR_RELEASE_R2'),
    });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    if (!['activated', 'already-activated'].includes(receipt.status)) process.exitCode = 75;
    return;
  }
  if (action === 'reconcile' && arguments_.length === 2) {
    const [channel, activationId] = arguments_;
    const receipt = await reconcileActivationReceipt({ channel, activationId, storage: storageFromEnvironment('INSTALL_DOCTOR_CHANNEL_R2') });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    return;
  }
  throw new Error('usage: publish-release-to-r2.mjs desktop-publish RELEASE_DIRECTORY RELEASE_ID | desktop-activate RELEASE_ID CHANNEL EXPECTED_ETAG_OR_- ACTIVATION_UUID ACTIVATED_AT [rollback ROLLBACK_OF_UUID] | desktop-reconcile CHANNEL ACTIVATION_UUID | publish RELEASE_DIRECTORY RELEASE_ID | activate RELEASE_ID CHANNEL EXPECTED_ETAG_OR_- ACTIVATION_UUID ACTIVATED_AT [rollback ROLLBACK_OF_UUID] | freshness CHANNEL [RENEWAL_WINDOW_SECONDS] | renew RELEASE_ID CHANNEL CREATED_AT EXPIRES_AT OUTPUT_DIRECTORY | activate-renewal PLAN_JSON PLAN_SIG ACTIVATION_UUID ACTIVATED_AT | reconcile CHANNEL ACTIVATION_UUID');
}

main().catch(error => {
  process.stderr.write(`publish-release-to-r2: ${error instanceof Error ? error.message : 'unknown failure'}\n`);
  process.exitCode = 1;
});
