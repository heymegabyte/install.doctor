import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  createNativeDpkgTransactionRuntime,
  createTrustedDebianVersionComparator,
  createDefaultDebianMetadataVerifier,
  assertNativeDpkgNetworkDenied,
  inspectNativeDebianPackage,
  verifyDebianRepositoryMetadata,
} from './dist/index.js';

const receiptPath = process.argv[2];
if (!receiptPath?.startsWith('/evidence/')) throw new Error('an evidence path below /evidence is required');

const PACKAGE_NAME = 'install-doctor-native-fixture';
const PACKAGE_KEY = 'native-fixture';
const PACKAGE_VERSION = '1.0.0-1';
// Keep the generated .deb byte-identical across acceptance runs. dpkg-deb honors the standard
// reproducible-build timestamp for archive members and control/data tar metadata.
const PACKAGE_SOURCE_DATE_EPOCH = '1767225600'; // 2026-01-01T00:00:00Z
const SERVICE = 'install-doctor-native-fixture.service';
const PLAN_DIGEST = '7'.repeat(64);
const POLICY_PATH = '/usr/sbin/policy-rc.d';
const STATE_ROOT = '/var/lib/install-doctor-native-fixture';
const TRANSACTION_PATH = join(STATE_ROOT, 'transaction.json');
const actionLog = [];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function command(file, arguments_, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(file, arguments_, {
      shell: false,
      stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
      env: options.env ?? { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C', LC_ALL: 'C' },
    });
    const stdout = [];
    const stderr = [];
    let total = 0;
    const collect = target => chunk => {
      total += chunk.length;
      if (total > 1024 * 1024) child.kill('SIGKILL');
      else target.push(Buffer.from(chunk));
    };
    child.stdout?.on('data', collect(stdout));
    child.stderr?.on('data', collect(stderr));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      const result = { code: code ?? 255, signal, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') };
      if (options.allowFailure || (result.code === 0 && result.signal === null)) resolve(result);
      else reject(new Error(`${file} ${arguments_.join(' ')} failed: ${result.signal ?? result.code}: ${result.stderr.slice(0, 512)}`));
    });
  });
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
  const directory = await open(dirname(path), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

async function buildPackage(work, architecture) {
  const root = join(work, 'package');
  await mkdir(join(root, 'DEBIAN'), { recursive: true });
  await mkdir(join(root, 'usr', 'share', 'install-doctor'), { recursive: true });
  await writeFile(join(root, 'DEBIAN', 'control'), [
    `Package: ${PACKAGE_NAME}`,
    `Version: ${PACKAGE_VERSION}`,
    'Section: admin',
    'Priority: optional',
    `Architecture: ${architecture}`,
    'Maintainer: Install Doctor acceptance fixture <noreply@install.doctor>',
    'Description: scripts-free native dpkg acceptance fixture',
    '',
  ].join('\n'), { mode: 0o644 });
  await writeFile(join(root, 'usr', 'share', 'install-doctor', 'native-fixture.txt'), 'verified native payload\n', { mode: 0o644 });
  const output = join(work, `${PACKAGE_NAME}_${PACKAGE_VERSION}_${architecture}.deb`);
  await command('/usr/bin/dpkg-deb', ['--build', '--root-owner-group', '--', root, output], {
    env: {
      PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C', LC_ALL: 'C',
      SOURCE_DATE_EPOCH: PACKAGE_SOURCE_DATE_EPOCH,
    },
  });
  return output;
}

async function createDescriptor(packagePath, architecture) {
  const bytes = await readFile(packagePath);
  const artifactDigest = sha256(bytes);
  return {
    schemaVersion: 1,
    kind: 'native-offline-package',
    manager: 'dpkg',
    packageKey: PACKAGE_KEY,
    platform: { os: 'linux', arch: architecture === 'amd64' ? 'x64' : 'arm64' },
    package: { name: PACKAGE_NAME, version: PACKAGE_VERSION, architecture },
    artifact: {
      id: 'native-fixture-deb', sha256: artifactDigest, sizeBytes: bytes.length,
      mediaType: 'application/vnd.debian.binary-package',
    },
    distro: { id: 'debian', versionId: '12', codename: 'bookworm' },
    repository: { repositoryOrigin: 'https://deb.debian.org/debian', suite: 'bookworm', component: 'main' },
    metadataProof: {
      inRelease: {
        artifactId: 'fixture-inrelease', path: 'dists/bookworm/InRelease', sha256: '1'.repeat(64), sizeBytes: 1,
        signedAt: '2026-01-01T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z', maximumDateAgeSeconds: null,
        signingKeyFingerprint: 'A'.repeat(40),
        keyring: { artifactId: 'fixture-keyring', sha256: '2'.repeat(64), sizeBytes: 1, mediaType: 'application/vnd.gnupg.keyring' },
      },
      packagesIndex: {
        artifactId: 'fixture-packages', path: `dists/bookworm/main/binary-${architecture}/Packages.xz`,
        sha256: '3'.repeat(64), sizeBytes: 1, architecture,
      },
      packageStanza: {
        filename: `pool/main/i/${PACKAGE_NAME}/${PACKAGE_NAME}_${PACKAGE_VERSION}_${architecture}.deb`,
        sha256: artifactDigest, sizeBytes: bytes.length, depends: null, preDepends: null,
        essential: 'absent', multiArch: 'absent',
      },
    },
    dependencyClosure: { depends: [], preDepends: [] },
    affectedServiceUnits: [SERVICE],
    conffiles: [],
    maintainerScriptPolicy: {
      trust: 'signed-repository-metadata', network: 'deny', serviceStarts: 'suppress-and-restore', conffiles: 'preserve-local',
    },
  };
}

async function createAndVerifyRepositoryAuthority(work, packagePath, architecture) {
  const repository = join(work, 'repository-authority');
  const gnupg = join(repository, 'gnupg');
  await mkdir(gnupg, { recursive: true, mode: 0o700 });
  await chmod(gnupg, 0o700);
  const identity = 'Desktop Tools Disposable Repository <fixture@desktop.tools>';
  await command('/usr/bin/gpg', ['--batch', '--homedir', gnupg, '--pinentry-mode', 'loopback', '--passphrase', '',
    '--quick-generate-key', identity, 'ed25519', 'sign', '1y']);
  const listing = await command('/usr/bin/gpg', ['--batch', '--homedir', gnupg, '--with-colons', '--fingerprint', identity]);
  const fingerprint = listing.stdout.split('\n').map(line => line.split(':')).find(fields => fields[0] === 'fpr')?.[9];
  assert.match(fingerprint ?? '', /^(?:[A-F0-9]{40}|[A-F0-9]{64})$/);

  const payloadBytes = await readFile(packagePath);
  const payloadDigest = sha256(payloadBytes);
  const filename = `pool/main/i/${PACKAGE_NAME}/${PACKAGE_NAME}_${PACKAGE_VERSION}_${architecture}.deb`;
  const packagesText = [
    `Package: ${PACKAGE_NAME}`, `Version: ${PACKAGE_VERSION}`, `Architecture: ${architecture}`,
    `Filename: ${filename}`, `Size: ${payloadBytes.length}`, `SHA256: ${payloadDigest}`, '',
  ].join('\n');
  // Keep compressed bytes on disk so they never cross a text conversion boundary.
  const packagesRaw = join(repository, 'Packages');
  const packagesPath = join(repository, 'Packages.xz');
  await writeFile(packagesRaw, packagesText, { mode: 0o600 });
  await command('/usr/bin/xz', ['--compress', '--keep', '--threads=1', '--check=crc64', '--', packagesRaw], {
    env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', XZ_OPT: '-9e' },
  });
  const exactPackagesBytes = await readFile(packagesPath);
  assert.ok(exactPackagesBytes.length > 0);
  const signedAt = new Date('2026-01-01T00:00:00.000Z');
  const validUntil = new Date('2027-01-01T00:00:00.000Z');
  const indexRelativePath = `main/binary-${architecture}/Packages.xz`;
  const releaseText = [
    'Origin: Desktop Tools Disposable Fixture', 'Suite: bookworm', 'Codename: bookworm',
    `Date: ${signedAt.toUTCString()}`, `Valid-Until: ${validUntil.toUTCString()}`,
    `Architectures: ${architecture}`, 'Components: main', 'SHA256:',
    ` ${sha256(exactPackagesBytes)} ${exactPackagesBytes.length} ${indexRelativePath}`, '',
  ].join('\n');
  const releasePath = join(repository, 'Release');
  const inReleasePath = join(repository, 'InRelease');
  const keyringPath = join(repository, 'fixture-keyring.gpg');
  await writeFile(releasePath, releaseText, { mode: 0o600 });
  await command('/usr/bin/gpg', ['--batch', '--homedir', gnupg, '--armor', '--local-user', fingerprint,
    '--output', inReleasePath, '--clear-sign', '--', releasePath]);
  // Export directly to a file so the binary keyring is never decoded as text.
  await command('/usr/bin/gpg', ['--batch', '--homedir', gnupg, '--output', keyringPath, '--export', fingerprint]);
  const [inReleaseBytes, keyringBytes] = await Promise.all([readFile(inReleasePath), readFile(keyringPath)]);
  const descriptor = await createDescriptor(packagePath, architecture);
  descriptor.metadataProof.inRelease = {
    artifactId: 'fixture-inrelease', path: 'dists/bookworm/InRelease', sha256: sha256(inReleaseBytes),
    sizeBytes: inReleaseBytes.length, signedAt: signedAt.toISOString(), validUntil: validUntil.toISOString(),
    maximumDateAgeSeconds: null, signingKeyFingerprint: fingerprint,
    keyring: { artifactId: 'fixture-keyring', sha256: sha256(keyringBytes), sizeBytes: keyringBytes.length,
      mediaType: 'application/vnd.gnupg.keyring' },
  };
  descriptor.metadataProof.packagesIndex = {
    artifactId: 'fixture-packages', path: `dists/bookworm/${indexRelativePath}`,
    sha256: sha256(exactPackagesBytes), sizeBytes: exactPackagesBytes.length, architecture,
  };
  descriptor.metadataProof.packageStanza = {
    filename, sha256: payloadDigest, sizeBytes: payloadBytes.length,
    depends: null, preDepends: null, essential: 'absent', multiArch: 'absent',
  };
  const verified = await verifyDebianRepositoryMetadata({ descriptor, inReleaseBytes, keyringBytes,
    packagesIndexBytes: exactPackagesBytes, payloadBytes,
    verifier: createDefaultDebianMetadataVerifier({ keyring: { kind: 'path', absolutePath: keyringPath },
      now: () => new Date('2026-06-01T00:00:00.000Z') }) });
  assert.equal(verified.inReleaseFingerprint, fingerprint);
  assert.equal(verified.payloadSha256, payloadDigest);
  const substitutedIndex = Buffer.from(exactPackagesBytes);
  substitutedIndex[0] ^= 0x01;
  await assert.rejects(verifyDebianRepositoryMetadata({ descriptor, inReleaseBytes, keyringBytes,
    packagesIndexBytes: substitutedIndex, payloadBytes,
    verifier: createDefaultDebianMetadataVerifier({ keyring: { kind: 'path', absolutePath: keyringPath },
      now: () => new Date('2026-06-01T00:00:00.000Z') }) }), /Packages index (?:bytes differ|digest does not match)/);
  return { descriptor, fingerprint, payloadDigest, tamperRejected: true };
}

async function exactPolicyState() {
  const [bytes, metadata] = await Promise.all([readFile(POLICY_PATH), stat(POLICY_PATH)]);
  return { sha256: sha256(bytes), mode: metadata.mode & 0o7777, uid: metadata.uid, gid: metadata.gid };
}

async function serviceState() {
  const enabled = await command('/usr/bin/systemctl', ['is-enabled', '--', SERVICE], { allowFailure: true });
  const active = await command('/usr/bin/systemctl', ['is-active', '--', SERVICE], { allowFailure: true });
  return { enabled: enabled.code === 0 && enabled.stdout.trim() === 'enabled', running: active.code === 0 && active.stdout.trim() === 'active' };
}

async function executeDpkg(request, controller, interruptAfterUnpack) {
  const arguments_ = request.action === 'unpack'
    ? ['--force-confold', '--no-triggers', '--unpack', '--', '/proc/self/fd/3']
    : ['--force-confold', '--no-triggers', '--configure', '--', request.packageName];
  const policy = await command(POLICY_PATH, [], { allowFailure: true });
  assert.equal(policy.code, 101, 'runtime policy-rc.d helper was not active at the mutation boundary');
  const stdio = request.action === 'unpack' ? ['ignore', 'ignore', 'pipe', request.payloadDescriptor] : ['ignore', 'ignore', 'pipe'];
  const result = await command('/usr/bin/dpkg', arguments_, {
    allowFailure: true,
    stdio,
    env: {
      PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C', LC_ALL: 'C',
      DEBIAN_FRONTEND: 'noninteractive', DEBCONF_NONINTERACTIVE_SEEN: 'true',
    },
  });
  actionLog.push(request.action);
  if (interruptAfterUnpack && request.action === 'unpack' && result.code === 0) {
    await command('/usr/bin/systemctl', ['disable', '--now', '--', SERVICE]);
    controller.abort(new Error('fixture boundary interruption'));
  }
  return { code: result.code, stderr: result.stderr.replace(/[\0\r\n]+/g, ' ').trim().slice(0, 1024) };
}

async function main() {
  assert.equal((await readFile('/proc/1/comm', 'utf8')).trim(), 'systemd', 'fixture does not have systemd as PID 1');
  await assertNativeDpkgNetworkDenied();
  const networkInterfaces = (await readdir('/sys/class/net', { withFileTypes: true }))
    .filter(entry => entry.isSymbolicLink() || entry.isDirectory()).map(entry => entry.name).sort();
  const processStatus = await readFile('/proc/self/status', 'utf8');
  const capabilityValues = ['CapEff', 'CapBnd'].map(name => {
    const match = new RegExp(`^${name}:\\s*([0-9A-Fa-f]+)$`, 'm').exec(processStatus);
    assert.ok(match, `${name} evidence is missing`);
    return BigInt(`0x${match[1]}`);
  });
  const capNetAdmin = capabilityValues.some(value => (value & (1n << 12n)) !== 0n);
  assert.equal(capNetAdmin, false);
  const systemState = await command('/usr/bin/systemctl', ['is-system-running'], { allowFailure: true });
  assert.match(systemState.stdout.trim(), /^(running|degraded)$/, 'systemd manager is not operational');

  const work = await mkdtemp(join(tmpdir(), 'install-doctor-native-pid1-'));
  await mkdir('/etc/systemd/system', { recursive: true });
  await writeFile(`/etc/systemd/system/${SERVICE}`, [
    '[Unit]', 'Description=Install Doctor native fixture', '[Service]', 'Type=simple',
    'ExecStart=/bin/sleep infinity', '[Install]', 'WantedBy=multi-user.target', '',
  ].join('\n'), { mode: 0o644 });
  await command('/usr/bin/systemctl', ['daemon-reload']);
  await command('/usr/bin/systemctl', ['enable', '--now', '--', SERVICE]);
  const initialService = await serviceState();
  assert.deepEqual(initialService, { enabled: true, running: true });

  await writeFile(POLICY_PATH, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await chmod(POLICY_PATH, 0o755);
  const initialPolicy = await exactPolicyState();
  const architecture = (await command('/usr/bin/dpkg', ['--print-architecture'])).stdout.trim();
  assert.ok(architecture === 'amd64' || architecture === 'arm64');
  const packagePath = await buildPackage(work, architecture);
  const repositoryAuthority = await createAndVerifyRepositoryAuthority(work, packagePath, architecture);
  const reproductionRoot = join(work, 'reproduction');
  await mkdir(reproductionRoot, { recursive: true });
  const reproducedPackagePath = await buildPackage(reproductionRoot, architecture);
  const reproduciblePackage = sha256(await readFile(packagePath)) === sha256(await readFile(reproducedPackagePath));
  assert.equal(reproduciblePackage, true, 'fixture package bytes differ across identical builds');
  const descriptor = await createDescriptor(packagePath, architecture);
  const inspectionHandle = await open(packagePath, 'r');
  let control;
  try { control = await inspectNativeDebianPackage({ descriptor, payloadHandle: inspectionHandle }); }
  finally { await inspectionHandle.close(); }

  let transaction;
  const persistence = {
    async load() {
      try { return JSON.parse(await readFile(TRANSACTION_PATH, 'utf8')); }
      catch (error) { if (error?.code === 'ENOENT') return undefined; throw error; }
    },
    async save(value) { transaction = structuredClone(value); await atomicJson(TRANSACTION_PATH, value); },
  };
  const authority = (action, signal) => ({
    operation: { kind: 'native-package', effectClass: 'native-package', action, packageKey: PACKAGE_KEY, payloadArtifactId: descriptor.artifact.id },
    rootDescriptor: descriptor,
    packages: [{
      descriptor,
      metadata: {
        packageName: descriptor.package.name, packageVersion: descriptor.package.version,
        packageArchitecture: descriptor.package.architecture, payloadSha256: descriptor.artifact.sha256,
      },
      control,
    }],
    withPayload: async (packageKey, use) => {
      assert.equal(packageKey, PACKAGE_KEY);
      const handle = await open(packagePath, 'r');
      try { return await use(handle); } finally { await handle.close(); }
    },
    context: { signal, attempt: 1, output() {} },
  });
  const compareDebianVersions = await createTrustedDebianVersionComparator();
  const makeRuntime = (controller, interruptAfterUnpack = false) => createNativeDpkgTransactionRuntime({
    identity: { runId: 'pid1-acceptance', hostId: 'debian-bookworm-pid1', planDigest: PLAN_DIGEST },
    persistence,
    compareDebianVersions,
    executeDpkg: async request => await executeDpkg(request, controller, interruptAfterUnpack),
  });

  const controller = new AbortController();
  await assert.rejects(makeRuntime(controller, true).apply(authority('apply', controller.signal)), /fixture boundary interruption/);
  assert.equal(transaction.phase, 'blocked');
  assert.equal(transaction.packages[0].phase, 'unpacked');
  const interruptedPolicyRestored = JSON.stringify(await exactPolicyState()) === JSON.stringify(initialPolicy);
  const interruptedServiceRestored = JSON.stringify(await serviceState()) === JSON.stringify(initialService);
  assert.equal(interruptedPolicyRestored, true);
  assert.equal(interruptedServiceRestored, true);

  const resumeStart = actionLog.length;
  const resumeController = new AbortController();
  await makeRuntime(resumeController).apply(authority('apply', resumeController.signal));
  const resumeActions = actionLog.slice(resumeStart);
  const resumeConfigureOnly = JSON.stringify(resumeActions) === JSON.stringify(['configure']);
  assert.equal(resumeConfigureOnly, true, `resume actions were ${JSON.stringify(resumeActions)}`);
  assert.equal(transaction.phase, 'completed');

  const secondStart = actionLog.length;
  const secondController = new AbortController();
  await makeRuntime(secondController).apply(authority('apply', secondController.signal));
  const unchangedSecondApply = actionLog.length === secondStart;
  assert.equal(unchangedSecondApply, true);
  assert.equal(await makeRuntime(new AbortController()).verify(authority('verify', new AbortController().signal)), 'verified');

  const policyRestoredExactly = JSON.stringify(await exactPolicyState()) === JSON.stringify(initialPolicy);
  const serviceRestoredExactly = JSON.stringify(await serviceState()) === JSON.stringify(initialService);
  assert.equal(policyRestoredExactly, true);
  assert.equal(serviceRestoredExactly, true);
  const audit = await command('/usr/bin/dpkg', ['--audit'], { allowFailure: true });
  const triggerStates = await command('/usr/bin/dpkg-query', ['--show', '--showformat=${binary:Package}\t${db:Status-Status}\n']);
  const noPendingTriggers = audit.code === 0 && audit.stdout.trim() === '' && !/\ttriggers-(?:awaited|pending)$/m.test(triggerStates.stdout);
  assert.equal(noPendingTriggers, true);
  const installed = await command('/usr/bin/dpkg-query', ['--show', `--showformat=\${db:Status-Status}\t\${Version}\n`, '--', PACKAGE_NAME]);
  assert.equal(installed.stdout, `installed\t${PACKAGE_VERSION}\n`);
  const [dpkgVersion, systemdVersion, runtimeBytes] = await Promise.all([
    command('/usr/bin/dpkg', ['--version']),
    command('/usr/bin/systemctl', ['--version']),
    readFile(new URL('./dist/native-dpkg-transaction.js', import.meta.url)),
  ]);

  const receipt = {
    schemaVersion: 1,
    kind: 'install-doctor-native-dpkg-pid1-acceptance',
    observed: {
      os: 'debian', version: '12', pid1: 'systemd', networkInterfaces, capNetAdmin, architecture,
      nodeVersion: process.version, dpkgVersion: dpkgVersion.stdout.split('\n')[0], systemdVersion: systemdVersion.stdout.split('\n')[0],
    },
    subject: { runtimeSha256: sha256(runtimeBytes), packageSha256: descriptor.artifact.sha256 },
    assertions: {
      realControlAdmission: true, realDpkgMutation: true, networkDenied: true,
      repositoryMetadataVerified: true,
      repositoryTamperRejected: repositoryAuthority.tamperRejected,
      boundaryInterruptionRecorded: true, resumeConfigureOnly, unchangedSecondApply,
      policyRestoredExactly, serviceRestoredExactly, noPendingTriggers, reproduciblePackage,
    },
    repositoryAuthority: { signingKeyFingerprint: repositoryAuthority.fingerprint,
      payloadSha256: repositoryAuthority.payloadDigest },
    limitation: 'Interruption is injected after a real dpkg unpack returns at the runtime safe boundary; this fixture does not claim SIGKILL or power-loss coverage inside dpkg.',
    finishedAt: new Date().toISOString(),
  };
  await atomicJson(receiptPath, receipt);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  await rm(work, { recursive: true, force: true });
}

await main();
