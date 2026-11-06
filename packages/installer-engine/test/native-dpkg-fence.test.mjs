import assert from 'node:assert/strict';
import { chmod, link, lstat, mkdtemp, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  NATIVE_DPKG_FENCE_PATH,
  NativeDpkgFenceBusyError,
  NativeDpkgFenceIntegrityError,
  NativeDpkgFenceLostError,
  createNativeDpkgFence,
} from '../dist/native-dpkg-fence.js';

const planDigest = 'a'.repeat(64);
const uid = process.getuid?.() ?? 0;

async function fixture(overrides = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'install-doctor-dpkg-fence-')));
  await chmod(root, 0o700);
  const ownerPath = join(root, 'dpkg-transaction.owner.json');
  let milliseconds = Date.parse('2026-11-06T12:00:00.000Z');
  const alive = new Map([[101, 'start-one'], [202, 'start-two']]);
  const fence = createNativeDpkgFence({
    fixture: { ownerPath, expectedUid: uid },
    bootId: 'boot-one', processStart: 'start-one', pid: 101,
    now: () => new Date(milliseconds).toISOString(),
    isProcessAlive: async (pid, processStart) => alive.get(pid) === processStart,
    leaseMs: 10_000, acquisitionTimeoutMs: 20, pollIntervalMs: 1,
    sleep: async () => {},
    ...overrides,
  });
  return { root, ownerPath, fence, alive, advance: value => { milliseconds += value; } };
}

const claim = { runId: 'run-one', hostId: 'host-one', planDigest };

test('uses one fixed production path and publishes a strict private durable owner', async () => {
  assert.equal(NATIVE_DPKG_FENCE_PATH, '/run/lock/install-doctor/dpkg-transaction.owner.json');
  const state = await fixture();
  const owner = await state.fence.acquire(claim);
  assert.equal(owner.schemaVersion, 1);
  assert.equal(owner.kind, 'install-doctor-native-dpkg-transaction');
  assert.equal(owner.pid, 101);
  assert.equal(owner.bootId, 'boot-one');
  assert.equal(owner.processStart, 'start-one');
  assert.match(owner.token, /^[0-9a-f-]{36}$/);
  assert.deepEqual(JSON.parse(await readFile(state.ownerPath, 'utf8')), owner);
  const metadata = await lstat(state.ownerPath);
  assert.equal(metadata.isFile(), true);
  assert.equal(metadata.isSymbolicLink(), false);
  assert.equal(metadata.mode & 0o777, 0o600);
  assert.equal(metadata.uid, uid);
  assert.equal(metadata.nlink, 1);
  assert.deepEqual(await readdir(state.root), ['dpkg-transaction.owner.json']);
});

test('a live process identity excludes competitors even after its lease expires', async () => {
  const state = await fixture();
  await state.fence.acquire(claim);
  state.advance(60_000);
  const competitor = createNativeDpkgFence({
    fixture: { ownerPath: state.ownerPath, expectedUid: uid },
    bootId: 'boot-one', processStart: 'start-two', pid: 202,
    now: () => '2026-11-06T12:01:00.000Z',
    isProcessAlive: async (pid, processStart) => state.alive.get(pid) === processStart,
    acquisitionTimeoutMs: 2, pollIntervalMs: 1, sleep: async () => {},
  });
  await assert.rejects(competitor.acquire({ ...claim, runId: 'run-two' }), NativeDpkgFenceBusyError);
});

test('PID reuse does not preserve an expired owner and stale evidence is quarantined', async () => {
  const state = await fixture();
  const first = await state.fence.acquire(claim);
  state.advance(20_000);
  state.alive.set(101, 'reused-process-start');
  const replacement = await state.fence.acquire({ ...claim, runId: 'run-two' });
  assert.notEqual(replacement.token, first.token);
  const names = await readdir(state.root);
  assert.equal(names.includes('dpkg-transaction.owner.json'), true);
  const quarantine = names.find(name => name.startsWith('dpkg-transaction.owner.json.stale.'));
  assert.ok(quarantine);
  assert.equal(JSON.parse(await readFile(join(state.root, quarantine), 'utf8')).token, first.token);
});

test('a prior-boot owner is quarantined without trusting a recycled PID', async () => {
  const state = await fixture();
  await state.fence.acquire(claim);
  const nextBoot = createNativeDpkgFence({
    fixture: { ownerPath: state.ownerPath, expectedUid: uid },
    bootId: 'boot-two', processStart: 'start-two', pid: 202,
    now: () => '2026-11-06T12:00:01.000Z', isProcessAlive: async () => true,
  });
  const owner = await nextBoot.acquire({ ...claim, runId: 'run-two' });
  assert.equal(owner.bootId, 'boot-two');
  assert.equal((await readdir(state.root)).some(name => name.includes('.stale.')), true);
});

test('renew and release are fenced by the exact token and process identity', async () => {
  const state = await fixture();
  const owner = await state.fence.acquire(claim);
  state.advance(1_000);
  const renewed = await state.fence.renew(owner);
  assert.notEqual(renewed.heartbeatAt, owner.heartbeatAt);
  await assert.rejects(state.fence.release(owner), NativeDpkgFenceLostError);
  await assert.rejects(state.fence.renew({ ...renewed, token: '00000000-0000-4000-8000-000000000000' }), NativeDpkgFenceLostError);
  await assert.rejects(state.fence.release({ ...renewed, processStart: 'other-start' }), NativeDpkgFenceLostError);
  assert.equal((await state.fence.inspect()).state, 'owned');
  await state.fence.release(renewed);
  assert.equal((await state.fence.inspect()).state, 'absent');
});

test('strict parsing rejects unknown fields and malformed time ordering', async () => {
  const state = await fixture();
  const owner = await state.fence.acquire(claim);
  await writeFile(state.ownerPath, `${JSON.stringify({ ...owner, surprise: true })}\n`, { mode: 0o600 });
  assert.equal((await state.fence.inspect()).state, 'corrupt');
  await assert.rejects(state.fence.acquire({ ...claim, runId: 'run-two' }), NativeDpkgFenceIntegrityError);
  await writeFile(state.ownerPath, `${JSON.stringify({ ...owner, heartbeatAt: '2026-11-06T12:00:10.000Z', leaseUntil: '2026-11-06T12:00:05.000Z' })}\n`, { mode: 0o600 });
  assert.equal((await state.fence.inspect()).state, 'corrupt');
});

test('rejects symlinks, permissive files, and hard links', async () => {
  for (const mutation of ['symlink', 'mode', 'nlink']) {
    const state = await fixture();
    if (mutation === 'symlink') {
      const target = join(state.root, 'target');
      await writeFile(target, '{}\n', { mode: 0o600 });
      await symlink(target, state.ownerPath);
    } else {
      await state.fence.acquire(claim);
      if (mutation === 'mode') await chmod(state.ownerPath, 0o644);
      if (mutation === 'nlink') await link(state.ownerPath, join(state.root, 'second-link'));
    }
    assert.equal((await state.fence.inspect()).state, 'corrupt', mutation);
    await assert.rejects(state.fence.acquire({ ...claim, runId: 'run-two' }), NativeDpkgFenceIntegrityError);
  }
});

test('rejects an unprotected parent and bounds contended acquisition attempts', async () => {
  const insecure = await fixture();
  await chmod(insecure.root, 0o755);
  await assert.rejects(insecure.fence.acquire(claim), NativeDpkgFenceIntegrityError);
  let sleeps = 0;
  const state = await fixture();
  await state.fence.acquire(claim);
  const competitor = createNativeDpkgFence({
    fixture: { ownerPath: state.ownerPath, expectedUid: uid },
    bootId: 'boot-one', processStart: 'start-two', pid: 202,
    now: () => '2026-11-06T12:00:00.000Z', isProcessAlive: async () => true,
    acquisitionTimeoutMs: 5, pollIntervalMs: 2,
    sleep: async () => { sleeps += 1; },
  });
  await assert.rejects(competitor.acquire({ ...claim, runId: 'run-two' }), NativeDpkgFenceBusyError);
  assert.ok(sleeps > 0 && sleeps <= 4, `unexpected retry count: ${sleeps}`);
});

test('does not touch or claim exclusion over dpkg database lock files', async () => {
  const source = await readFile(new URL('../src/native-dpkg-fence.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\/var\/lib\/dpkg|lock-frontend/);
});
