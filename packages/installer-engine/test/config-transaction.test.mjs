import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import {
  ConfigurationSnapshotSchema,
  ConfigurationTransactionError,
  ConfigurationTransactionSpecSchema,
  EffectRollbackPolicySchema,
  ServiceStateSnapshotSchema,
  configurationCompensationArtifactDigest,
  serviceStateEquals,
  applyConfigurationTransaction,
  assertAutomaticConfigurationEffect,
  effectRollbackPolicy,
  rollbackConfigurationTransactions,
} from '../dist/index.js';

test('service snapshots retain v1 systemd compatibility and require lossless v2 launchd evidence', () => {
  const systemd = ServiceStateSnapshotSchema.parse({
    schemaVersion: 1, serviceId: 'fixture.service', manager: 'systemd', enabled: true, running: false,
  });
  assert.equal(systemd.schemaVersion, 1);
  assert.throws(() => ServiceStateSnapshotSchema.parse({
    schemaVersion: 1, serviceId: 'com.install-doctor.fixture', manager: 'launchd', enabled: true, running: false,
  }));
  const launchd = ServiceStateSnapshotSchema.parse({
    schemaVersion: 2,
    serviceId: 'com.install-doctor.fixture',
    manager: 'launchd',
    domain: { kind: 'gui', uid: 501 },
    definition: { canonicalPath: '/Users/fixture/Library/LaunchAgents/com.install-doctor.fixture.plist', sha256: 'a'.repeat(64), uid: 501, gid: 20, mode: 0o600 },
    enablementOverride: 'enabled',
    loaded: true,
    activity: 'not-running',
  });
  assert.equal(launchd.schemaVersion, 2);
  assert.throws(() => ServiceStateSnapshotSchema.parse({ ...launchd, loaded: false, activity: 'running' }));
  assert.throws(() => ServiceStateSnapshotSchema.parse({ ...launchd, serviceId: 'com.install-doctor.fixture:' }));
  assert.equal(serviceStateEquals(launchd, {
    activity: 'not-running', loaded: true, enablementOverride: 'enabled',
    definition: { mode: 0o600, gid: 20, uid: 501, sha256: 'a'.repeat(64), canonicalPath: '/Users/fixture/Library/LaunchAgents/com.install-doctor.fixture.plist' },
    domain: { uid: 501, kind: 'gui' },
  }), true);
  const file = ConfigurationSnapshotSchema.parse({ schemaVersion: 1, targetPath: '/tmp/fixture', existed: false, mode: null, uid: null, gid: null, digest: null });
  assert.notEqual(
    configurationCompensationArtifactDigest(file, null, launchd),
    configurationCompensationArtifactDigest(file, null, { ...launchd, enablementOverride: 'disabled' }),
  );
  const serviceOnly = ConfigurationSnapshotSchema.parse({ schemaVersion: 1, kind: 'service',
    targetPath: 'systemd:fixture.service', existed: false, mode: null, uid: null, gid: null, digest: null });
  assert.match(configurationCompensationArtifactDigest(serviceOnly, null, systemd), /^[a-f0-9]{64}$/);
  assert.throws(() => configurationCompensationArtifactDigest(serviceOnly, null, { ...systemd, serviceId: 'other.service' }), /exact systemd snapshot/);
  assert.throws(() => configurationCompensationArtifactDigest(serviceOnly, Buffer.from('forbidden'), systemd), /exact systemd snapshot/);
});

const spec = targetPath => ({
  schemaVersion: 1,
  taskId: 'config.fixture',
  targetPath,
  effect: 'installer-configuration',
  dependencies: [],
});

const hooks = {
  validateCandidate: async path => assert.equal(await readFile(path, 'utf8'), 'new\n'),
  verifyPostcondition: async path => await readFile(path, 'utf8') === 'new\n',
};

function memoryPersistence() {
  const prepared = [];
  const updated = [];
  return {
    prepared,
    updated,
    prepare: async artifact => { prepared.push(artifact); },
    update: async record => { updated.push(record); },
  };
}

async function fixtureRoot(name) {
  return realpath(await mkdtemp(join(tmpdir(), name)));
}

test('runtime schemas are strict and effect rollback policy is fail-closed', () => {
  assert.equal(ConfigurationTransactionSpecSchema.safeParse({ ...spec('/tmp/config'), extra: true }).success, false);
  assert.equal(ConfigurationSnapshotSchema.safeParse({ schemaVersion: 1 }).success, false);
  assert.equal(EffectRollbackPolicySchema.safeParse({
    schemaVersion: 1, effect: 'package', automatic: true, requiresExplicitConsent: false,
  }).success, false);
  for (const effect of ['package', 'operating-system', 'network', 'storage', 'external']) {
    const policy = effectRollbackPolicy(effect);
    assert.equal(policy.automatic, false);
    assert.equal(policy.requiresExplicitConsent, true);
    assert.throws(() => assertAutomaticConfigurationEffect(effect), /not automatically reversible/);
  }
  assert.equal(effectRollbackPolicy('installer-configuration').automatic, true);
  assert.throws(() => assertAutomaticConfigurationEffect('service-state'), /not automatically reversible configuration transactions/);
});

test('rejects symlink and non-regular configuration targets before validation or mutation', async () => {
  const root = await fixtureRoot('install-doctor-config-safety-');
  const actual = join(root, 'actual');
  const linked = join(root, 'linked');
  await writeFile(actual, 'old\n', { mode: 0o640 });
  await symlink(actual, linked);
  await assert.rejects(
    applyConfigurationTransaction({ spec: spec(linked), candidateBytes: Buffer.from('new\n'), hooks, persistence: memoryPersistence() }),
    /regular file and not a symbolic link/,
  );
  assert.equal(await readFile(actual, 'utf8'), 'old\n');
  await assert.rejects(
    applyConfigurationTransaction({ spec: spec(root), candidateBytes: Buffer.from('new\n'), hooks, persistence: memoryPersistence() }),
    /regular file and not a symbolic link/,
  );
  const linkedParent = join(dirname(root), `${basename(root)}-parent-link`);
  await symlink(root, linkedParent);
  await assert.rejects(
    applyConfigurationTransaction({ spec: spec(join(linkedParent, 'child.conf')), candidateBytes: Buffer.from('new\n'), hooks, persistence: memoryPersistence() }),
    /parent must (?:be a real directory|not traverse symbolic links)/,
  );
});

test('validates then atomically activates and explicitly restores bytes, mode, and ownership metadata', async () => {
  const root = await fixtureRoot('install-doctor-config-success-');
  const target = join(root, 'service.conf');
  await writeFile(target, 'old\n', { mode: 0o640 });
  await chmod(target, 0o640);
  const before = await stat(target);
  const persistence = memoryPersistence();
  let validationSawOldTarget = false;
  const transaction = await applyConfigurationTransaction({
    spec: { ...spec(target), candidateMode: 0o600 },
    candidateBytes: Buffer.from('new\n'),
    hooks: {
      validateCandidate: async candidatePath => {
        validationSawOldTarget = await readFile(target, 'utf8') === 'old\n';
        assert.equal(await readFile(candidatePath, 'utf8'), 'new\n');
      },
      verifyPostcondition: hooks.verifyPostcondition,
    },
    persistence,
    now: () => '2026-11-06T04:00:00.000Z',
  });
  assert.equal(validationSawOldTarget, true);
  assert.equal(await readFile(target, 'utf8'), 'new\n');
  assert.equal((await stat(target)).mode & 0o7777, 0o600);
  assert.equal(transaction.compensation.state, 'available');
  assert.equal(persistence.prepared.length, 1);
  assert.deepEqual(transaction.compensation.restores, ['bytes', 'mode', 'ownership']);
  const record = await transaction.rollback();
  const after = await stat(target);
  assert.equal(record.state, 'applied');
  assert.equal(persistence.updated.at(-1)?.state, 'applied');
  assert.equal(await readFile(target, 'utf8'), 'old\n');
  assert.equal(after.mode & 0o7777, 0o640);
  if (process.platform !== 'win32') {
    assert.equal(after.uid, before.uid);
    assert.equal(after.gid, before.gid);
  }
});

test('captures and restores bounded service state only through the injected matching adapter', async () => {
  const root = await fixtureRoot('install-doctor-config-service-'); const target = join(root, 'service.conf');
  await writeFile(target, 'old\n', { mode: 0o600 }); const persistence = memoryPersistence(); const calls = [];
  const adapter = { manager: 'systemd', capture: async id => { calls.push(['capture', id]); return { enabled: true, running: false }; },
    restore: async (id, state) => { calls.push(['restore', id, state.enabled, state.running]); } };
  const transaction = await applyConfigurationTransaction({ spec: spec(target), candidateBytes: Buffer.from('new\n'), hooks, persistence,
    service: { serviceId: 'fixture.service', manager: 'systemd', adapter }, now: () => '2026-11-06T04:00:00.000Z' });
  assert.deepEqual(persistence.prepared[0].serviceSnapshot, { schemaVersion: 1, serviceId: 'fixture.service', manager: 'systemd', enabled: true, running: false });
  assert.equal(transaction.compensation.restores.includes('service-state'), true);
  await transaction.rollback();
  assert.deepEqual(calls, [['capture', 'fixture.service'], ['restore', 'fixture.service', true, false]]);
  await assert.rejects(applyConfigurationTransaction({ spec: spec(target), candidateBytes: Buffer.from('new\n'), hooks, persistence,
    service: { serviceId: 'fixture.service', manager: 'launchd', adapter } }), /adapter does not match/);
});

test('candidate validation failure leaves the prior file untouched', async () => {
  const root = await fixtureRoot('install-doctor-config-invalid-');
  const target = join(root, 'service.conf');
  await writeFile(target, 'old\n', { mode: 0o640 });
  await assert.rejects(applyConfigurationTransaction({
    spec: spec(target),
    candidateBytes: Buffer.from('new\n'),
    hooks: { ...hooks, validateCandidate: async () => { throw new Error('native validator rejected candidate'); } },
    persistence: memoryPersistence(),
  }), /native validator rejected candidate/);
  assert.equal(await readFile(target, 'utf8'), 'old\n');
  assert.equal((await stat(target)).mode & 0o7777, 0o640);
});

test('activation fails closed when durable compensation persistence is unavailable', async () => {
  const root = await fixtureRoot('install-doctor-config-no-persistence-');
  const target = join(root, 'service.conf');
  await writeFile(target, 'old\n', { mode: 0o640 });
  await assert.rejects(
    applyConfigurationTransaction({ spec: spec(target), candidateBytes: Buffer.from('new\n'), hooks }),
    /requires durable compensation persistence/,
  );
  assert.equal(await readFile(target, 'utf8'), 'old\n');
});

test('failed postcondition automatically restores prior content and reports applied compensation', async () => {
  const root = await fixtureRoot('install-doctor-config-postcondition-');
  const target = join(root, 'service.conf');
  await writeFile(target, 'old\n', { mode: 0o640 });
  const persistence = memoryPersistence();
  await assert.rejects(applyConfigurationTransaction({
    spec: spec(target), candidateBytes: Buffer.from('new\n'),
    hooks: { ...hooks, verifyPostcondition: async () => false },
    persistence,
    now: () => '2026-11-06T04:00:00.000Z',
  }), error => {
    assert.ok(error instanceof ConfigurationTransactionError);
    assert.equal(error.compensation?.state, 'applied');
    return true;
  });
  assert.equal(await readFile(target, 'utf8'), 'old\n');
  assert.equal(persistence.updated.at(-1)?.state, 'applied');
});

test('activation refuses a target changed while durable compensation is persisted', async () => {
  const root = await fixtureRoot('install-doctor-config-concurrent-activation-');
  const target = join(root, 'service.conf');
  await writeFile(target, 'old\n', { mode: 0o640 });
  const persistence = memoryPersistence();
  persistence.prepare = async artifact => {
    persistence.prepared.push(artifact);
    await writeFile(target, 'user-edit\n', { mode: 0o600 });
    await chmod(target, 0o600);
  };
  await assert.rejects(applyConfigurationTransaction({
    spec: spec(target), candidateBytes: Buffer.from('new\n'), hooks, persistence,
  }), /target changed after its compensation snapshot/);
  assert.equal(await readFile(target, 'utf8'), 'user-edit\n');
  assert.equal((await stat(target)).mode & 0o7777, 0o600);
});

test('activation refuses a target created while an absent snapshot is persisted', async () => {
  const root = await fixtureRoot('install-doctor-config-concurrent-create-');
  const target = join(root, 'service.conf');
  const persistence = memoryPersistence();
  persistence.prepare = async artifact => {
    persistence.prepared.push(artifact);
    await writeFile(target, 'user-created\n', { mode: 0o600 });
  };
  await assert.rejects(applyConfigurationTransaction({
    spec: spec(target), candidateBytes: Buffer.from('new\n'), hooks, persistence,
  }), /target changed after its compensation snapshot/);
  assert.equal(await readFile(target, 'utf8'), 'user-created\n');
});

test('activation refuses a concurrently substituted parent directory before rename', { skip: process.platform === 'win32' }, async () => {
  const root = await fixtureRoot('install-doctor-config-parent-race-');
  const moved = `${root}-moved`;
  const target = join(root, 'service.conf');
  const persistence = memoryPersistence();
  persistence.prepare = async artifact => {
    persistence.prepared.push(artifact);
    await rename(root, moved);
    await mkdir(root, { mode: 0o700 });
  };
  await assert.rejects(applyConfigurationTransaction({
    spec: spec(target), candidateBytes: Buffer.from('new\n'), hooks, persistence,
  }), /target parent changed during the transaction/);
  await assert.rejects(lstat(target), error => error.code === 'ENOENT');
  const candidate = (await readdir(moved)).find(name => name.endsWith('.candidate'));
  assert.ok(candidate);
  assert.equal((await readFile(join(moved, candidate), 'utf8')).trim(), 'new');
  await rm(root, { recursive: true, force: true });
  await rm(moved, { recursive: true, force: true });
});

test('automatic compensation preserves a concurrent post-activation edit as ambiguous', async () => {
  const root = await fixtureRoot('install-doctor-config-concurrent-restore-');
  const target = join(root, 'service.conf');
  await writeFile(target, 'old\n', { mode: 0o640 });
  const persistence = memoryPersistence();
  await assert.rejects(applyConfigurationTransaction({
    spec: spec(target), candidateBytes: Buffer.from('new\n'),
    hooks: {
      ...hooks,
      verifyPostcondition: async path => {
        await writeFile(path, 'user-edit\n', { mode: 0o600 });
        return false;
      },
    },
    persistence,
  }), error => {
    assert.ok(error instanceof ConfigurationTransactionError);
    assert.equal(error.compensation?.state, 'failed');
    assert.match(error.message, /automatic compensation both failed/);
    return true;
  });
  assert.equal(await readFile(target, 'utf8'), 'user-edit\n');
  assert.equal(persistence.updated.at(-1)?.state, 'failed');
});

test('explicit transaction rollback preserves a post-activation concurrent edit', async () => {
  const root = await fixtureRoot('install-doctor-config-concurrent-explicit-');
  const target = join(root, 'service.conf');
  await writeFile(target, 'old\n', { mode: 0o640 });
  const persistence = memoryPersistence();
  const transaction = await applyConfigurationTransaction({
    spec: spec(target), candidateBytes: Buffer.from('new\n'), hooks, persistence,
  });
  await writeFile(target, 'user-edit\n');
  await assert.rejects(transaction.rollback(), error => {
    assert.ok(error instanceof ConfigurationTransactionError);
    assert.equal(error.compensation?.state, 'failed');
    return true;
  });
  assert.equal(await readFile(target, 'utf8'), 'user-edit\n');
  assert.equal(persistence.updated.at(-1)?.state, 'failed');
});

test('rollback removes a configuration that did not exist before activation', async () => {
  const root = await fixtureRoot('install-doctor-config-absent-');
  const target = join(root, 'new.conf');
  const transaction = await applyConfigurationTransaction({
    spec: spec(target), candidateBytes: Buffer.from('new\n'), hooks, persistence: memoryPersistence(),
  });
  await transaction.rollback();
  await assert.rejects(lstat(target), error => error.code === 'ENOENT');
});

test('explicit rollback traverses dependents before their dependencies', async () => {
  const order = [];
  const makeTransaction = (taskId, dependencies) => ({
    spec: { ...spec(`/tmp/${taskId}`), taskId, dependencies },
    snapshot: { schemaVersion: 1, targetPath: `/tmp/${taskId}`, existed: false, mode: null, uid: null, gid: null, digest: null },
    compensation: { schemaVersion: 1, taskId, kind: 'configuration', state: 'available', createdAt: '2026-11-06T04:00:00.000Z', artifactDigest: 'a'.repeat(64), restores: ['bytes'] },
    rollback: async () => { order.push(taskId); return { schemaVersion: 1, taskId, kind: 'configuration', state: 'applied', createdAt: '2026-11-06T04:00:00.000Z', artifactDigest: 'a'.repeat(64), restores: ['bytes'] }; },
  });
  const base = makeTransaction('config.base', []);
  const service = makeTransaction('config.service', ['config.base']);
  const proxy = makeTransaction('config.proxy', ['config.service']);
  const records = await rollbackConfigurationTransactions([base, proxy, service]);
  assert.deepEqual(order, ['config.proxy', 'config.service', 'config.base']);
  assert.deepEqual(records.map(record => record.taskId), order);
});
