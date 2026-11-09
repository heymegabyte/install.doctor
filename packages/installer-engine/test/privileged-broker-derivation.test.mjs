import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { deriveBoundNormalizedPlan } from '../dist/engine.js';
import { composeNativeDebianPackageSlice } from '../dist/native-debian-composition.js';
import { derivePrivilegedBrokerAuthority } from '../dist/privileged-broker-derivation.js';
import { PrivilegedBrokerControllerInputSchema } from '../dist/privileged-broker-controller-contract.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const compare = (left, right) => left.localeCompare(right, undefined, { numeric: true });
const descriptor = () => ({
  schemaVersion: 1, kind: 'native-offline-package', manager: 'dpkg', packageKey: 'tree',
  platform: { os: 'linux', arch: 'x64' }, package: { name: 'tree', version: '2.1.0-1', architecture: 'amd64' },
  artifact: { id: 'tree-deb', sha256: hash('tree'), sizeBytes: 10, mediaType: 'application/vnd.debian.binary-package' },
  distro: { id: 'debian', versionId: '12', codename: 'bookworm' },
  repository: { repositoryOrigin: 'https://deb.debian.org/debian', suite: 'bookworm', component: 'main' },
  metadataProof: {
    inRelease: { artifactId: 'release', path: 'dists/bookworm/InRelease', sha256: hash('release'), sizeBytes: 10,
      signedAt: '2026-01-01T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z', maximumDateAgeSeconds: null,
      signingKeyFingerprint: 'A'.repeat(40), keyring: { artifactId: 'keyring', sha256: hash('keyring'), sizeBytes: 10, mediaType: 'application/vnd.gnupg.keyring' } },
    packagesIndex: { artifactId: 'packages', path: 'dists/bookworm/main/binary-amd64/Packages.xz', sha256: hash('packages'), sizeBytes: 10, architecture: 'amd64' },
    packageStanza: { filename: 'pool/main/t/tree/tree_2.1.0-1_amd64.deb', sha256: hash('tree'), sizeBytes: 10,
      depends: 'libc6 (>= 2.34)', preDepends: null, essential: 'no', multiArch: 'foreign' },
  }, dependencyClosure: { depends: [], preDepends: [] }, affectedServiceUnits: [], conffiles: [],
  maintainerScriptPolicy: { trust: 'signed-repository-metadata', network: 'deny', serviceStarts: 'suppress-and-restore', conffiles: 'preserve-local' },
});

async function fixture() {
  const payload = descriptor();
  const desired = { schemaVersion: 1, revision: 'revision-1', hostId: 'host-1', packages: ['tree'], services: [], consents: [], offline: false };
  const composed = composeNativeDebianPackageSlice({ descriptor: payload,
    target: { distroId: 'debian', versionId: '12', codename: 'bookworm', architecture: 'amd64' },
    installedWitnesses: [{ kind: 'preexisting-witness', manager: 'dpkg', packageName: 'libc6', version: '2.36-9', architecture: 'amd64', status: 'installed', healthy: true, held: false }],
    desiredState: desired, legacyPackages: ['tree'], compareDebianVersions: compare });
  const facts = { schemaVersion: 1, hostId: 'host-1', collectedAt: '2026-11-08T12:00:00.000Z', os: 'linux', osVersion: '12', arch: 'x64', environment: 'native',
    roles: ['server'], packageManagers: ['dpkg'], capabilities: ['network-namespace'] };
  const plan = await deriveBoundNormalizedPlan({ tasks: [composed.task], selectedTaskIds: [composed.task.id],
    executionPolicy: { maxConcurrency: 1, resourceLimits: { cpu: 2, memoryMiB: 1024, networkConcurrency: 0 } } },
  facts, composed.desiredState, 'release-1', '2026-11-08T12:00:01.000Z');
  const root = '/run/desktop-tools/authority/release-1';
  return {
    schemaVersion: 1, approvalMode: 'trusted-local', runId: 'run-1', approvedPlanDigest: plan.digest, plan,
    operations: composed.operations.operations, desiredState: composed.desiredState, hostFacts: facts, descriptor: payload,
    releaseProof: { manifestPath: `${root}/manifest`, signaturePath: `${root}/manifest.sig`, catalogPath: `${root}/catalog.json`,
      manifestSha256: '1'.repeat(64), trust: { keyId: 'desktop-release', publicKey: `ssh-ed25519 ${'A'.repeat(43)}=` } },
    artifacts: [
      { artifactId: 'keyring', url: 'https://desktop.tools/releases/release-1/keyring', sourcePath: `${root}/keyring`, sha256: hash('keyring'), sizeBytes: 10, mode: '0600' },
      { artifactId: 'packages', url: 'https://desktop.tools/releases/release-1/packages', sourcePath: `${root}/packages`, sha256: hash('packages'), sizeBytes: 10, mode: '0600' },
      { artifactId: 'release', url: 'https://desktop.tools/releases/release-1/inrelease', sourcePath: `${root}/inrelease`, sha256: hash('release'), sizeBytes: 10, mode: '0600' },
      { artifactId: 'tree-deb', url: 'https://desktop.tools/releases/release-1/tree.deb', sourcePath: `${root}/tree.deb`, sha256: hash('tree'), sizeBytes: 10, mode: '0600' },
    ],
    transactionRoot: '/var/lib/desktop-tools/transactions/run-1', enrolledUid: 501, socketGid: 20,
    helperPath: `${root}/desktop-tools-privileged-broker`, helperDigest: '6'.repeat(64),
    runtimePath: `${root}/node`, runtimeDigest: '7'.repeat(64), workerPath: `${root}/worker.mjs`, workerDigest: '8'.repeat(64),
    socketPath: '/run/desktop-tools/broker/run-1/broker.sock', issuedAt: '2026-11-08T12:00:00.000Z', expiresAt: '2026-11-08T12:05:00.000Z',
    operationTimeoutMs: 120_000,
  };
}

test('derivation projects one approved plan into one exact grant and controller input', async () => {
  const input = await fixture();
  const derived = derivePrivilegedBrokerAuthority(input);
  assert.equal(derived.grant.planDigest, input.plan.digest);
  assert.deepEqual(derived.authority.plan, input.plan);
  assert.deepEqual(derived.controllerInput.grant, derived.grant);
  assert.deepEqual(derived.clientConfig.grant, derived.grant);
  assert.equal(derived.clientConfig.socketPath, input.socketPath);
  assert.equal(derived.controllerInput.requestLimit, 3);
  assert.deepEqual(derived.grant.operations.map(operation => operation.phase).sort(), ['apply', 'check', 'verify']);
});

test('derivation rejects plan, operation, descriptor, and socket identity drift', async () => {
  const input = await fixture();
  for (const mutate of [
    value => { value.approvedPlanDigest = '0'.repeat(64); },
    value => { value.operations['native-debian-tree-apply'].packageKey = 'other'; },
    value => { value.descriptor.artifact.sha256 = 'f'.repeat(64); },
    value => { value.socketPath = '/run/desktop-tools/broker/other/broker.sock'; },
  ]) {
    const candidate = structuredClone(input); mutate(candidate);
    assert.throws(() => derivePrivilegedBrokerAuthority(candidate));
  }
});

test('approval mode is explicit and hosted authority never falls back to trusted-local', async () => {
  const local = derivePrivilegedBrokerAuthority(await fixture()).controllerInput;
  assert.equal(local.approvalMode, 'trusted-local');
  assert.throws(() => PrivilegedBrokerControllerInputSchema.parse({ ...local, approvalMode: 'signed-device' }),
    /requires exact approval/);
  assert.throws(() => PrivilegedBrokerControllerInputSchema.parse({ ...local,
    deviceApproval: {}, brokerApprovalDelegationPath: local.helperPath,
    brokerApprovalDelegationDigest: '0'.repeat(64), brokerApprovalMinimumRevocationEpoch: 0 }),
  /Invalid input|trusted-local/);
});
