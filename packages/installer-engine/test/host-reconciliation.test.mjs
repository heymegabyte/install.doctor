import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { HostReconciliationLeaseError, createHostReconciler } from '../dist/index.js';

const evidence = character => ({ evidenceDigest: character.repeat(64) });

async function fixture(t) {
  const stateRoot = await mkdtemp(join(tmpdir(), 'desktop-tools-reconciliation-'));
  await chmod(stateRoot, 0o700);
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  let clock = Date.parse('2026-11-10T12:00:00.000Z');
  const now = () => new Date(clock++).toISOString();
  const common = { stateRoot, hostId: 'host-one', leaseMs: 10_000, now };
  return { stateRoot, common, advance: milliseconds => { clock += milliseconds; } };
}

test('persists the complete reconciliation lifecycle separately from desired state', async t => {
  const state = await fixture(t);
  const reconciler = await createHostReconciler({ ...state.common, ownerId: 'controller-one' });
  await reconciler.discover({ cycleId: 'cycle-one', desiredRevision: 'revision-one' }, async () => evidence('a'));
  await reconciler.validate(async () => evidence('b'));
  await reconciler.plan(async () => evidence('c'));
  await reconciler.approve(async () => evidence('d'));
  await reconciler.apply(async () => evidence('e'));
  const completed = await reconciler.verify(async () => evidence('f'));
  assert.equal(completed.status, 'verified');
  assert.deepEqual(completed.completedActions, ['discover', 'validate', 'plan', 'approve', 'apply', 'verify']);
  const status = await reconciler.status();
  assert.equal(status.lease, null, 'verified reconciliation releases host ownership');
  assert.equal(status.state.lastEvidenceDigest, 'f'.repeat(64));
  const durable = JSON.parse(await readFile(join(state.stateRoot, 'hosts', 'host-one', 'state.json'), 'utf8'));
  assert.deepEqual(durable, status.state);
  await assert.rejects(readFile(join(state.stateRoot, 'desired-state.json')), error => error.code === 'ENOENT');
});

test('pause, resume, interruption, and stop preserve exact durable progress', async t => {
  const state = await fixture(t);
  const first = await createHostReconciler({ ...state.common, ownerId: 'controller-one' });
  await first.discover({ cycleId: 'cycle-one', desiredRevision: 'revision-one' }, async () => evidence('a'));
  const paused = await first.pause();
  assert.equal(paused.status, 'paused');
  assert.equal((await first.status()).lease, null);

  const second = await createHostReconciler({ ...state.common, ownerId: 'controller-two' });
  assert.equal((await second.resume()).status, 'active');
  await second.validate(async () => evidence('b'));
  await assert.rejects(second.plan(async () => { throw new Error('planner interrupted'); }), /planner interrupted/);
  const interrupted = await second.status();
  assert.equal(interrupted.state.status, 'paused');
  assert.equal(interrupted.state.activeAction, 'plan');
  assert.equal(interrupted.lease, null);
  await second.resume();
  await second.plan(async () => evidence('c'));
  const stopped = await second.stop();
  assert.equal(stopped.status, 'stopped');
  assert.deepEqual(stopped.completedActions, ['discover', 'validate', 'plan']);
  assert.equal((await second.status()).lease, null);
});

test('concurrent reconcilers cannot own one host and stale takeover requires expiry plus failed liveness', async t => {
  const state = await fixture(t);
  const first = await createHostReconciler({ ...state.common, ownerId: 'controller-one', isOwnerAlive: async () => true });
  const second = await createHostReconciler({ ...state.common, ownerId: 'controller-two', isOwnerAlive: async () => true });
  const claims = await Promise.allSettled([
    first.discover({ cycleId: 'cycle-one', desiredRevision: 'revision-one' }, async () => evidence('a')),
    second.discover({ cycleId: 'cycle-one', desiredRevision: 'revision-one' }, async () => evidence('a')),
  ]);
  assert.equal(claims.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(claims.filter(result => result.status === 'rejected'
    && result.reason instanceof HostReconciliationLeaseError).length, 1);
  const owner = claims[0].status === 'fulfilled' ? first : second;
  assert.equal((await owner.status()).lease.ownerId, claims[0].status === 'fulfilled' ? 'controller-one' : 'controller-two');

  state.advance(20_000);
  const liveAfterExpiry = await createHostReconciler({ ...state.common, ownerId: 'controller-three', isOwnerAlive: async () => true });
  await assert.rejects(liveAfterExpiry.resume(), HostReconciliationLeaseError);
  const takeover = await createHostReconciler({ ...state.common, ownerId: 'controller-four', isOwnerAlive: async () => false });
  await assert.rejects(takeover.resume(), /only a paused reconciliation can resume/);
  assert.equal((await owner.status()).lease, null, 'failed stale takeover releases its newly claimed lease');
});

test('rejects skipped phases and non-owner controls without changing durable state', async t => {
  const state = await fixture(t);
  const owner = await createHostReconciler({ ...state.common, ownerId: 'controller-one' });
  await owner.discover({ cycleId: 'cycle-one', desiredRevision: 'revision-one' }, async () => evidence('a'));
  await assert.rejects(owner.plan(async () => evidence('c')), /expected reconciliation action validate/);
  const other = await createHostReconciler({ ...state.common, ownerId: 'controller-two' });
  await assert.rejects(other.pause(), HostReconciliationLeaseError);
  await assert.rejects(other.stop(), HostReconciliationLeaseError);
  const status = await owner.status();
  assert.deepEqual(status.state.completedActions, ['discover']);
  assert.equal(status.lease.ownerId, 'controller-one');
});

test('rejects a symlinked state root before changing its target permissions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-tools-reconciliation-link-'));
  const target = join(root, 'target');
  const stateRoot = join(root, 'state');
  await mkdir(target, { mode: 0o755 });
  await symlink(target, stateRoot);
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(createHostReconciler({ stateRoot, hostId: 'host-one', ownerId: 'controller-one' }), /real directory/);
  assert.equal((await stat(target)).mode & 0o777, 0o755);
});
