import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deriveBoundNormalizedPlan } from '../dist/engine.js';
import { composeNativeDebianPackageSlice } from '../dist/native-debian-composition.js';
import {
  PrivilegedBrokerExecutionAuthoritySchema,
  privilegedBrokerDescriptorDigest,
  privilegedBrokerExecutionAuthorityDigest,
} from '../dist/privileged-broker-authority.js';
import { createPrivilegedBrokerStore } from '../dist/privileged-broker-store.js';
import { privilegedBrokerDigest } from '../dist/privileged-broker-protocol.js';

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
  const authority = {
    schemaVersion: 1, hostId: 'host-1', releaseId: 'release-1', runId: 'run-1', planDigest: plan.digest,
    plan, operations: composed.operations, desiredState: composed.desiredState, hostFacts: facts, descriptor: payload,
    releaseProof: { manifestPath: '/run/desktop-tools/release/manifest', signaturePath: '/run/desktop-tools/release/manifest.sig',
      catalogPath: '/run/desktop-tools/release/catalog.json', manifestSha256: '1'.repeat(64),
      trust: { keyId: 'desktop-release', publicKey: `ssh-ed25519 ${'A'.repeat(43)}=` } },
    artifacts: [
      { artifactId: 'keyring', url: 'https://desktop.tools/releases/release-1/keyring', sourcePath: '/run/desktop-tools/release/keyring', sha256: hash('keyring'), sizeBytes: 10, mode: '0600' },
      { artifactId: 'packages', url: 'https://desktop.tools/releases/release-1/packages', sourcePath: '/run/desktop-tools/release/packages', sha256: hash('packages'), sizeBytes: 10, mode: '0600' },
      { artifactId: 'release', url: 'https://desktop.tools/releases/release-1/inrelease', sourcePath: '/run/desktop-tools/release/inrelease', sha256: hash('release'), sizeBytes: 10, mode: '0600' },
      { artifactId: 'tree-deb', url: 'https://desktop.tools/releases/release-1/tree.deb', sourcePath: '/run/desktop-tools/release/tree.deb', sha256: hash('tree'), sizeBytes: 10, mode: '0600' },
    ], transactionRoot: '/var/lib/desktop-tools/transactions/run-1',
  };
  return { authority: PrivilegedBrokerExecutionAuthoritySchema.parse(authority), plan, payload };
}

test('root execution authority is exact, grant-bound, create-only, and independently readable', async t => {
  const { authority, plan, payload } = await fixture();
  const root = await mkdtemp(join(tmpdir(), 'broker-authority-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await createPrivilegedBrokerStore({ root, ownerUid: process.getuid(), verifyApproval: async () => true });
  const closureDigest = privilegedBrokerExecutionAuthorityDigest(authority);
  const grant = { schemaVersion: 1, grantId: 'grant-1', hostId: 'host-1', releaseId: 'release-1', runId: 'run-1',
    planDigest: plan.digest, approvedPlanDigest: plan.digest, enrolledUid: process.getuid(),
    brokerExecutableDigest: '6'.repeat(64), runtimeDigest: '7'.repeat(64), workerDigest: '8'.repeat(64),
    operations: Object.entries(authority.operations.operations).map(([operationId, operation]) => ({ taskId: authority.plan.selectedTaskIds[0], operationId, phase: operation.action })),
    descriptorDigest: privilegedBrokerDescriptorDigest(payload), closureDigest, consentDigest: '2'.repeat(64),
    issuedAt: '2026-11-08T12:00:00.000Z', expiresAt: '2026-11-08T12:05:00.000Z' };
  const approval = { schemaVersion: 1, approvalId: 'approval-1', method: 'signed-device',
    grantId: grant.grantId, grantDigest: privilegedBrokerDigest(grant), hostId: grant.hostId, releaseId: grant.releaseId,
    runId: grant.runId, planDigest: plan.digest, enrolledUid: grant.enrolledUid,
    brokerExecutableDigest: grant.brokerExecutableDigest, runtimeDigest: grant.runtimeDigest, workerDigest: grant.workerDigest,
    descriptorDigest: grant.descriptorDigest, closureDigest: grant.closureDigest,
    consentDigest: grant.consentDigest, evidenceDigest: '3'.repeat(64), approvedAt: '2026-11-08T12:00:00.000Z',
    proof: { signerKeyId: 'device-key-1', signature: 'a'.repeat(64) } };
  await store.publishGrant(grant, approval);
  const published = await store.publishAuthority('grant-1', authority);
  assert.equal(published.digest, closureDigest);
  assert.equal((await store.readAuthority('grant-1')).digest, closureDigest);
  await assert.rejects(store.publishAuthority('grant-1', { ...authority, runId: 'run-2' }), /differs from the exact grant|semantic closure/);
});

test('authority rejects path, operation, artifact, and semantic identity drift', async () => {
  const { authority } = await fixture();
  for (const mutate of [
    value => { value.artifacts[0].sourcePath = 'relative'; },
    value => { value.artifacts[0].sha256 = 'f'.repeat(64); },
    value => { value.operations.operations['native-debian-tree-apply'].packageKey = 'other'; },
    value => { value.hostId = 'other'; },
  ]) {
    const candidate = structuredClone(authority); mutate(candidate);
    assert.throws(() => PrivilegedBrokerExecutionAuthoritySchema.parse(candidate));
  }
});
