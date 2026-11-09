import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildLoadPlan, composeArtifactLegacyCutover, derivePlannedArtifactOperations, preparePlannedArtifact } from '../dist/index.js';

const bytes = Buffer.from('#!/bin/sh\nprintf planned-artifact\\n\n');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const hostOs = process.platform;
const planPlatform = hostOs === 'darwin' ? 'macos' : hostOs === 'win32' ? 'windows' : 'linux';
const hostArch = process.arch;
const descriptor = {
  schemaVersion: 1, id: 'fixture-tool', version: '1.2.3', platform: { os: hostOs, arch: hostArch },
  source: {
    url: 'https://github.com/example/fixture-tool/releases/download/v1.2.3/fixture-tool',
    sha256, sizeBytes: bytes.length,
  },
  destination: { root: 'user-bin', filename: 'fixture-tool', mode: '0700' },
};

function report() {
  return buildLoadPlan({
    schemaVersion: 1, platform: planPlatform, architecture: hostArch, roles: ['workstation'],
    selectedPackages: ['fixture-tool'], selectedServices: [], selectedSupportedPaths: [], lazyResolverRequirements: [],
    catalog: [{
      name: 'fixture-tool', bin: 'fixture-tool', platforms: [planPlatform], installMode: 'cli',
      loadPolicy: 'lazy', loadRationale: 'default-lazy', deps: [], artifacts: [descriptor],
    }],
  });
}

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'install-doctor-planned-artifact-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cacheRoot = join(root, 'cache');
  const destinationRoot = join(root, 'bin');
  await mkdir(cacheRoot, { mode: 0o700 });
  await mkdir(destinationRoot, { mode: 0o700 });
  return { root, cacheRoot, destinationRoot };
}

test('derives approved managed operations without transport or cache publication, then prepares without authority drift', async t => {
  const state = await fixture(t);
  const loadPlan = report();
  const item = loadPlan.items.find(candidate => candidate.name === 'fixture-tool');
  const authority = {
    loadPlan, item, approvedLoadPlanDigest: loadPlan.digest,
    host: { os: hostOs, arch: hostArch }, cacheRoot: state.cacheRoot,
    destinationRoots: { 'user-bin': state.destinationRoot },
  };
  const derived = await derivePlannedArtifactOperations(authority);
  await assert.rejects(lstat(derived.candidatePath), error => error.code === 'ENOENT');
  assert.equal(derived.targetPath, join(state.destinationRoot, 'fixture-tool'));
  const calls = [];
  const approvedEnginePlanDigest = 'a'.repeat(64);
  const prepared = await preparePlannedArtifact({
    ...authority, approvedEnginePlanDigest, expectedOperations: derived.operations,
    fetcher: async (url, init) => {
      calls.push([url, init.redirect]);
      return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
    },
  });
  assert.equal(prepared.schemaVersion, 1);
  assert.equal(prepared.itemName, 'fixture-tool');
  assert.equal(prepared.loadPlanDigest, loadPlan.digest);
  assert.equal(prepared.approvedEnginePlanDigest, approvedEnginePlanDigest);
  assert.equal(prepared.targetPath, join(state.destinationRoot, 'fixture-tool'));
  assert.equal(await readFile(prepared.candidatePath, 'utf8'), bytes.toString('utf8'));
  assert.deepEqual(calls, [[descriptor.source.url, 'manual']]);
  assert.match(prepared.descriptorDigest, /^[a-f0-9]{64}$/);
  for (const [action, operation] of Object.entries(prepared.operations)) {
    assert.deepEqual(operation, {
      kind: 'managed-artifact', action, candidatePath: prepared.candidatePath,
      candidateSha256: sha256, candidateSizeBytes: bytes.length,
      targetPath: prepared.targetPath, candidateMode: 0o700, descriptor,
      authority: { loadPlanDigest: loadPlan.digest, descriptorDigest: prepared.descriptorDigest },
    });
  }

  const cached = await preparePlannedArtifact({
    ...authority, approvedEnginePlanDigest, expectedOperations: derived.operations, offline: true,
    fetcher: async () => { throw new Error('offline cache hit must not fetch'); },
  });
  assert.equal(cached.cacheHit, true);
  assert.deepEqual(cached.operations, prepared.operations);
});

test('rejects plan, item, platform, destination, and candidate authority drift before fetch', async t => {
  const state = await fixture(t);
  const loadPlan = report();
  const item = loadPlan.items.find(candidate => candidate.name === 'fixture-tool');
  let fetches = 0;
  const base = {
    loadPlan, item, approvedLoadPlanDigest: loadPlan.digest,
    host: { os: hostOs, arch: hostArch }, cacheRoot: state.cacheRoot,
    destinationRoots: { 'user-bin': state.destinationRoot },
    approvedEnginePlanDigest: 'b'.repeat(64),
    fetcher: async () => { fetches += 1; return new Response(bytes); },
  };
  const { approvedEnginePlanDigest: _engineDigest, fetcher: _fetcher, ...derivationBase } = base;
  const derived = await derivePlannedArtifactOperations(derivationBase);
  base.expectedOperations = derived.operations;
  const cases = [
    [{ ...base, approvedLoadPlanDigest: '0'.repeat(64) }, /exact approved load-plan digest/i],
    [{ ...base, loadPlan: { ...loadPlan, roles: ['tampered'] } }, /load-plan digest/i],
    [{ ...base, item: { ...item, rationale: 'tampered' } }, /exact load-plan item/i],
    [{ ...base, item: { ...item, selected: false, actions: [] } }, /exact load-plan item|selected/i],
    [{ ...base, host: { os: hostOs === 'darwin' ? 'linux' : 'darwin', arch: hostArch } }, /host platform/i],
    [{ ...base, host: { os: hostOs, arch: hostArch === 'x64' ? 'arm64' : 'x64' } }, /host platform/i],
    [{ ...base, destinationRoots: {} }, /trusted destination root/i],
    [{ ...base, destinationRoots: { 'user-bin': state.cacheRoot, unexpected: state.destinationRoot } }, /unrecognized|destination/i],
    [{ ...base, approvedEnginePlanDigest: 'invalid' }, /normalized engine-plan digest/i],
    [{ ...base, expectedOperations: { ...derived.operations, apply: { ...derived.operations.apply, targetPath: join(state.root, 'other') } } }, /expected managed operations/i],
  ];
  for (const [input, pattern] of cases) await assert.rejects(preparePlannedArtifact(input), pattern);
  assert.equal(fetches, 0, 'authority rejection must happen before artifact transport');

  const linkedRoot = join(state.root, 'linked-bin');
  await symlink(state.destinationRoot, linkedRoot);
  await assert.rejects(preparePlannedArtifact({ ...base, destinationRoots: { 'user-bin': linkedRoot } }), /destination root.*real directory/i);
  const realParent = join(state.root, 'real-parent');
  const linkedParent = join(state.root, 'linked-parent');
  await mkdir(join(realParent, 'bin'), { recursive: true, mode: 0o700 });
  await symlink(realParent, linkedParent);
  await assert.rejects(preparePlannedArtifact({ ...base, destinationRoots: { 'user-bin': join(linkedParent, 'bin') } }), /symlinked ancestors/i);
  await assert.rejects(preparePlannedArtifact({ ...base, destinationRoots: { 'user-bin': state.cacheRoot } }), /separate trust domains/i);
  await chmod(state.destinationRoot, 0o777);
  await assert.rejects(preparePlannedArtifact(base), /destination root.*writable|private/i);
  assert.equal(fetches, 0);
});

test('requires an applicable selected install item with one immutable artifact', async t => {
  const state = await fixture(t);
  const loadPlan = buildLoadPlan({
    schemaVersion: 1, platform: 'linux', architecture: 'x64', roles: [], selectedPackages: [], selectedServices: [],
    selectedSupportedPaths: [], lazyResolverRequirements: [], catalog: [{
      name: 'lazy-tool', bin: 'lazy-tool', platforms: ['linux'], installMode: 'cli', loadPolicy: 'lazy',
      loadRationale: 'default-lazy', deps: [], artifacts: [],
    }],
  });
  await assert.rejects(derivePlannedArtifactOperations({
    loadPlan, item: loadPlan.items[0], approvedLoadPlanDigest: loadPlan.digest,
    host: { os: hostOs, arch: hostArch }, cacheRoot: state.cacheRoot,
    destinationRoots: { 'user-bin': state.destinationRoot },
  }), /selected.*install.*artifact/i);
});

test('cuts over only exact successfully derived artifact roots and preserves every other legacy root', async t => {
  const state = await fixture(t);
  const loadPlan = report();
  const item = loadPlan.items.find(candidate => candidate.name === 'fixture-tool');
  const artifact = await derivePlannedArtifactOperations({
    loadPlan, item, approvedLoadPlanDigest: loadPlan.digest,
    host: { os: hostOs, arch: hostArch }, cacheRoot: state.cacheRoot,
    destinationRoots: { 'user-bin': state.destinationRoot },
  });
  assert.deepEqual(composeArtifactLegacyCutover({
    loadPlan, artifacts: [artifact], legacyPackages: ['legacy-tool', 'fixture-tool', 'unsupported-tool'],
  }), {
    migratedArtifactPackages: ['fixture-tool'],
    remainingLegacyPackages: ['legacy-tool', 'unsupported-tool'],
  });
  assert.deepEqual(composeArtifactLegacyCutover({
    loadPlan, artifacts: [], legacyPackages: ['legacy-tool'],
  }), {
    migratedArtifactPackages: [],
    remainingLegacyPackages: ['legacy-tool'],
  });
  await assert.rejects(async () => composeArtifactLegacyCutover({
    loadPlan, artifacts: [], legacyPackages: ['fixture-tool', 'legacy-tool'],
  }), /missing an exact successful derivation.*fixture-tool/i);

  await assert.rejects(async () => composeArtifactLegacyCutover({
    loadPlan, artifacts: [{ ...artifact, itemName: 'legacy-tool' }], legacyPackages: ['fixture-tool', 'legacy-tool'],
  }), /exact selected applicable install artifact/i);
  await assert.rejects(async () => composeArtifactLegacyCutover({
    loadPlan, artifacts: [{ ...artifact, descriptorDigest: '0'.repeat(64) }], legacyPackages: ['fixture-tool'],
  }), /descriptor digest/i);
  await assert.rejects(async () => composeArtifactLegacyCutover({
    loadPlan, artifacts: [artifact, artifact], legacyPackages: ['fixture-tool'],
  }), /duplicate artifact derivation/i);
});
