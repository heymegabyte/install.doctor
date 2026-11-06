import assert from 'node:assert/strict';
import test from 'node:test';
import { isPlatformProcessIdentityAlive, resolvePlatformProcessIdentity } from '../dist/index.js';

test('platform process identity distinguishes the current process from a reused PID identity', {
  skip: process.platform !== 'linux' && process.platform !== 'darwin',
}, async () => {
  const identity = await resolvePlatformProcessIdentity();
  assert.ok(identity.bootId.length > 0);
  assert.ok(identity.processStart.length > 0);
  assert.equal(await isPlatformProcessIdentityAlive(process.pid, identity.processStart), true);
  assert.equal(await isPlatformProcessIdentityAlive(process.pid, `${identity.processStart}-reused`), false);
});

test('unsupported platforms do not claim a protected process identity', {
  skip: process.platform === 'linux' || process.platform === 'darwin',
}, async () => {
  await assert.rejects(resolvePlatformProcessIdentity(), /unsupported/);
});
