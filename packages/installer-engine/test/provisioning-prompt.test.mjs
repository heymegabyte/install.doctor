import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROVISIONING_PROMPT_VERSION, createProvisioningPromptContext,
  verifyProvisioningPromptContext,
} from '../dist/provisioning-prompt.js';

const input = {
  profile: { id: 'profile-1', revision: 'revision-7', digest: '1'.repeat(64) },
  release: { id: 'release-1', version: '2.2.5', digest: '2'.repeat(64) },
  discoveredFacts: { platform: 'linux', nested: { arch: 'x64', memoryBytes: 1024 } },
  policy: { network: { allowed: false }, concurrency: 2 },
  capabilities: ['configuration.read', 'packages.plan'],
  permittedTools: ['desktop_tools_discover', 'desktop_tools_plan'],
};

test('creates a stable versioned binding independent of object insertion order', () => {
  const first = createProvisioningPromptContext(input);
  const second = createProvisioningPromptContext({
    ...input,
    discoveredFacts: { nested: { memoryBytes: 1024, arch: 'x64' }, platform: 'linux' },
    policy: { concurrency: 2, network: { allowed: false } },
  });
  assert.equal(first.promptVersion, PROVISIONING_PROMPT_VERSION);
  assert.equal(first.promptDigest.length, 64);
  assert.equal(first.contextDigest, second.contextDigest);
  assert.deepEqual(verifyProvisioningPromptContext(first), first);
});

test('rejects mutation, unknown fields, duplicate or noncanonical authority lists', () => {
  const context = createProvisioningPromptContext(input);
  assert.throws(() => verifyProvisioningPromptContext({ ...context, policy: { network: { allowed: true } } }), /digest mismatch/);
  assert.throws(() => createProvisioningPromptContext({ ...input, permittedTools: ['z', 'a'] }), /sorted/);
  assert.throws(() => createProvisioningPromptContext({ ...input, capabilities: ['a', 'a'] }), /unique/);
  assert.throws(() => createProvisioningPromptContext({ ...input, discoveredFacts: { apiToken: 'must-not-bind' } }), /secret-shaped/);
  assert.throws(() => verifyProvisioningPromptContext({ ...context, secret: 'not-allowed' }));
});
