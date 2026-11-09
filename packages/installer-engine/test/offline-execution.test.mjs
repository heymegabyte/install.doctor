import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { serializeStageZeroReleaseEnvelope } from '../../aid-core/dist/installer-contracts.js';
import {
  canonicalOfflineOperationManifestBytes,
  canonicalOfflineDesiredStateBytes,
  canonicalOfflineHostFactsBytes,
  canonicalNormalizedPlanBytes,
  applyOfflineBundle,
  createOfflineBundle,
  createOfflineInstallerAdapter,
  createOnlineReleaseArtifactResolver,
  createInstallerEngine,
  createRollbackPlan,
  InstallerOperationError,
  createJournalStore,
  executeApprovedUserFileRollback,
  executeOfflineBundle,
  inspectOfflinePlanReadiness,
  offlineExecutionGraphDigest,
  planOfflineBundle,
  validateOfflineExecutionClosure,
  verifyNativeDebianMetadataWithResolver,
  verifyOfflineNativeDebianMetadata,
  verifyOfflineBundle,
  collectLinuxOfflineHostFacts,
} from '../dist/index.js';

const digest = character => character.repeat(64);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const execute = promisify(execFile);
const at = '2026-11-06T04:00:00.000Z';
const later = '2026-11-06T05:00:00.000Z';
const task = (id, dependencies = []) => ({
  schemaVersion: 1, id, inputDigest: digest(id === 'task.prepare' ? '1' : '2'), dependencies,
  predicate: 'offline-supported', operations: { check: `${id}.check`, apply: `${id}.apply`, verify: `${id}.verify` },
  timeoutMs: 5_000, retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
  resources: { cpu: 1, memoryMiB: 32, network: false }, privilege: 'user', network: 'none', consent: 'none',
  lockDomains: [], cleanup: 'always', compensation: 'none', failurePolicy: 'continue-independent',
});

async function fixture(t, options = {}) {
  const fixtureAt = options.at ?? at;
  const fixtureLater = options.later ?? later;
  const root = await mkdtemp(join(tmpdir(), 'install-doctor-offline-execution-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  const outputRoot = join(root, 'bundles');
  await mkdir(source);
  await mkdir(outputRoot);
  const privateKeyPath = join(root, 'signer');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'offline-execution-test', '-f', privateKeyPath]);
  await chmod(privateKeyPath, 0o600);
  const trust = { keyId: 'offline-execution-test', publicKey: (await readFile(`${privateKeyPath}.pub`, 'utf8')).trim() };
  const releaseKeyPath = join(root, 'release-signer');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'release-test', '-f', releaseKeyPath]);
  await chmod(releaseKeyPath, 0o600);
  const releaseTrust = { keyId: 'release-test', publicKey: (await readFile(`${releaseKeyPath}.pub`, 'utf8')).trim() };
  const executable = join(source, 'fixture-operation');
  await writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const unusedExecutable = join(source, 'unused-operation');
  await writeFile(unusedExecutable, '#!/bin/sh\nexit 0 # unused\n', { mode: 0o700 });
  const engine = join(source, 'engine');
  const catalog = join(source, 'catalog');
  await writeFile(engine, '#!/usr/bin/env node\nprocess.exit(0)\n', { mode: 0o700 });
  const executableBytes = await readFile(executable);
  const executableDescriptor = {
    schemaVersion: 1, id: 'fixture-operation', version: '1.0.0',
    platform: { os: 'linux', arch: 'x64' },
    source: {
      url: 'https://github.com/fixture/install-doctor/releases/download/v1.0.0/fixture-operation',
      sha256: sha(executableBytes), sizeBytes: executableBytes.length,
    },
    destination: { root: 'user-bin', filename: 'fixture-operation', mode: '0700' },
  };
  const armExecutableDescriptor = {
    ...executableDescriptor,
    platform: { os: 'linux', arch: 'arm64' },
    source: {
      ...executableDescriptor.source,
      url: 'https://github.com/fixture/install-doctor/releases/download/v1.0.0/fixture-operation-arm64',
    },
  };
  const unusedExecutableBytes = await readFile(unusedExecutable);
  const unusedExecutableDescriptor = {
    schemaVersion: 1, id: 'unused-operation', version: '1.0.0', platform: { os: 'linux', arch: 'x64' },
    source: {
      url: 'https://github.com/fixture/install-doctor/releases/download/v1.0.0/unused-operation',
      sha256: sha(unusedExecutableBytes), sizeBytes: unusedExecutableBytes.length,
    },
    destination: { root: 'user-bin', filename: 'unused-operation', mode: '0700' },
  };
  const nativePayload = join(source, 'fixture-package');
  const inRelease = join(source, 'fixture-inrelease');
  const packagesIndex = join(source, 'fixture-packages-index');
  const repositoryKeyring = join(source, 'fixture-repository-keyring');
  await writeFile(nativePayload, 'exact deb payload\n', { mode: 0o600 });
  const nativeBytes = await readFile(nativePayload);
  const packagesText = [
    'Package: fixture-operation', 'Version: 1.0.0-1', 'Architecture: amd64',
    'Filename: pool/main/f/fixture-operation/fixture-operation_1.0.0-1_amd64.deb',
    `Size: ${nativeBytes.length}`, `SHA256: ${sha(nativeBytes)}`, 'Essential: no', '',
  ].join('\n');
  await writeFile(inRelease, 'verified opaque InRelease fixture\n', { mode: 0o600 });
  await writeFile(packagesIndex, packagesText, { mode: 0o600 });
  await writeFile(repositoryKeyring, 'exact repository keyring bytes\n', { mode: 0o600 });
  const inReleaseBytes = await readFile(inRelease);
  const packagesBytes = await readFile(packagesIndex);
  const repositoryKeyringBytes = await readFile(repositoryKeyring);
  const nativePayloadDescriptor = {
    schemaVersion: 1, kind: 'native-offline-package', manager: 'dpkg', packageKey: 'fixture-operation',
    platform: { os: 'linux', arch: 'x64' },
    package: { name: 'fixture-operation', version: '1.0.0-1', architecture: 'amd64' },
    artifact: { id: 'fixture-package', sha256: sha(nativeBytes), sizeBytes: nativeBytes.length, mediaType: 'application/vnd.debian.binary-package' },
    distro: { id: 'ubuntu', versionId: '24.04', codename: 'noble' },
    repository: { repositoryOrigin: 'https://archive.ubuntu.com/ubuntu', suite: 'noble', component: 'main' },
    metadataProof: {
      inRelease: { artifactId: 'fixture-inrelease', path: 'dists/noble/InRelease', sha256: sha(inReleaseBytes), sizeBytes: inReleaseBytes.length, signedAt: at, validUntil: later, maximumDateAgeSeconds: null, signingKeyFingerprint: 'A'.repeat(40), keyring: { artifactId: 'fixture-repository-keyring', sha256: sha(repositoryKeyringBytes), sizeBytes: repositoryKeyringBytes.length, mediaType: 'application/vnd.gnupg.keyring' } },
      packagesIndex: { artifactId: 'fixture-packages-index', path: 'dists/noble/main/binary-amd64/Packages.xz', sha256: sha(packagesBytes), sizeBytes: packagesBytes.length, architecture: 'amd64' },
      packageStanza: { filename: 'pool/main/f/fixture-operation/fixture-operation_1.0.0-1_amd64.deb', sha256: sha(nativeBytes), sizeBytes: nativeBytes.length, depends: null, preDepends: null, essential: 'no', multiArch: 'absent' },
    },
    dependencyClosure: { depends: [], preDepends: [] }, affectedServiceUnits: [], conffiles: [],
    maintainerScriptPolicy: { trust: 'signed-repository-metadata', network: 'deny', serviceStarts: 'suppress-and-restore', conffiles: 'preserve-local' },
  };
  await writeFile(catalog, `${JSON.stringify([{
    name: 'fixture-operation', bin: 'fixture-operation', platforms: ['linux'], installMode: 'cli',
    loadPolicy: 'lazy', loadRationale: 'default-lazy', deps: [], artifacts: [executableDescriptor, armExecutableDescriptor], offlinePayloads: [nativePayloadDescriptor],
  }, {
    name: 'unused-operation', bin: 'unused-operation', platforms: ['linux'], installMode: 'cli',
    loadPolicy: 'lazy', loadRationale: 'default-lazy', deps: [], artifacts: [unusedExecutableDescriptor],
  }])}\n`, { mode: 0o600 });
  const releaseEnvelope = join(source, 'release-envelope');
  const releaseSignature = join(source, 'release-signature');
  await writeFile(releaseEnvelope, serializeStageZeroReleaseEnvelope({
    schemaVersion: 4, releaseId: 'release-1', sourceCommit: '1'.repeat(40),
    createdAt: Math.floor(Date.parse(fixtureAt) / 1000), expiresAt: Math.floor(Date.parse(fixtureLater) / 1000), keyId: releaseTrust.keyId,
    artifactUrl: 'https://app.install.doctor/releases/release-1/provision.sh', artifactSha256: '1'.repeat(64), artifactSize: 1,
    engineUrl: 'https://app.install.doctor/releases/release-1/install-doctor-engine.mjs', engineSha256: sha(await readFile(engine)), engineSize: (await stat(engine)).size, engineNodeMin: 22,
    catalogUrl: 'https://app.install.doctor/releases/release-1/catalog.json', catalogSha256: sha(await readFile(catalog)), catalogSize: (await stat(catalog)).size,
    runtimeNodeVersion: '24.1.0',
    runtimes: Object.fromEntries(['macos-x64','macos-arm64','linux-x64','linux-arm64'].map(name => [name, {
      url: `https://app.install.doctor/releases/release-1/node-${name}.tar.gz`, sha256: '2'.repeat(64), size: 1,
    }])),
  }), { mode: 0o600 });
  execFileSync('ssh-keygen', ['-Y', 'sign', '-q', '-f', releaseKeyPath, '-n', 'install.doctor.release', releaseEnvelope]);
  await rename(`${releaseEnvelope}.sig`, releaseSignature);
  const tasks = [task('task.install', ['task.prepare']), task('task.prepare')];
  const facts = options.facts ?? {
    schemaVersion: 1, hostId: 'offline-host', collectedAt: at, os: 'linux', osVersion: '24.04', arch: 'x64',
    environment: 'native', roles: ['fixture'], packageManagers: [], capabilities: [],
  };
  const desiredState = {
    schemaVersion: 1, revision: 'revision-1', hostId: facts.hostId,
    packages: [], services: [], consents: [], offline: true,
  };
  const plan = await createInstallerEngine({
    adapter: {
      discover: async () => facts,
      plan: async () => ({ tasks, selectedTaskIds: ['task.install'] }),
      check: async () => 'needed', apply: async () => {}, verify: async () => 'verified',
    },
    now: () => fixtureAt,
  }).plan(facts, desiredState, 'release-1');
  const operations = {
    schemaVersion: 4,
    configurationRoots: [],
    operations: Object.fromEntries(tasks.flatMap(item => Object.values(item.operations).map(operationId => [operationId, {
      kind: 'process', effectClass: 'catalog-executable',
      executableArtifactId: 'fixture-operation', arguments: [{ kind: 'literal', value: operationId }],
    }]))),
  };
  const planPath = join(source, 'normalized-plan');
  const operationsPath = join(source, 'operation-manifest');
  const desiredStatePath = join(source, 'desired-state');
  const hostFactsPath = join(source, 'host-facts');
  await writeFile(planPath, `${JSON.stringify(plan)}\n`, { mode: 0o600 });
  await writeFile(operationsPath, canonicalOfflineOperationManifestBytes(operations), { mode: 0o600 });
  const makeBundle = async ({
    candidatePlan = plan, candidateOperations = operations, candidateDesiredState = desiredState, candidateFacts = facts,
    graphDigest, extraArtifacts = [], includeFixtureExecutable = true, bundleOutputRoot = outputRoot,
  } = {}) => {
    await writeFile(planPath, canonicalNormalizedPlanBytes(candidatePlan), { mode: 0o600 });
    await writeFile(operationsPath, canonicalOfflineOperationManifestBytes(candidateOperations), { mode: 0o600 });
    await writeFile(desiredStatePath, canonicalOfflineDesiredStateBytes(candidateDesiredState), { mode: 0o600 });
    await writeFile(hostFactsPath, canonicalOfflineHostFactsBytes(candidateFacts), { mode: 0o600 });
    return createOfflineBundle({
      outputRoot: bundleOutputRoot, releaseId: candidatePlan.releaseId, planDigest: candidatePlan.digest,
      graphDigest: graphDigest ?? offlineExecutionGraphDigest(candidatePlan, candidateOperations, candidateDesiredState, candidateFacts),
      platform: { os: candidateFacts.os, arch: candidateFacts.arch, environment: candidateFacts.environment }, selectedTaskIds: candidatePlan.selectedTaskIds,
      createdAt: fixtureAt, expiresAt: fixtureLater, signer: { keyId: trust.keyId, privateKeyPath }, releaseTrust,
      artifacts: [
        { id: 'engine', sourcePath: engine, mediaType: 'text/javascript', mode: '0700', license: 'MIT', schema: null, containsSecrets: false },
        { id: 'catalog', sourcePath: catalog, mediaType: 'application/json', mode: '0600', license: 'MIT', schema: { id: 'software-catalog', version: '1' }, containsSecrets: false },
        { id: 'release-envelope', sourcePath: releaseEnvelope, mediaType: 'text/plain', mode: '0600', license: 'MIT', schema: { id: 'stage-zero-release-envelope', version: '4' }, containsSecrets: false },
        { id: 'release-signature', sourcePath: releaseSignature, mediaType: 'application/octet-stream', mode: '0600', license: 'MIT', schema: null, containsSecrets: false },
        { id: 'normalized-plan', sourcePath: planPath, mediaType: 'application/json', mode: '0600', license: 'MIT', schema: { id: 'normalized-plan', version: '1' }, containsSecrets: false },
        { id: 'operation-manifest', sourcePath: operationsPath, mediaType: 'application/json', mode: '0600', license: 'MIT', schema: { id: 'operation-manifest', version: '4' }, containsSecrets: false },
        { id: 'desired-state', sourcePath: desiredStatePath, mediaType: 'application/json', mode: '0600', license: 'MIT', schema: { id: 'desired-state', version: '1' }, containsSecrets: false },
        { id: 'host-facts', sourcePath: hostFactsPath, mediaType: 'application/json', mode: '0600', license: 'MIT', schema: { id: 'host-facts', version: '1' }, containsSecrets: false },
        ...(includeFixtureExecutable ? [{ id: 'fixture-operation', sourcePath: executable, mediaType: 'application/octet-stream', mode: '0700', license: 'MIT', schema: null, catalogDescriptor: { ...executableDescriptor, kind: 'immutable-executable' }, containsSecrets: false }] : []),
        ...extraArtifacts,
      ],
    });
  };
  return {
    root, source, outputRoot, trust, releaseTrust, plan, operations, facts, desiredState,
    executable, executableDescriptor, armExecutableDescriptor, unusedExecutable, unusedExecutableDescriptor,
    nativePayload, inRelease, packagesIndex, repositoryKeyring, nativePayloadDescriptor, makeBundle,
  };
}

async function managedFileFixture(t) {
  const state = await fixture(t);
  const targetDirectory = join(await realpath(state.root), 'managed-targets');
  await mkdir(targetDirectory, { mode: 0o700 });
  const existingTarget = join(targetDirectory, 'existing.conf');
  const newTarget = join(targetDirectory, 'new.conf');
  await writeFile(existingTarget, 'previous\n', { mode: 0o600 });
  const existingCandidate = join(state.source, 'candidate-existing');
  const newCandidate = join(state.source, 'candidate-new');
  await writeFile(existingCandidate, 'managed existing\n', { mode: 0o600 });
  await writeFile(newCandidate, 'managed new\n', { mode: 0o600 });
  const tasks = [
    { ...task('task.managed-existing'), compensation: 'configuration' },
    { ...task('task.managed-new'), compensation: 'configuration' },
  ];
  const plan = await createInstallerEngine({
    adapter: {
      discover: async () => state.facts,
      plan: async () => ({ tasks, selectedTaskIds: tasks.map(item => item.id) }),
      check: async () => 'needed', apply: async () => {}, verify: async () => 'verified',
    },
    now: () => at,
  }).plan(state.facts, state.desiredState, 'release-1');
  const authority = [
    { taskId: 'task.managed-existing', artifactId: 'candidate-existing', targetPath: existingTarget },
    { taskId: 'task.managed-new', artifactId: 'candidate-new', targetPath: newTarget },
  ];
  const operations = {
    schemaVersion: 4,
    configurationRoots: [targetDirectory],
    operations: Object.fromEntries(authority.flatMap(item => ['check', 'apply', 'verify'].map(action => [
      `${item.taskId}.${action}`,
      {
        kind: 'managed-file', effectClass: 'installer-configuration', action, candidateArtifactId: item.artifactId,
        targetPath: item.targetPath, candidateMode: 0o600,
      },
    ]))),
  };
  const created = await state.makeBundle({
    candidatePlan: plan,
    candidateOperations: operations,
    includeFixtureExecutable: false,
    extraArtifacts: [
      { id: 'candidate-existing', sourcePath: existingCandidate, mediaType: 'application/octet-stream', mode: '0600', license: 'MIT', schema: null, containsSecrets: false },
      { id: 'candidate-new', sourcePath: newCandidate, mediaType: 'application/octet-stream', mode: '0600', license: 'MIT', schema: null, containsSecrets: false },
    ],
  });
  const expected = {
    releaseId: plan.releaseId,
    planDigest: plan.digest,
    platform: { os: 'linux', arch: 'x64', environment: 'native' },
    selectedTaskIds: plan.selectedTaskIds,
    artifactIds: ['candidate-existing', 'candidate-new', 'catalog', 'desired-state', 'engine', 'host-facts', 'normalized-plan', 'operation-manifest', 'release-envelope', 'release-signature'],
  };
  const bundlePlan = await planOfflineBundle({
    bundleDirectory: created.bundleDirectory,
    trust: state.trust, releaseTrust: state.releaseTrust,
    expected,
    now: '2026-11-06T04:30:00.000Z',
  });
  const destination = join(state.root, 'managed-materialized');
  await applyOfflineBundle({ plan: bundlePlan, destinationDirectory: destination, trust: state.trust, releaseTrust: state.releaseTrust, now: '2026-11-06T04:30:00.000Z' });
  return { ...state, plan, operations, created, bundlePlan, destination, existingTarget, newTarget, targetDirectory };
}

test('verified bundle recomputes an exact network-free plan and operation closure', async t => {
  const state = await fixture(t);
  const created = await state.makeBundle();
  const verified = await verifyOfflineBundle({ bundleDirectory: created.bundleDirectory, trust: state.trust, releaseTrust: state.releaseTrust });
  const closure = await validateOfflineExecutionClosure(verified);
  assert.equal(closure.plan.digest, state.plan.digest);
  assert.deepEqual(closure.desiredState, state.desiredState);
  assert.deepEqual(closure.hostFacts, state.facts);
  assert.equal(closure.graphDigest, created.manifest.graphDigest);
  assert.deepEqual(closure.selectedTaskIds, ['task.install', 'task.prepare']);
  assert.deepEqual(closure.runtimeArtifactIds, ['fixture-operation']);
  assert.deepEqual(Object.keys(closure.operations.operations).sort(), Object.keys(state.operations.operations).sort());

  const invocationPath = join(state.root, 'execution-plan.json');
  await writeFile(invocationPath, `${JSON.stringify({
    schemaVersion: 2, command: 'bundle-plan', bundleDirectory: created.bundleDirectory, trust: state.trust, releaseTrust: state.releaseTrust,
    expected: {
      releaseId: state.plan.releaseId, planDigest: state.plan.digest,
      platform: { os: 'linux', arch: 'x64', environment: 'native' },
      selectedTaskIds: state.plan.selectedTaskIds,
      artifactIds: ['catalog', 'desired-state', 'engine', 'fixture-operation', 'host-facts', 'normalized-plan', 'operation-manifest', 'release-envelope', 'release-signature'],
    },
    now: '2026-11-06T04:30:00.000Z',
  })}\n`, { mode: 0o600 });
  const cli = new URL('../dist/cli.js', import.meta.url).pathname;
  const cliPlan = JSON.parse((await execute(process.execPath, [cli, '--input', invocationPath], {
    env: { PATH: process.env.PATH ?? '' }, timeout: 10_000, maxBuffer: 2_000_000,
  })).stdout);
  assert.equal(cliPlan.executionClosure.graphDigest, created.manifest.graphDigest);
  assert.deepEqual(cliPlan.executionClosure.runtimeArtifactIds, ['fixture-operation']);
});

test('offline closure preserves and reproduces a non-default execution policy', async t => {
  const state = await fixture(t);
  const policy = { maxConcurrency: 2, resourceLimits: { cpu: 8, memoryMiB: 4096, networkConcurrency: 0 } };
  const candidatePlan = await createInstallerEngine({
    ...policy,
    adapter: {
      discover: async () => state.facts,
      plan: async () => ({ tasks: state.plan.tasks, selectedTaskIds: state.plan.selectedTaskIds }),
      check: async () => 'needed', apply: async () => {}, verify: async () => 'verified',
    },
    now: () => at,
  }).plan(state.facts, state.desiredState, state.plan.releaseId);
  const created = await state.makeBundle({ candidatePlan });
  const verified = await verifyOfflineBundle({ bundleDirectory: created.bundleDirectory, trust: state.trust, releaseTrust: state.releaseTrust });
  const closure = await validateOfflineExecutionClosure(verified);
  assert.deepEqual(closure.plan.executionPolicy, policy);
  assert.equal(closure.plan.digest, candidatePlan.digest);
});

test('runtime package artifacts require exact selected signed-catalog authority before materialization', async t => {
  const missing = await fixture(t);
  await assert.rejects(
    missing.makeBundle({
      includeFixtureExecutable: false,
      extraArtifacts: [{
        id: 'fixture-operation', sourcePath: missing.executable, mediaType: 'application/octet-stream',
        mode: '0700', license: 'MIT', schema: null, containsSecrets: false,
      }],
    }),
    /lacks signed catalog authority/,
  );

  const wrongPlatform = await fixture(t);
  await assert.rejects(wrongPlatform.makeBundle({
    includeFixtureExecutable: false,
    extraArtifacts: [{
      id: 'fixture-operation', sourcePath: wrongPlatform.executable, mediaType: 'application/octet-stream',
      mode: '0700', license: 'MIT', schema: null, catalogDescriptor: { ...wrongPlatform.armExecutableDescriptor, kind: 'immutable-executable' }, containsSecrets: false,
    }],
  }), /wrong signed catalog platform/);

  const substituted = await fixture(t);
  await writeFile(substituted.executable, '#!/bin/sh\nexit 9\n', { mode: 0o700 });
  await assert.rejects(substituted.makeBundle(), /bytes or identity.*signed catalog descriptor/);

  const duplicate = await fixture(t);
  const artifact = {
    id: 'fixture-operation', sourcePath: duplicate.executable, mediaType: 'application/octet-stream',
    mode: '0700', license: 'MIT', schema: null, catalogDescriptor: { ...duplicate.executableDescriptor, kind: 'immutable-executable' }, containsSecrets: false,
  };
  await assert.rejects(duplicate.makeBundle({ includeFixtureExecutable: false, extraArtifacts: [artifact, artifact] }), /duplicate artifact ids/);
});

test('offline operation v4 rejects generic v3 migration, implicit effects, and unsupported native mutation domains', async t => {
  assert.throws(() => canonicalOfflineOperationManifestBytes({ schemaVersion: 3, configurationRoots: [], operations: {} }), /expected 4/i);
  assert.throws(() => canonicalOfflineOperationManifestBytes({
    schemaVersion: 4, configurationRoots: [],
    operations: { check: { kind: 'process', executableArtifactId: 'fixture-operation', arguments: [] } },
  }), /effectClass/i);
  assert.throws(() => canonicalOfflineOperationManifestBytes({
    schemaVersion: 4, configurationRoots: [],
    operations: { apply: { kind: 'package-manager', manager: 'apt', packages: ['fixture'] } },
  }), /invalid input|kind/i);
  assert.doesNotThrow(() => canonicalOfflineOperationManifestBytes({
    schemaVersion: 4, configurationRoots: [],
    operations: Object.fromEntries(['check', 'apply', 'verify'].map(action => [`service.${action}`, {
      kind: 'native-service', effectClass: 'native-service', action,
      manager: 'systemd', unit: 'fixture.service', desiredState: 'started',
    }])),
  }));

  for (const [domain, expected] of [
    ['package-manager.apt', /unsupported package-manager authority/],
    ['service-manager.systemd', /unsupported service-state authority/],
  ]) {
    const state = await fixture(t);
    const candidatePlan = structuredClone(state.plan);
    candidatePlan.tasks[0].lockDomains = [domain];
    const outputRoot = join(state.root, domain.replaceAll('.', '-'));
    await mkdir(outputRoot);
    await assert.rejects(
      state.makeBundle({ candidatePlan, bundleOutputRoot: outputRoot }),
      expected,
    );
  }
});

test('v4 admits only an exact signed native dpkg package triple and runtime remains fail-closed', async t => {
  const state = await fixture(t);
  const payloadBytes = await readFile(state.nativePayload);
  const packagesBytes = await readFile(state.packagesIndex);
  const releaseText = [
    'Suite: noble', 'Codename: noble', 'Components: main', 'Architectures: amd64',
    `Date: ${new Date(at).toUTCString()}`, `Valid-Until: ${new Date(later).toUTCString()}`,
    'SHA256:', ` ${sha(packagesBytes)} ${packagesBytes.length} main/binary-amd64/Packages.xz`, '',
  ].join('\n');
  const nativeTask = {
    ...task('task.native-package'), privilege: 'admin', consent: 'package-install',
    lockDomains: ['package-manager.dpkg'],
  };
  const desiredState = { ...state.desiredState, packages: ['fixture-operation'], consents: ['package-install'] };
  const plan = await createInstallerEngine({
    adapter: {
      discover: async () => state.facts,
      plan: async () => ({ tasks: [nativeTask], selectedTaskIds: [nativeTask.id] }),
      check: async () => 'needed', apply: async () => {}, verify: async () => 'verified',
    },
    now: () => at,
  }).plan(state.facts, desiredState, 'release-1');
  const operations = {
    schemaVersion: 4, configurationRoots: [],
    operations: Object.fromEntries(['check', 'apply', 'verify'].map(action => [nativeTask.operations[action], {
      kind: 'native-package', effectClass: 'native-package', action,
      packageKey: 'fixture-operation', payloadArtifactId: 'fixture-package',
    }])),
  };
  const nativeArtifacts = [
    { id: 'fixture-package', sourcePath: state.nativePayload, mediaType: 'application/vnd.debian.binary-package', mode: '0600', license: 'MIT', schema: null, catalogDescriptor: state.nativePayloadDescriptor, containsSecrets: false },
    { id: 'fixture-inrelease', sourcePath: state.inRelease, mediaType: 'text/plain', mode: '0600', license: 'MIT', schema: null, containsSecrets: false },
    { id: 'fixture-repository-keyring', sourcePath: state.repositoryKeyring, mediaType: 'application/vnd.gnupg.keyring', mode: '0600', license: 'MIT', schema: null, containsSecrets: false },
    { id: 'fixture-packages-index', sourcePath: state.packagesIndex, mediaType: 'application/octet-stream', mode: '0600', license: 'MIT', schema: null, containsSecrets: false },
  ];
  const created = await state.makeBundle({
    candidatePlan: plan, candidateOperations: operations, candidateDesiredState: desiredState,
    includeFixtureExecutable: false, extraArtifacts: nativeArtifacts,
  });
  const closure = await validateOfflineExecutionClosure({
    bundleDirectory: created.bundleDirectory, manifest: created.manifest, manifestDigest: created.manifestDigest,
  });
  assert.deepEqual(closure.runtimeArtifactIds, ['fixture-inrelease', 'fixture-package', 'fixture-packages-index', 'fixture-repository-keyring']);
  const metadata = await verifyOfflineNativeDebianMetadata(
    { bundleDirectory: created.bundleDirectory, manifest: created.manifest, manifestDigest: created.manifestDigest },
    closure,
    {
      verifyInRelease: async () => ({ cleartext: Buffer.from(releaseText), signingKeyFingerprint: 'A'.repeat(40) }),
      decompressPackages: async (_path, bytes) => bytes,
      now: () => new Date('2026-11-06T04:30:00.000Z'),
    },
  );
  assert.equal(metadata['fixture-operation'].payloadSha256, sha(payloadBytes));

  const onlineCache = join(state.root, 'native-online-cache');
  await mkdir(onlineCache, { mode: 0o700 });
  const onlineObjects = new Map(await Promise.all(nativeArtifacts.map(async item => [item.id, await readFile(item.sourcePath)])));
  const onlineFilenames = {
    'fixture-package': 'tree_2.1.0-1_amd64.deb',
    'fixture-inrelease': 'debian-bookworm-inrelease',
    'fixture-repository-keyring': 'debian-bookworm-archive-keyring.gpg',
    'fixture-packages-index': 'debian-bookworm-main-amd64-Packages.xz',
  };
  let onlineFetches = 0;
  const onlineResolver = await createOnlineReleaseArtifactResolver({
    releaseId: plan.releaseId,
    cacheRoot: onlineCache,
    artifacts: nativeArtifacts.map(item => ({
      artifactId: item.id,
      url: `https://desktop.tools/releases/${plan.releaseId}/${onlineFilenames[item.id]}`,
      authority: { sha256: sha(onlineObjects.get(item.id)), sizeBytes: onlineObjects.get(item.id).length, mode: '0600' },
    })),
    fetcher: async url => {
      onlineFetches += 1;
      const filename = new URL(url).pathname.split('/').at(-1);
      const artifactId = Object.entries(onlineFilenames).find(([, value]) => value === filename)?.[0];
      const bytes = onlineObjects.get(artifactId);
      return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
    },
  });
  const metadataVerifier = {
    verifyInRelease: async () => ({ cleartext: Buffer.from(releaseText), signingKeyFingerprint: 'A'.repeat(40) }),
    decompressPackages: async (_path, bytes) => bytes,
    now: () => new Date('2026-11-06T04:30:00.000Z'),
  };
  const onlineMetadata = await verifyNativeDebianMetadataWithResolver({ closure, resolver: onlineResolver, verifier: metadataVerifier });
  assert.deepEqual(onlineMetadata, metadata);
  assert.equal(onlineFetches, 4, 'online metadata admission fetches the exact four-object closure once');

  const bundlePlan = await planOfflineBundle({
    bundleDirectory: created.bundleDirectory, trust: state.trust, releaseTrust: state.releaseTrust,
    expected: {
      releaseId: plan.releaseId, planDigest: plan.digest,
      platform: { os: 'linux', arch: 'x64', environment: 'native' }, selectedTaskIds: plan.selectedTaskIds,
      artifactIds: created.manifest.artifacts.map(artifact => artifact.id).sort(),
    },
    now: '2026-11-06T04:30:00.000Z',
  });
  const destination = join(state.root, 'native-materialized');
  await applyOfflineBundle({
    plan: bundlePlan, destinationDirectory: destination, trust: state.trust, releaseTrust: state.releaseTrust,
    now: '2026-11-06T04:30:00.000Z',
  });
  await assert.rejects(
    createOfflineInstallerAdapter({ closure, materializedRoot: destination }),
    /explicit privileged runtime, Debian version comparator, and independently verified metadata/,
  );
  const runtimeCalls = [];
  const nativePackageRuntime = {
    check: async authority => {
      runtimeCalls.push(authority.operation.action);
      assert.equal(authority.rootDescriptor.packageKey, 'fixture-operation');
      assert.equal(authority.packages.length, 1);
      assert.deepEqual(authority.packages[0].metadata, metadata['fixture-operation']);
      await authority.withPayload('fixture-operation', async payload => {
        assert.deepEqual(await payload.readFile(), payloadBytes);
      });
      return 'needed';
    },
    apply: async authority => {
      runtimeCalls.push(authority.operation.action);
      await authority.withPayload('fixture-operation', async payload => {
        assert.deepEqual(await payload.readFile(), payloadBytes);
      });
    },
    verify: async authority => {
      runtimeCalls.push(authority.operation.action);
      await authority.withPayload('fixture-operation', async payload => {
        assert.deepEqual(await payload.readFile(), payloadBytes);
      });
      return 'verified';
    },
  };
  const runtimeClaims = [];
  const adapter = await createOfflineInstallerAdapter({
    closure, materializedRoot: destination,
    nativePackageRuntimeFactory: claim => {
      runtimeClaims.push(claim);
      return nativePackageRuntime;
    },
    verifiedNativeMetadata: metadata,
    compareDebianVersions: (left, right) => left.localeCompare(right, undefined, { numeric: true }),
    inspectNativePackage: async ({ descriptor }) => ({
      control: {
        packageName: descriptor.package.name, version: descriptor.package.version,
        architecture: descriptor.package.architecture,
        depends: descriptor.metadataProof.packageStanza.depends,
        preDepends: descriptor.metadataProof.packageStanza.preDepends,
        essential: descriptor.metadataProof.packageStanza.essential,
        multiArch: descriptor.metadataProof.packageStanza.multiArch,
      },
      conffiles: descriptor.conffiles, members: [],
    }),
  });
  assert.equal(runtimeClaims.length, 0, 'adapter construction cannot mint native mutation authority');
  const nativeJournal = createJournalStore({
    stateRoot: join(state.root, 'native-runtime-journal'), hostId: state.facts.hostId,
    bootId: 'linux-boot:native', processStart: 'linux-jiffies:1', pid: 42,
    now: () => at, isProcessAlive: async () => true,
  });
  const result = await createInstallerEngine({ adapter, journal: nativeJournal, now: () => at }).run({
    runId: 'native-runtime-boundary', releaseId: plan.releaseId, desiredState,
    approvedPlanDigest: plan.digest,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(runtimeCalls, ['check', 'apply', 'verify']);
  assert.equal(runtimeClaims.length, 3);
  for (const claim of runtimeClaims) {
    assert.deepEqual(claim.identity, {
      runId: 'native-runtime-boundary', hostId: state.facts.hostId, planDigest: plan.digest,
    });
    assert.equal(typeof claim.persistence.load, 'function');
    assert.equal(typeof claim.persistence.save, 'function');
  }
  await assert.rejects(runtimeClaims[0].persistence.load('0'.repeat(64)), /lease|owner/i,
    'owner-bound persistence is fenced after terminal journal release');

  const onlineRuntimeCalls = [];
  const onlineRuntimeClaims = [];
  const onlineRuntime = Object.fromEntries(['check', 'apply', 'verify'].map(action => [action, async authority => {
    onlineRuntimeCalls.push(action);
    await authority.withPayload('fixture-operation', async payload => assert.deepEqual(await payload.readFile(), payloadBytes));
    return action === 'check' ? 'needed' : action === 'verify' ? 'verified' : undefined;
  }]));
  const onlineAdapter = await createOfflineInstallerAdapter({
    closure, materializedRoot: destination, artifactResolver: onlineResolver,
    nativePackageRuntimeFactory: claim => { onlineRuntimeClaims.push(claim); return onlineRuntime; },
    verifiedNativeMetadata: onlineMetadata,
    compareDebianVersions: (left, right) => left.localeCompare(right, undefined, { numeric: true }),
    inspectNativePackage: async ({ descriptor }) => ({
      control: { packageName: descriptor.package.name, version: descriptor.package.version,
        architecture: descriptor.package.architecture, depends: descriptor.metadataProof.packageStanza.depends,
        preDepends: descriptor.metadataProof.packageStanza.preDepends, essential: descriptor.metadataProof.packageStanza.essential,
        multiArch: descriptor.metadataProof.packageStanza.multiArch }, conffiles: descriptor.conffiles, members: [],
    }),
  });
  const onlineJournal = createJournalStore({
    stateRoot: join(state.root, 'native-online-journal'), hostId: state.facts.hostId,
    bootId: 'linux-boot:native-online', processStart: 'linux-jiffies:3', pid: 44,
    now: () => at, isProcessAlive: async () => true,
  });
  const onlineResult = await createInstallerEngine({ adapter: onlineAdapter, journal: onlineJournal, now: () => at }).run({
    runId: 'native-online-runtime-boundary', releaseId: plan.releaseId, desiredState, approvedPlanDigest: plan.digest,
  });
  assert.equal(onlineResult.exitCode, result.exitCode);
  assert.deepEqual(onlineRuntimeCalls, ['check', 'apply', 'verify']);
  assert.ok(onlineRuntimeClaims.every(claim => claim.identity.planDigest === plan.digest));
  const [offlineParityPlan, onlineParityPlan] = await Promise.all([
    createInstallerEngine({ adapter, now: () => at }).plan(state.facts, desiredState, plan.releaseId),
    createInstallerEngine({ adapter: onlineAdapter, now: () => at }).plan(state.facts, desiredState, plan.releaseId),
  ]);
  assert.equal(onlineParityPlan.digest, offlineParityPlan.digest,
    'online and offline execution produce the same normalized plan digest');
  assert.deepEqual(onlineParityPlan.tasks, offlineParityPlan.tasks,
    'online and offline execution retain the exact same normalized native task authority');
  assert.equal(onlineFetches, 4, 'native check/apply/verify use admitted cache bytes with zero apply-time network');
  assert.equal(nativeTask.network, 'none');
  assert.equal(sha(canonicalOfflineOperationManifestBytes(operations)), sha(canonicalOfflineOperationManifestBytes(closure.operations)));

  let substitutedRuntimeCalls = 0;
  const substitutedResolver = async artifactId => {
    const candidate = await onlineResolver(artifactId);
    return artifactId === 'fixture-package'
      ? { ...candidate, authority: { ...candidate.authority, sha256: '0'.repeat(64) } } : candidate;
  };
  const substitutedAdapter = await createOfflineInstallerAdapter({
    closure, materializedRoot: destination, artifactResolver: substitutedResolver,
    nativePackageRuntimeFactory: () => ({
      check: async () => { substitutedRuntimeCalls += 1; return 'needed'; },
      apply: async () => { substitutedRuntimeCalls += 1; },
      verify: async () => { substitutedRuntimeCalls += 1; return 'verified'; },
    }),
    verifiedNativeMetadata: onlineMetadata,
    compareDebianVersions: (left, right) => left.localeCompare(right, undefined, { numeric: true }),
    inspectNativePackage: async () => { throw new Error('authority mismatch must fail before package inspection'); },
  });
  const substitutedJournal = createJournalStore({ stateRoot: join(state.root, 'native-substituted-journal'), hostId: state.facts.hostId,
    bootId: 'linux-boot:native-substituted', processStart: 'linux-jiffies:4', pid: 45,
    now: () => at, isProcessAlive: async () => true });
  const substitutedResult = await createInstallerEngine({ adapter: substitutedAdapter, journal: substitutedJournal, now: () => at }).run({
    runId: 'native-substituted-runtime', releaseId: plan.releaseId, desiredState, approvedPlanDigest: plan.digest,
  });
  assert.notEqual(substitutedResult.exitCode, 0);
  assert.equal(substitutedRuntimeCalls, 0, 'resolver authority substitution fails before native runtime invocation');

  const orchestratedJournal = createJournalStore({
    stateRoot: join(state.root, 'native-orchestrated-journal'), hostId: state.facts.hostId,
    bootId: 'linux-boot:native-orchestrated', processStart: 'linux-jiffies:2', pid: 43,
    now: () => at, isProcessAlive: async () => true,
  });
  const orchestratedClaims = [];
  const orchestrated = await executeOfflineBundle({
    plan: bundlePlan, trust: state.trust, releaseTrust: state.releaseTrust, materializedRoot: destination,
    journalFactory: () => orchestratedJournal, runId: 'native-orchestrated-runtime', now: () => at,
    hostAttestor: {
      platform: 'linux',
      discover: async () => ({ immutableHostId: state.facts.hostId, facts: { ...state.facts, collectedAt: later } }),
    },
    debianMetadataVerifier: {
      verifyInRelease: async () => ({ cleartext: Buffer.from(releaseText), signingKeyFingerprint: 'A'.repeat(40) }),
      decompressPackages: async (_path, bytes) => bytes,
      now: () => new Date('2026-11-06T04:30:00.000Z'),
    },
    compareDebianVersions: (left, right) => left.localeCompare(right, undefined, { numeric: true }),
    inspectNativePackage: async ({ descriptor }) => ({
      control: {
        packageName: descriptor.package.name, version: descriptor.package.version,
        architecture: descriptor.package.architecture,
        depends: descriptor.metadataProof.packageStanza.depends,
        preDepends: descriptor.metadataProof.packageStanza.preDepends,
        essential: descriptor.metadataProof.packageStanza.essential,
        multiArch: descriptor.metadataProof.packageStanza.multiArch,
      },
      conffiles: descriptor.conffiles, members: [],
    }),
    nativePackageRuntimeFactory: claim => {
      orchestratedClaims.push(claim);
      return nativePackageRuntime;
    },
  });
  assert.equal(orchestrated.receipt.status, 'success', JSON.stringify(orchestrated.events));
  assert.equal(orchestratedClaims.length, 3);
  assert.ok(orchestratedClaims.every(claim => claim.identity.runId === 'native-orchestrated-runtime'));
  await assert.rejects(executeOfflineBundle({
    plan: bundlePlan, trust: state.trust, releaseTrust: state.releaseTrust, materializedRoot: destination,
    journalFactory: () => orchestratedJournal, runId: 'native-direct-runtime-rejected', now: () => at,
    hostAttestor: { platform: 'linux', discover: async () => ({ immutableHostId: state.facts.hostId, facts: state.facts }) },
    nativePackageRuntime,
    debianMetadataVerifier: {
      verifyInRelease: async () => ({ cleartext: Buffer.from(releaseText), signingKeyFingerprint: 'A'.repeat(40) }),
    },
    compareDebianVersions: () => 0,
  }), /owner-bound privileged runtime factory/,
  'production orchestration does not accept a preconstructed ambient native runtime');

  const altered = structuredClone(operations);
  altered.operations[nativeTask.operations.verify].payloadArtifactId = 'other-payload';
  const alteredRoot = join(state.root, 'native-altered');
  await mkdir(alteredRoot);
  await assert.rejects(state.makeBundle({
    candidatePlan: plan, candidateOperations: altered, candidateDesiredState: desiredState,
    includeFixtureExecutable: false, extraArtifacts: nativeArtifacts, bundleOutputRoot: alteredRoot,
  }), /disagree on their authority/);
});

test('native Debian verification recursively proves every dependency payload before runtime admission', async t => {
  const state = await fixture(t);
  const root = join(state.root, 'recursive-native-proof');
  await mkdir(root, { mode: 0o700 });
  await mkdir(join(root, 'artifacts'), { mode: 0o700 });
  const rootBytes = Buffer.from('root deb\n');
  const dependencyBytes = Buffer.from('dependency deb\n');
  const packagesBytes = Buffer.from([
    'Package: fixture-operation', 'Version: 1.0.0-1', 'Architecture: amd64',
    'Filename: pool/root.deb', `Size: ${rootBytes.length}`, `SHA256: ${sha(rootBytes)}`,
    'Depends: fixture-dependency (= 2.0.0-1)', 'Essential: no', '',
    'Package: fixture-dependency', 'Version: 2.0.0-1', 'Architecture: amd64',
    'Filename: pool/dependency.deb', `Size: ${dependencyBytes.length}`, `SHA256: ${sha(dependencyBytes)}`,
    'Essential: no', '',
  ].join('\n'));
  const inReleaseBytes = Buffer.from('opaque signed metadata\n');
  const keyringBytes = Buffer.from('pinned keyring\n');
  const artifacts = [
    ['root-deb', rootBytes], ['dependency-deb', dependencyBytes], ['proof-packages', packagesBytes],
    ['proof-inrelease', inReleaseBytes], ['proof-keyring', keyringBytes],
  ];
  for (const [id, bytes] of artifacts) await writeFile(join(root, 'artifacts', id), bytes, { mode: 0o600 });
  const proof = {
    inRelease: {
      artifactId: 'proof-inrelease', path: 'dists/noble/InRelease', sha256: sha(inReleaseBytes),
      sizeBytes: inReleaseBytes.length, signedAt: at, validUntil: later, maximumDateAgeSeconds: null, signingKeyFingerprint: 'A'.repeat(40),
      keyring: { artifactId: 'proof-keyring', sha256: sha(keyringBytes), sizeBytes: keyringBytes.length, mediaType: 'application/vnd.gnupg.keyring' },
    },
    packagesIndex: {
      artifactId: 'proof-packages', path: 'dists/noble/main/binary-amd64/Packages.xz',
      sha256: sha(packagesBytes), sizeBytes: packagesBytes.length, architecture: 'amd64',
    },
  };
  const descriptor = (packageKey, artifactId, bytes, version, filename, depends, dependencyClosure) => ({
    ...state.nativePayloadDescriptor, packageKey,
    package: { name: packageKey, version, architecture: 'amd64' },
    artifact: { id: artifactId, sha256: sha(bytes), sizeBytes: bytes.length, mediaType: 'application/vnd.debian.binary-package' },
    metadataProof: {
      ...proof,
      packageStanza: { filename, sha256: sha(bytes), sizeBytes: bytes.length, depends, preDepends: null, essential: 'no', multiArch: 'absent' },
    },
    dependencyClosure,
  });
  const dependencyDescriptor = descriptor('fixture-dependency', 'dependency-deb', dependencyBytes, '2.0.0-1', 'pool/dependency.deb', null, { depends: [], preDepends: [] });
  const rootDescriptor = descriptor('fixture-operation', 'root-deb', rootBytes, '1.0.0-1', 'pool/root.deb', 'fixture-dependency (= 2.0.0-1)', {
    depends: [{ packageKey: 'fixture-dependency', artifactId: 'dependency-deb' }], preDepends: [],
  });
  const manifestArtifacts = artifacts.map(([id, bytes]) => ({
    id, path: `artifacts/${id}`, sha256: sha(bytes), sizeBytes: bytes.length,
    mode: '0600',
    ...(id === 'root-deb' ? { catalogDescriptor: rootDescriptor } : {}),
    ...(id === 'dependency-deb' ? { catalogDescriptor: dependencyDescriptor } : {}),
  }));
  const verified = { bundleDirectory: root, manifest: { artifacts: manifestArtifacts }, manifestDigest: sha(Buffer.from('manifest')) };
  const closure = {
    operations: { operations: { check: { kind: 'native-package', packageKey: 'fixture-operation', payloadArtifactId: 'root-deb' } } },
    nativePackageDescriptors: { 'fixture-dependency': dependencyDescriptor, 'fixture-operation': rootDescriptor },
  };
  const releaseText = [
    'Suite: noble', 'Codename: noble', 'Components: main', 'Architectures: amd64',
    `Date: ${new Date(at).toUTCString()}`, `Valid-Until: ${new Date(later).toUTCString()}`,
    'SHA256:', ` ${sha(packagesBytes)} ${packagesBytes.length} main/binary-amd64/Packages.xz`, '',
  ].join('\n');
  const results = await verifyOfflineNativeDebianMetadata(verified, closure, {
    verifyInRelease: async () => ({ cleartext: Buffer.from(releaseText), signingKeyFingerprint: 'A'.repeat(40) }),
    decompressPackages: async (_path, bytes) => bytes,
    now: () => new Date('2026-11-06T04:30:00.000Z'),
  });
  assert.deepEqual(Object.keys(results), ['fixture-dependency', 'fixture-operation']);
  assert.equal(results['fixture-dependency'].payloadSha256, sha(dependencyBytes));
});

test('signed offline managed files apply natively, commit compensation, no-op on reapply, and explicitly restore or remove', async t => {
  const state = await managedFileFixture(t);
  const journal = createJournalStore({
    stateRoot: join(state.root, 'managed-journal'), hostId: state.facts.hostId,
    bootId: 'linux-boot:managed', processStart: 'linux-jiffies:1', pid: 42,
    now: () => at, isProcessAlive: async () => true,
  });
  const hostAttestor = {
    platform: 'linux',
    discover: async () => ({ immutableHostId: state.facts.hostId, facts: { ...state.facts, collectedAt: later } }),
  };
  let sandboxCalls = 0;
  const sandbox = {
    probe: async () => { sandboxCalls += 1; return { supported: false, platform: 'test', reason: 'native managed files must not require Bubblewrap' }; },
    execute: async () => { sandboxCalls += 1; throw new Error('native managed files must not enter Bubblewrap'); },
  };
  const applied = await executeOfflineBundle({
    plan: state.bundlePlan, trust: state.trust, releaseTrust: state.releaseTrust, materializedRoot: state.destination,
    journalFactory: () => journal, runId: 'managed-apply', hostAttestor, sandbox, now: () => at,
  });
  assert.equal(applied.receipt.status, 'success');
  assert.equal(await readFile(state.existingTarget, 'utf8'), 'managed existing\n');
  assert.equal(await readFile(state.newTarget, 'utf8'), 'managed new\n');
  assert.equal((await lstat(state.existingTarget)).mode & 0o7777, 0o600);
  assert.equal((await lstat(state.newTarget)).mode & 0o7777, 0o600);
  assert.equal((await journal.readCompensations('managed-apply', state.plan.digest)).length, 2);
  assert.equal((await journal.inspectCompletion('managed-apply', state.plan.digest)).authority, 'committed');
  assert.equal(sandboxCalls, 0);

  const beforeExisting = await stat(state.existingTarget);
  const beforeNew = await stat(state.newTarget);
  const unchanged = await executeOfflineBundle({
    plan: state.bundlePlan, trust: state.trust, releaseTrust: state.releaseTrust, materializedRoot: state.destination,
    journalFactory: () => journal, runId: 'managed-unchanged', hostAttestor, sandbox, now: () => at,
  });
  assert.equal(unchanged.receipt.status, 'success');
  assert.deepEqual(unchanged.taskStatuses, { 'task.managed-existing': 'verified', 'task.managed-new': 'verified' });
  assert.equal((await journal.readCompensations('managed-unchanged', state.plan.digest)).length, 0);
  assert.equal((await stat(state.existingTarget)).ino, beforeExisting.ino);
  assert.equal((await stat(state.newTarget)).ino, beforeNew.ino);
  assert.equal(sandboxCalls, 0);

  const compensations = await journal.readCompensations('managed-apply', state.plan.digest);
  const rollbackPlan = await createRollbackPlan({
    sourceRunId: 'managed-apply', sourcePlanDigest: state.plan.digest, compensations,
  }, () => at);
  const rollback = await executeApprovedUserFileRollback({ plan: rollbackPlan, approvedPlanDigest: rollbackPlan.digest }, compensations);
  assert.equal(rollback.status, 'succeeded');
  assert.equal(await readFile(state.existingTarget, 'utf8'), 'previous\n');
  await assert.rejects(readFile(state.newTarget), { code: 'ENOENT' });
});

test('offline managed-file authority rejects unsafe schema, mismatched triplets, symlink targets, and artifact surplus', async t => {
  const state = await managedFileFixture(t);
  const base = state.operations.operations['task.managed-existing.check'];
  assert.throws(() => canonicalOfflineOperationManifestBytes({
    schemaVersion: 4, configurationRoots: [state.targetDirectory], operations: { operation: { ...base, targetPath: 'relative.conf' } },
  }), /absolute/);
  assert.throws(() => canonicalOfflineOperationManifestBytes({
    schemaVersion: 4, configurationRoots: [state.targetDirectory], operations: { operation: { ...base, targetPath: `${state.targetDirectory}/nested/../escape.conf` } },
  }), /canonical absolute/);
  assert.throws(() => canonicalOfflineOperationManifestBytes({
    schemaVersion: 4, configurationRoots: [state.targetDirectory], operations: { operation: { ...base, candidateMode: 0o666 } },
  }), /invalid|union/i);
  assert.throws(() => canonicalOfflineOperationManifestBytes({
    schemaVersion: 4, configurationRoots: [state.targetDirectory], operations: { operation: { ...base, unexpected: true } },
  }), /unrecognized key/i);

  assert.throws(() => canonicalOfflineOperationManifestBytes({
    schemaVersion: 4, configurationRoots: [], operations: { operation: base },
  }), /allowed configuration root|configuration root/i);
  assert.throws(() => canonicalOfflineOperationManifestBytes({
    schemaVersion: 4, configurationRoots: ['/'], operations: { operation: base },
  }), /non-root/i);
  assert.throws(() => canonicalOfflineOperationManifestBytes({
    schemaVersion: 4, configurationRoots: [state.existingTarget], operations: { operation: base },
  }), /strict descendant/i);
  assert.throws(() => canonicalOfflineOperationManifestBytes({
    schemaVersion: 4, configurationRoots: [`${state.targetDirectory}/z`, state.targetDirectory], operations: { operation: base },
  }), /sorted|overlap/i);

  const candidateArtifacts = state.created.manifest.artifacts.filter(item => item.id.startsWith('candidate-')).map(item => ({
    id: item.id, sourcePath: join(state.source, item.id), mediaType: item.mediaType, mode: item.mode,
    license: item.license, schema: item.schema, containsSecrets: false,
  }));
  const rejectChangedAuthority = async (label, mutate, pattern) => {
    const operations = structuredClone(state.operations);
    mutate(operations.operations);
    const outputRoot = join(state.root, `managed-${label}-mismatch`);
    await mkdir(outputRoot);
    await assert.rejects(
      state.makeBundle({
        candidatePlan: state.plan, candidateOperations: operations, includeFixtureExecutable: false,
        bundleOutputRoot: outputRoot, extraArtifacts: candidateArtifacts,
      }),
      pattern,
    );
  };
  await rejectChangedAuthority('action', operations => {
    operations['task.managed-existing.check'].action = 'verify';
  }, /action does not match/);
  await rejectChangedAuthority('artifact', operations => {
    operations['task.managed-existing.verify'].candidateArtifactId = 'candidate-new';
  }, /disagree on their authority/);
  await rejectChangedAuthority('target', operations => {
    operations['task.managed-existing.verify'].targetPath = state.newTarget;
  }, /disagree on their authority/);
  await rejectChangedAuthority('mode', operations => {
    operations['task.managed-existing.verify'].candidateMode = 0o640;
  }, /disagree on their authority/);

  const surplusPath = join(state.source, 'candidate-surplus');
  await writeFile(surplusPath, 'surplus\n', { mode: 0o600 });
  const surplusRoot = join(state.root, 'managed-surplus');
  await mkdir(surplusRoot);
  await assert.rejects(
    state.makeBundle({
      candidatePlan: state.plan, candidateOperations: state.operations, includeFixtureExecutable: false,
      bundleOutputRoot: surplusRoot,
      extraArtifacts: [...candidateArtifacts, {
        id: 'candidate-surplus', sourcePath: surplusPath, mediaType: 'application/octet-stream', mode: '0600',
        license: 'MIT', schema: null, containsSecrets: false,
      }],
    }),
    /unreferenced artifact/,
  );

  const closure = await validateOfflineExecutionClosure(state.bundlePlan);
  let sandboxCalls = 0;
  const hardlinkAlias = join(state.targetDirectory, 'hardlink-alias');
  await link(state.existingTarget, hardlinkAlias);
  const adapter = await createOfflineInstallerAdapter({
    closure, materializedRoot: state.destination,
    sandbox: {
      probe: async () => ({ supported: false, platform: 'test', reason: 'not called' }),
      execute: async () => { sandboxCalls += 1; return { exitCode: 0, stdout: '', stderr: '' }; },
    },
  });
  await assert.rejects(adapter.check(closure.plan.tasks.find(item => item.id === 'task.managed-existing')), /regular file with one link/);
  await rm(hardlinkAlias);

  const linkedSource = join(state.targetDirectory, 'linked-source');
  await writeFile(linkedSource, 'linked\n', { mode: 0o600 });
  await rm(state.existingTarget);
  await symlink(linkedSource, state.existingTarget);
  await assert.rejects(adapter.check(closure.plan.tasks.find(item => item.id === 'task.managed-existing')), /symbolic link|regular file with one link/);
  assert.equal(sandboxCalls, 0);
});

test('offline managed-file roots reject symlink aliases and nested symlink escapes before target access', async t => {
  const state = await managedFileFixture(t);
  const closure = await validateOfflineExecutionClosure(state.bundlePlan);
  const canonicalFixtureRoot = await realpath(state.root);

  const realRoot = join(canonicalFixtureRoot, 'alternate-root');
  const linkedRoot = join(canonicalFixtureRoot, 'linked-root');
  await mkdir(realRoot, { mode: 0o700 });
  await symlink(realRoot, linkedRoot);
  const linkedRootClosure = structuredClone(closure);
  linkedRootClosure.operations.configurationRoots = [linkedRoot];
  for (const operation of Object.values(linkedRootClosure.operations.operations)) {
    operation.targetPath = join(linkedRoot, 'fixture.conf');
  }
  await assert.rejects(
    createOfflineInstallerAdapter({ closure: linkedRootClosure, materializedRoot: state.destination }),
    /configuration root.*symbolic link|canonical real directory/i,
  );

  const nestedRoot = join(canonicalFixtureRoot, 'nested-root');
  const outside = join(canonicalFixtureRoot, 'outside');
  await mkdir(nestedRoot, { mode: 0o700 });
  await mkdir(outside, { mode: 0o700 });
  await symlink(outside, join(nestedRoot, 'escape'));
  const nestedEscapeClosure = structuredClone(closure);
  nestedEscapeClosure.operations.configurationRoots = [nestedRoot];
  for (const operation of Object.values(nestedEscapeClosure.operations.operations)) {
    operation.targetPath = join(nestedRoot, 'escape', 'fixture.conf');
  }
  const nestedAdapter = await createOfflineInstallerAdapter({
    closure: nestedEscapeClosure,
    materializedRoot: state.destination,
  });
  await assert.rejects(
    nestedAdapter.check(nestedEscapeClosure.plan.tasks[0]),
    /parent.*symbolic link|escape.*configuration root/i,
  );
  await assert.rejects(readFile(join(outside, 'fixture.conf')), { code: 'ENOENT' });
});

test('execution closure independently reproduces approval and rejects altered signed semantic inputs', async t => {
  const state = await fixture(t);
  const changedDesired = { ...state.desiredState, packages: ['unexpected'] };
  const desiredRoot = join(state.root, 'changed-desired');
  await mkdir(desiredRoot);
  await assert.rejects(
    state.makeBundle({ candidateDesiredState: changedDesired, bundleOutputRoot: desiredRoot }),
    /reproduce the approved normalized plan/,
  );

  const changedFacts = { ...state.facts, capabilities: ['unexpected'] };
  const factsRoot = join(state.root, 'changed-facts');
  await mkdir(factsRoot);
  await assert.rejects(
    state.makeBundle({ candidateFacts: changedFacts, bundleOutputRoot: factsRoot }),
    /reproduce the approved normalized plan/,
  );

  assert.throws(() => canonicalOfflineDesiredStateBytes({ ...state.desiredState, unknown: true }), /unrecognized key/i);
  assert.throws(() => canonicalOfflineHostFactsBytes({ ...state.facts, unknown: true }), /unrecognized key/i);
});

test('bundle creation rejects an invalid declared execution closure before publication', async t => {
  const state = await fixture(t);
  const changedDesired = { ...state.desiredState, packages: ['unexpected'] };

  await assert.rejects(
    state.makeBundle({ candidateDesiredState: changedDesired }),
    /reproduce the approved normalized plan/,
  );
  assert.deepEqual(await readdir(state.outputRoot), [], 'invalid execution authority must never become a published bundle');
});

test('execution closure rejects a mismatched graph digest and noncanonical dependency closure', async t => {
  const state = await fixture(t);
  await assert.rejects(
    state.makeBundle({ graphDigest: digest('f') }),
    /graph digest/,
  );

  const incompletePlan = { ...state.plan, selectedTaskIds: ['task.install'] };
  const incompleteRoot = join(state.root, 'incomplete');
  await mkdir(incompleteRoot);
  await assert.rejects(
    state.makeBundle({ candidatePlan: incompletePlan, bundleOutputRoot: incompleteRoot }),
    /dependency closure/,
  );
});

test('offline readiness reports every deterministic legacy blocker in task order', () => {
  const tasks = [
    {
      ...task('provision.chezmoi'), network: 'required', resources: { cpu: 1, memoryMiB: 32, network: true },
      lockDomains: ['chezmoi', 'package-manager'],
    },
    {
      ...task('desired.services'),
      lockDomains: ['service-manager', 'privilege'], privilege: 'admin', consent: 'privileged',
    },
    {
      ...task('desired.packages'), network: 'required', resources: { cpu: 1, memoryMiB: 32, network: true },
      lockDomains: ['package-manager', 'privilege'], privilege: 'admin', consent: 'privileged',
    },
    { ...task('native.tree'), lockDomains: ['package-manager.dpkg'], privilege: 'admin', consent: 'package-install' },
  ];
  assert.deepEqual(inspectOfflinePlanReadiness(tasks), [
    { taskId: 'desired.packages', kind: 'package-manager-authority', authority: 'package-manager' },
    { taskId: 'desired.packages', kind: 'network', authority: null },
    { taskId: 'desired.services', kind: 'service-state-authority', authority: 'service-manager' },
    { taskId: 'provision.chezmoi', kind: 'package-manager-authority', authority: 'package-manager' },
    { taskId: 'provision.chezmoi', kind: 'network', authority: null },
  ]);
});

test('execution closure rejects network tasks, missing operations, and unreferenced runtime artifacts', async t => {
  const state = await fixture(t);
  const networkPlan = structuredClone(state.plan);
  networkPlan.tasks[1].network = 'required';
  networkPlan.tasks[1].resources.network = true;
  const networkRoot = join(state.root, 'network');
  await mkdir(networkRoot);
  await assert.rejects(
    state.makeBundle({ candidatePlan: networkPlan, bundleOutputRoot: networkRoot }),
    /network-free/,
  );

  const missingOperations = structuredClone(state.operations);
  delete missingOperations.operations['task.install.apply'];
  const missingRoot = join(state.root, 'missing');
  await mkdir(missingRoot);
  await assert.rejects(
    state.makeBundle({ candidateOperations: missingOperations, bundleOutputRoot: missingRoot }),
    /operation is missing/,
  );

  const unusedRoot = join(state.root, 'unused-root');
  await mkdir(unusedRoot);
  await assert.rejects(
    state.makeBundle({ extraArtifacts: [
      {
        id: 'unused-operation', sourcePath: state.unusedExecutable, mediaType: 'application/octet-stream', mode: '0700',
        license: 'MIT', schema: null, catalogDescriptor: { ...state.unusedExecutableDescriptor, kind: 'immutable-executable' }, containsSecrets: false,
      },
    ], bundleOutputRoot: unusedRoot }),
    /unreferenced artifact/,
  );
});

test('materialized adapter reproduces exact authority and executes only verified paths through the sandbox', async t => {
  const state = await fixture(t);
  const created = await state.makeBundle();
  const expected = {
    releaseId: state.plan.releaseId, planDigest: state.plan.digest,
    platform: { os: 'linux', arch: 'x64', environment: 'native' },
    selectedTaskIds: state.plan.selectedTaskIds,
    artifactIds: ['catalog', 'desired-state', 'engine', 'fixture-operation', 'host-facts', 'normalized-plan', 'operation-manifest', 'release-envelope', 'release-signature'],
  };
  const bundlePlan = await planOfflineBundle({
    bundleDirectory: created.bundleDirectory, trust: state.trust, releaseTrust: state.releaseTrust, expected,
    now: '2026-11-06T04:30:00.000Z',
  });
  const destination = join(state.root, 'materialized');
  await applyOfflineBundle({
    plan: bundlePlan, destinationDirectory: destination, trust: state.trust, releaseTrust: state.releaseTrust,
    now: '2026-11-06T04:30:00.000Z',
  });
  const closure = await validateOfflineExecutionClosure(bundlePlan);
  const calls = [];
  let forcedExitCode;
  const sandbox = {
    probe: async () => ({
      supported: true, platform: 'linux', kind: 'linux-bubblewrap-network-namespace',
      executablePath: '/usr/bin/bwrap', hostNetworkNamespace: 'net:[1]', isolatedNetworkNamespace: 'net:[2]',
    }),
    execute: async operation => {
      calls.push(operation);
      const operationId = operation.arguments.at(-1);
      return { exitCode: forcedExitCode ?? (operationId?.endsWith('.check') ? 10 : 0), stdout: '', stderr: '' };
    },
  };
  const adapter = await createOfflineInstallerAdapter({ closure, materializedRoot: destination, sandbox });
  const engine = createInstallerEngine({ adapter, now: () => at });
  assert.deepEqual(await engine.discover(), state.facts);
  assert.equal((await engine.plan(state.facts, state.desiredState, state.plan.releaseId)).digest, state.plan.digest);
  const result = await engine.run({
    runId: 'offline-run', releaseId: state.plan.releaseId, desiredState: state.desiredState,
    approvedPlanDigest: state.plan.digest,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.taskStatuses, { 'task.install': 'verified', 'task.prepare': 'verified' });
  assert.equal(calls.length, 6);
  const canonicalDestination = await realpath(destination);
  assert.ok(calls.every(call => call.materializedRoot === canonicalDestination));
  assert.ok(calls.every(call => Number.isInteger(call.executableFileDescriptor)));
  assert.ok(calls.every(call => !('executablePath' in call)));

  forcedExitCode = 11;
  assert.equal(await adapter.check(closure.plan.tasks[0]), 'reboot-required');
  forcedExitCode = 31;
  assert.equal(await adapter.verify(closure.plan.tasks[0]), 'pending-reboot');
  forcedExitCode = 76;
  await assert.rejects(adapter.apply(closure.plan.tasks[0]), error =>
    error instanceof InstallerOperationError && error.failureClass === 'rate-limit');
});

test('materialized adapter detects artifact tampering before invoking the sandbox', async t => {
  const state = await fixture(t);
  const created = await state.makeBundle();
  const bundlePlan = await planOfflineBundle({
    bundleDirectory: created.bundleDirectory, trust: state.trust, releaseTrust: state.releaseTrust,
    expected: {
      releaseId: state.plan.releaseId, planDigest: state.plan.digest,
      platform: { os: 'linux', arch: 'x64', environment: 'native' },
      selectedTaskIds: state.plan.selectedTaskIds,
      artifactIds: ['catalog', 'desired-state', 'engine', 'fixture-operation', 'host-facts', 'normalized-plan', 'operation-manifest', 'release-envelope', 'release-signature'],
    },
    now: '2026-11-06T04:30:00.000Z',
  });
  const destination = join(state.root, 'tampered-materialized');
  await applyOfflineBundle({
    plan: bundlePlan, destinationDirectory: destination, trust: state.trust, releaseTrust: state.releaseTrust,
    now: '2026-11-06T04:30:00.000Z',
  });
  await writeFile(join(destination, 'fixture-operation'), '#!/bin/sh\nexit 9\n', { mode: 0o700 });
  let calls = 0;
  const adapter = await createOfflineInstallerAdapter({
    closure: await validateOfflineExecutionClosure(bundlePlan), materializedRoot: destination,
    sandbox: {
      probe: async () => ({ supported: false, platform: 'test', reason: 'not called' }),
      execute: async () => { calls += 1; return { exitCode: 0, stdout: '', stderr: '' }; },
    },
  });
  const engine = createInstallerEngine({ adapter, now: () => at });
  const result = await engine.run({
    runId: 'tampered-run', releaseId: state.plan.releaseId, desiredState: state.desiredState,
    approvedPlanDigest: state.plan.digest,
  });
  assert.equal(result.exitCode, 7);
  assert.equal(calls, 0);
  assert.ok(result.events.some(event => event.kind === 'task-status' && event.status === 'failed'));
});

test('materialized adapter rejects hardlinks and symlinks before sandbox admission', async t => {
  const state = await fixture(t);
  const created = await state.makeBundle();
  const verified = await verifyOfflineBundle({ bundleDirectory: created.bundleDirectory, trust: state.trust, releaseTrust: state.releaseTrust });
  const closure = await validateOfflineExecutionClosure(verified);
  const makeDestination = async name => {
    const destination = join(state.root, name);
    await applyOfflineBundle({
      plan: { ...verified, artifactIds: verified.manifest.artifacts.map(item => item.id).sort(), plannedAt: at },
      destinationDirectory: destination, trust: state.trust, releaseTrust: state.releaseTrust, now: at,
    });
    return destination;
  };
  let calls = 0;
  const sandbox = {
    probe: async () => ({ supported: false, platform: 'test', reason: 'not called' }),
    execute: async () => { calls += 1; return { exitCode: 0, stdout: '', stderr: '' }; },
  };
  const hardlinkDestination = await makeDestination('hardlink-materialized');
  await link(join(hardlinkDestination, 'fixture-operation'), join(hardlinkDestination, 'alias'));
  const hardlinkAdapter = await createOfflineInstallerAdapter({ closure, materializedRoot: hardlinkDestination, sandbox });
  await assert.rejects(hardlinkAdapter.check(state.plan.tasks[0]), /unsafe inode metadata/);

  const symlinkDestination = await makeDestination('symlink-materialized');
  const executable = join(symlinkDestination, 'fixture-operation');
  await rename(executable, `${executable}.original`);
  await symlink(`${executable}.original`, executable);
  const symlinkAdapter = await createOfflineInstallerAdapter({ closure, materializedRoot: symlinkDestination, sandbox });
  await assert.rejects(symlinkAdapter.check(state.plan.tasks[0]), /opened safely/);
  assert.equal(calls, 0);
});

test('sandbox receives the verified open inode when its materialized pathname is replaced', async t => {
  const state = await fixture(t);
  const created = await state.makeBundle();
  const verified = await verifyOfflineBundle({ bundleDirectory: created.bundleDirectory, trust: state.trust, releaseTrust: state.releaseTrust });
  const destination = join(state.root, 'replacement-race-materialized');
  await applyOfflineBundle({
    plan: { ...verified, artifactIds: verified.manifest.artifacts.map(item => item.id).sort(), plannedAt: at },
    destinationDirectory: destination, trust: state.trust, releaseTrust: state.releaseTrust, now: at,
  });
  const executable = join(destination, 'fixture-operation');
  let observed = '';
  const adapter = await createOfflineInstallerAdapter({
    closure: await validateOfflineExecutionClosure(verified), materializedRoot: destination,
    sandbox: {
      probe: async () => ({ supported: false, platform: 'test', reason: 'not called' }),
      execute: async operation => {
        await rename(executable, `${executable}.verified`);
        await writeFile(executable, '#!/bin/sh\nexit 99\n', { mode: 0o700 });
        observed = await readFile(`/dev/fd/${operation.executableFileDescriptor}`, 'utf8');
        return { exitCode: 10, stdout: '', stderr: '' };
      },
    },
  });
  assert.equal(await adapter.check(state.plan.tasks[0]), 'needed');
  assert.equal(observed, '#!/bin/sh\nexit 0\n');
});

test('sandbox receives a sealed snapshot when the materialized inode is mutated in place', async t => {
  const state = await fixture(t);
  const created = await state.makeBundle();
  const verified = await verifyOfflineBundle({ bundleDirectory: created.bundleDirectory, trust: state.trust, releaseTrust: state.releaseTrust });
  const destination = join(state.root, 'in-place-race-materialized');
  await applyOfflineBundle({
    plan: { ...verified, artifactIds: verified.manifest.artifacts.map(item => item.id).sort(), plannedAt: at },
    destinationDirectory: destination, trust: state.trust, releaseTrust: state.releaseTrust, now: at,
  });
  const executable = join(destination, 'fixture-operation');
  let observed = '';
  const adapter = await createOfflineInstallerAdapter({
    closure: await validateOfflineExecutionClosure(verified), materializedRoot: destination,
    sandbox: {
      probe: async () => ({ supported: false, platform: 'test', reason: 'not called' }),
      execute: async operation => {
        await writeFile(executable, '#!/bin/sh\nexit 99\n', { mode: 0o700 });
        observed = await readFile(`/dev/fd/${operation.executableFileDescriptor}`, 'utf8');
        return { exitCode: 10, stdout: '', stderr: '' };
      },
    },
  });
  assert.equal(await adapter.check(state.plan.tasks[0]), 'needed');
  assert.equal(observed, '#!/bin/sh\nexit 0\n');
});

test('journal-required orchestration attests live Linux facts before sandbox mutation and commits evidence', async t => {
  const state = await fixture(t);
  const created = await state.makeBundle();
  const bundlePlan = await planOfflineBundle({
    bundleDirectory: created.bundleDirectory, trust: state.trust, releaseTrust: state.releaseTrust,
    expected: {
      releaseId: state.plan.releaseId, planDigest: state.plan.digest,
      platform: { os: 'linux', arch: 'x64', environment: 'native' },
      selectedTaskIds: state.plan.selectedTaskIds,
      artifactIds: ['catalog', 'desired-state', 'engine', 'fixture-operation', 'host-facts', 'normalized-plan', 'operation-manifest', 'release-envelope', 'release-signature'],
    }, now: '2026-11-06T04:30:00.000Z',
  });
  const destination = join(state.root, 'orchestrated-materialized');
  await applyOfflineBundle({ plan: bundlePlan, destinationDirectory: destination, trust: state.trust, releaseTrust: state.releaseTrust, now: '2026-11-06T04:30:00.000Z' });
  const closure = await validateOfflineExecutionClosure(bundlePlan);
  const journal = createJournalStore({
    stateRoot: join(state.root, 'journal'), hostId: state.facts.hostId,
    bootId: 'linux-boot:test', processStart: 'linux-jiffies:1', pid: 42,
    now: () => at, isProcessAlive: async () => true,
  });
  const calls = [];
  const journalHostIds = [];
  const result = await executeOfflineBundle({
    plan: bundlePlan, trust: state.trust, releaseTrust: state.releaseTrust, materializedRoot: destination,
    journalFactory: hostId => { journalHostIds.push(hostId); return journal; },
    runId: 'offline-authority-run', now: () => at,
    hostAttestor: {
      platform: 'linux',
      discover: async () => ({
        immutableHostId: state.facts.hostId,
        facts: { ...state.facts, collectedAt: later, roles: [...state.facts.roles].reverse() },
      }),
    },
    sandbox: {
      probe: async () => ({
        supported: true, platform: 'linux', kind: 'linux-bubblewrap-network-namespace', executablePath: '/usr/bin/bwrap',
        hostNetworkNamespace: 'net:[1]', isolatedNetworkNamespace: 'net:[2]',
      }),
      execute: async operation => {
        calls.push(operation);
        return { exitCode: operation.arguments.at(-1)?.endsWith('.check') ? 10 : 0, stdout: '', stderr: '' };
      },
    },
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(journalHostIds, [state.facts.hostId]);
  assert.equal(calls.length, 6);
  assert.equal((await journal.inspectCompletion('offline-authority-run', state.plan.digest)).authority, 'committed');
});

test('provider outage cannot fabricate recovery: offline interruption resumes only from durable journal evidence', async t => {
  let providerAttempts = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    providerAttempts += 1;
    throw new Error('all inference and cloud providers are unavailable');
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const state = await fixture(t);
  const created = await state.makeBundle();
  const expected = {
    releaseId: state.plan.releaseId, planDigest: state.plan.digest,
    platform: { os: 'linux', arch: 'x64', environment: 'native' },
    selectedTaskIds: state.plan.selectedTaskIds,
    artifactIds: ['catalog', 'desired-state', 'engine', 'fixture-operation', 'host-facts', 'normalized-plan', 'operation-manifest', 'release-envelope', 'release-signature'],
  };
  const bundlePlan = await planOfflineBundle({
    bundleDirectory: created.bundleDirectory, trust: state.trust, releaseTrust: state.releaseTrust, expected, now: '2026-11-06T04:30:00.000Z',
  });
  const destination = join(state.root, 'resume-materialized');
  await applyOfflineBundle({ plan: bundlePlan, destinationDirectory: destination, trust: state.trust, releaseTrust: state.releaseTrust, now: '2026-11-06T04:30:00.000Z' });
  const journal = createJournalStore({
    stateRoot: join(state.root, 'resume-journal'), hostId: state.facts.hostId,
    bootId: 'linux-boot:test', processStart: 'linux-jiffies:1', pid: 42,
    now: () => at, isProcessAlive: async () => false,
  });
  const attestor = {
    platform: 'linux',
    discover: async () => ({ immutableHostId: state.facts.hostId, facts: { ...state.facts, collectedAt: later } }),
  };
  const installed = new Set();
  let applies = 0;
  let enteredResolve;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  const sandbox = {
    probe: async () => ({
      supported: true, platform: 'linux', kind: 'linux-bubblewrap-network-namespace', executablePath: '/usr/bin/bwrap',
      hostNetworkNamespace: 'net:[1]', isolatedNetworkNamespace: 'net:[2]',
    }),
    execute: async operation => {
      const operationId = operation.arguments.at(-1);
      const taskId = operationId.split('.').slice(0, -1).join('.');
      if (operationId.endsWith('.check')) return { exitCode: installed.has(taskId) ? 0 : 10, stdout: '', stderr: '' };
      if (operationId.endsWith('.apply')) {
        applies += 1;
        installed.add(taskId);
        if (taskId === 'task.prepare') {
          enteredResolve();
          await new Promise((_, reject) => operation.signal.addEventListener('abort', () => reject(new InstallerOperationError('offline interruption', 'cancelled')), { once: true }));
        }
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  };
  const controller = new AbortController();
  const interrupted = executeOfflineBundle({
    plan: bundlePlan, trust: state.trust, releaseTrust: state.releaseTrust, materializedRoot: destination,
    journalFactory: () => journal, runId: 'offline-resume-run', hostAttestor: attestor, sandbox,
    now: () => at, signal: controller.signal,
  });
  await entered;
  controller.abort(new Error('fixture interruption'));
  const cancelled = await interrupted;
  assert.equal(cancelled.receipt.status, 'cancelled');
  assert.equal(providerAttempts, 0, 'offline cancellation does not ask a provider to classify or repair failure');
  assert.equal((await journal.inspectCompletion('offline-resume-run', state.plan.digest)).authority, 'uncommitted');

  const resumed = await executeOfflineBundle({
    plan: bundlePlan, trust: state.trust, releaseTrust: state.releaseTrust, materializedRoot: destination,
    journalFactory: () => journal, runId: 'offline-resume-run', hostAttestor: attestor, sandbox,
    now: () => at, resume: true,
  });
  assert.equal(resumed.receipt.status, 'success');
  assert.equal(providerAttempts, 0, 'offline recovery uses signed plan and journal evidence without cloud inference');
  assert.equal(applies, 2, 'resume skips the already-applied prepare task and applies only its pending dependent');
  assert.equal((await journal.inspectCompletion('offline-resume-run', state.plan.digest)).authority, 'committed');
  await assert.rejects(executeOfflineBundle({
    plan: bundlePlan, trust: state.trust, releaseTrust: state.releaseTrust, materializedRoot: destination,
    journalFactory: () => journal, runId: 'offline-resume-run', hostAttestor: attestor, sandbox,
    now: () => at, resume: true,
  }), /requires released uncommitted evidence; found committed/);
  assert.equal(applies, 2, 'committed evidence cannot be replayed as a resume');
});

test('production provisioner dispatches and reruns a real signed bundle through the network-denied CLI', async t => {
  if (process.env.INSTALL_DOCTOR_REQUIRE_REAL_OFFLINE_SANDBOX !== '1' || process.platform !== 'linux' || process.arch !== 'x64') {
    t.skip('requires the explicit Linux x64 real-offline canary');
    return;
  }
  const now = new Date();
  // Release envelopes use whole epoch seconds; keep the bundle lifetime exactly inside that signed interval.
  now.setMilliseconds(0);
  const fixtureAt = new Date(now.getTime() - 60_000).toISOString();
  const fixtureLater = new Date(now.getTime() + 3_600_000).toISOString();
  const facts = await collectLinuxOfflineHostFacts({ now: () => now.toISOString() });
  const state = await fixture(t, { at: fixtureAt, later: fixtureLater, facts });
  const created = await state.makeBundle();
  const artifactIds = ['catalog', 'desired-state', 'engine', 'fixture-operation', 'host-facts', 'normalized-plan', 'operation-manifest', 'release-envelope', 'release-signature'];
  const authorityPath = join(state.root, 'offline-authority.json');
  await writeFile(authorityPath, `${JSON.stringify({
    trust: state.trust,
    releaseTrust: state.releaseTrust,
    expected: {
      releaseId: state.plan.releaseId,
      planDigest: state.plan.digest,
      platform: { os: facts.os, arch: facts.arch, environment: facts.environment },
      selectedTaskIds: state.plan.selectedTaskIds,
      artifactIds,
    },
    approvedManifestDigest: created.manifestDigest,
    approvedPlanDigest: state.plan.digest,
  })}\n`, { mode: 0o600 });
  const repositoryRoot = new URL('../../../', import.meta.url).pathname;
  const provisioner = join(repositoryRoot, 'scripts', 'provision.sh');
  const engine = new URL('../dist/cli.js', import.meta.url).pathname;
  const home = join(state.root, 'product-home');
  const stateRoot = join(state.root, 'product-state');
  await mkdir(home, { mode: 0o700 });
  await mkdir(stateRoot, { mode: 0o700 });
  const baseEnvironment = {
    HOME: home,
    XDG_STATE_HOME: stateRoot,
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    INSTALL_DOCTOR_ENGINE_PATH: engine,
    INSTALL_DOCTOR_ENGINE_SHA256: sha(await readFile(engine)),
    INSTALL_DOCTOR_RUNTIME_NODE: process.execPath,
    INSTALL_DOCTOR_OFFLINE_BUNDLE_DIR: created.bundleDirectory,
    INSTALL_DOCTOR_OFFLINE_AUTHORITY_PATH: authorityPath,
    INSTALL_DOCTOR_OFFLINE_MODE: 'execute',
    INSTALL_DOCTOR_RENDERER: 'headless',
  };
  const invoke = runId => execute('/bin/bash', ['-c', 'source "$1"; runOfflineBundleProvisioning', '_', provisioner], {
    env: { ...baseEnvironment, INSTALL_DOCTOR_OFFLINE_RUN_ID: runId }, timeout: 30_000, maxBuffer: 2_000_000,
  });
  const first = await invoke('product-offline-first');
  assert.equal(first.stderr, '');
  const materialized = join(stateRoot, 'install.doctor', 'offline', 'materialized', created.manifestDigest);
  assert.equal((await stat(materialized)).isDirectory(), true);
  const materializedIdentity = await lstat(materialized);
  const second = await invoke('product-offline-second');
  assert.equal(second.stderr, '');
  assert.equal((await lstat(materialized)).ino, materializedIdentity.ino, 'unchanged rerun must reuse the verified materialization');
  assert.doesNotMatch(first.stdout + second.stdout, /opencode|provider|infisical|https?:\/\//i);
});

test('offline orchestration rejects a missing journal factory before trust-boundary work', async () => {
  let discovered = false;
  await assert.rejects(executeOfflineBundle({
    runId: 'missing-journal',
    hostAttestor: { platform: 'linux', discover: async () => { discovered = true; throw new Error('must not run'); } },
  }), /attested-host journal factory/);
  assert.equal(discovered, false);
});

test('journal-required orchestration refuses unsupported or mismatched live hosts before sandbox and journal mutation', async t => {
  const state = await fixture(t);
  const created = await state.makeBundle();
  const verified = await verifyOfflineBundle({ bundleDirectory: created.bundleDirectory, trust: state.trust, releaseTrust: state.releaseTrust });
  const closure = await validateOfflineExecutionClosure(verified);
  const destination = join(state.root, 'refusal-materialized');
  await applyOfflineBundle({
    plan: { ...verified, artifactIds: verified.manifest.artifacts.map(item => item.id).sort(), plannedAt: at },
    destinationDirectory: destination, trust: state.trust, releaseTrust: state.releaseTrust, now: at,
  });
  const journalRoot = join(state.root, 'refusal-journal');
  const journal = createJournalStore({
    stateRoot: journalRoot, hostId: state.facts.hostId, bootId: 'linux-boot:test', processStart: 'linux-jiffies:1',
    pid: 42, now: () => at, isProcessAlive: async () => true,
  });
  let calls = 0;
  let journalFactories = 0;
  const journalFactory = () => { journalFactories += 1; return journal; };
  const sandbox = {
    probe: async () => ({ supported: false, platform: 'test', reason: 'must not probe' }),
    execute: async () => { calls += 1; return { exitCode: 0, stdout: '', stderr: '' }; },
  };
  await assert.rejects(executeOfflineBundle({
    plan: { ...verified, artifactIds: verified.manifest.artifacts.map(item => item.id).sort(), plannedAt: at },
    trust: state.trust,
    releaseTrust: { ...state.releaseTrust, publicKey: state.trust.publicKey },
    materializedRoot: destination, journalFactory, runId: 'wrong-release-trust', now: () => at,
    hostAttestor: {
      platform: 'linux', discover: async () => ({ immutableHostId: state.facts.hostId, facts: state.facts }),
    }, sandbox,
  }), /release.*signature|signature verification/i);
  await assert.rejects(executeOfflineBundle({
    plan: { ...verified, artifactIds: verified.manifest.artifacts.map(item => item.id).sort(), plannedAt: at },
    trust: state.trust, releaseTrust: state.releaseTrust, materializedRoot: destination, journalFactory, runId: 'wrong-platform', now: () => at,
    hostAttestor: {
      platform: 'darwin', discover: async () => ({ immutableHostId: state.facts.hostId, facts: state.facts }),
    }, sandbox,
  }), /Linux/);
  await assert.rejects(executeOfflineBundle({
    plan: { ...verified, artifactIds: verified.manifest.artifacts.map(item => item.id).sort(), plannedAt: at },
    trust: state.trust, releaseTrust: state.releaseTrust, materializedRoot: destination, journalFactory, runId: 'wrong-host', now: () => at,
    hostAttestor: {
      platform: 'linux',
      discover: async () => ({ immutableHostId: 'other-host', facts: { ...state.facts, hostId: 'other-host' } }),
    }, sandbox,
  }), /does not match signed host facts/);
  assert.equal(calls, 0);
  assert.equal(journalFactories, 0);
  assert.equal((await journal.listRuns()).length, 0);
});
