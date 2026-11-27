import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  applyTransaction, buildHostDescriptor, loadPinnedProfiles, mergeClientConfig, rollbackTransaction,
} from './mcp-host-manifest-consumer.mjs';

const hash = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const repositoryRoot = dirname(new URL(import.meta.url).pathname);
const canonicalRoot = join(repositoryRoot, '..', 'config', 'mcp-portals');
const canonicalPin = join(canonicalRoot, 'canonical-pin.json');
const canonicalProfiles = join(canonicalRoot, 'canonical-profiles');

for (const hostClass of ['macos-workstation', 'ubuntu-runner']) {
  const pinned = await loadPinnedProfiles({ pinPath: canonicalPin, sourceDirectory: canonicalProfiles, hostClass });
  assert.equal(pinned.profiles.length, 2);
  for (const pinnedProfile of pinned.profiles) {
    assert.deepEqual(pinnedProfile.remote.serverGrants, [{
      serverId: 'megabyte-os-public',
      url: 'https://os.mcp.megabyte.space/',
      auth: 'public-read',
      risk: 'read',
    }]);
    assert.equal(pinnedProfile.remote.serverGrants.some(({ serverId }) => ['cua-driver', 'browsermcp', 'logo-dev', 'brandfetch'].includes(serverId)), false);
  }
}

const temp = mkdtempSync(join(tmpdir(), 'mcp-host-manifest-consumer-'));
const source = join(temp, 'source');
mkdirSync(source);
const sourceDigest = `sha256:${'1'.repeat(64)}`;
const revision = '2'.repeat(40);
const profile = (id, hostClass, automation) => ({
  schemaVersion: 1,
  id,
  sourceDigest,
  selector: { hostClass, clientKinds: automation ? ['openclaw'] : ['codex'] },
  remote: {
    managedName: automation ? 'megabyte-automation' : 'megabyte-primary',
    portalId: automation ? 'automation' : 'primary',
    endpoint: automation ? 'https://automation.mcp.megabyte.space/mcp' : 'https://mcp.megabyte.space/mcp',
    authMode: automation ? 'service-token' : 'browser-oauth-posture',
    codeMode: 'off',
    profileIds: automation ? ['automation'] : ['developer'],
    workloadId: automation ? (hostClass === 'macos-workstation' ? 'macos.megabyte.space' : 'ubuntu.megabyte.space') : null,
    runtimeSecretRefs: automation ? {
      clientId: { provider: 'infisical', project: hostClass === 'macos-workstation' ? 'macos.megabyte.space' : 'ubuntu.megabyte.space', environment: 'prod', path: '/', name: 'CLIENT_ID' },
      clientSecret: { provider: 'infisical', project: hostClass === 'macos-workstation' ? 'macos.megabyte.space' : 'ubuntu.megabyte.space', environment: 'prod', path: '/', name: 'CLIENT_SECRET' },
    } : null,
    serverGrants: [],
    headers: automation ? { Header: { secretRef: 'clientId' } } : null,
  },
  merge: {
    ownershipPrefix: 'megabyte-', preserveLocalServers: ['cua-driver'], preserveUnknownEntries: true,
    atomic: true, predecessorSnapshotRequired: true,
  },
  installPolicy: 'canary-opt-in',
  verification: ['rollback'],
});
const profiles = [
  profile('macos-human', 'macos-workstation', false),
  profile('macos-automation', 'macos-workstation', true),
  profile('ubuntu-human', 'ubuntu-runner', false),
  profile('ubuntu-automation', 'ubuntu-runner', true),
];
const index = {
  schemaVersion: 1,
  sourceDigest,
  assignments: profiles.map(({ id, selector }) => ({ id, selector, installPolicy: 'canary-opt-in', path: `./${id}.json` })),
};
const files = { 'index.json': `${JSON.stringify(index)}\n` };
for (const value of profiles) files[`${value.id}.json`] = `${JSON.stringify(value)}\n`;
for (const [name, value] of Object.entries(files)) writeFileSync(join(source, name), value);
const pin = {
  schemaVersion: 1,
  repository: 'heymegabyte/mcp.megabyte.space',
  revision,
  baseUrl: 'https://example.invalid/generated/profiles',
  sourceDigest,
  artifacts: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, hash(value)])),
};
const pinPath = join(temp, 'pin.json');
writeFileSync(pinPath, JSON.stringify(pin));

const macos = await loadPinnedProfiles({ pinPath, sourceDirectory: source, hostClass: 'macos-workstation' });
const ubuntu = await loadPinnedProfiles({ pinPath, sourceDirectory: source, hostClass: 'ubuntu-runner' });
assert.deepEqual(macos.profiles.map(({ id }) => id), ['macos-human', 'macos-automation']);
assert.deepEqual(ubuntu.profiles.map(({ id }) => id), ['ubuntu-human', 'ubuntu-automation']);
assert.equal(macos.profiles[1].remote.runtimeSecretRefs.clientId.project, 'macos.megabyte.space');
assert.equal(ubuntu.profiles[1].remote.runtimeSecretRefs.clientId.project, 'ubuntu.megabyte.space');
await assert.rejects(() => loadPinnedProfiles({ pinPath, sourceDirectory: source, hostClass: 'unknown' }), /unsupported host class/);

const preservedDescriptor = buildHostDescriptor({ note: 'keep', profiles: { local: { enabled: true } } }, macos, 'macos-workstation');
assert.equal(preservedDescriptor.note, 'keep');
assert.equal(preservedDescriptor.profiles.local.enabled, true);
assert.throws(() => buildHostDescriptor({ profiles: { 'macos-human': { foreign: true } } }, macos, 'macos-workstation'), /profile collision/);

const mergedClient = mergeClientConfig({ other: 'keep', mcpServers: { 'cua-driver': { command: 'cua-driver' } } }, macos);
assert.equal(mergedClient.other, 'keep');
assert.deepEqual(mergedClient.mcpServers['cua-driver'], { command: 'cua-driver' });
assert.equal(mergedClient.mcpServers['megabyte-primary'].url, 'https://mcp.megabyte.space/mcp');
assert.equal(mergedClient.mcpServers['megabyte-automation']['x-runtimeSecretRefs'].clientId.project, 'macos.megabyte.space');
assert.throws(() => mergeClientConfig({ mcpServers: { 'megabyte-primary': { url: 'https://foreign.invalid' } } }, macos), /collision/);

const corrupted = join(temp, 'corrupted');
mkdirSync(corrupted);
for (const [name, value] of Object.entries(files)) writeFileSync(join(corrupted, name), value);
writeFileSync(join(corrupted, 'macos-human.json'), '{}\n');
await assert.rejects(() => loadPinnedProfiles({ pinPath, sourceDirectory: corrupted, hostClass: 'macos-workstation' }), /digest mismatch/);

const destination = join(temp, 'installed', 'host.json');
const client = join(temp, 'installed', 'client.json');
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, '{"prior":true}\n');
writeFileSync(client, '{"mcpServers":{"local":{"command":"local"}}}\n');
chmodSync(destination, 0o644);
const receiptPath = join(temp, 'rollback', 'receipt.json');
const installedDescriptor = `${JSON.stringify(preservedDescriptor)}\n`;
const installedClient = `${JSON.stringify(mergedClient)}\n`;
const receipt = applyTransaction({ outputs: [
  { path: destination, content: installedDescriptor }, { path: client, content: installedClient },
], receiptPath });
assert.equal(receipt.records.length, 2);
assert.equal(statSync(destination).mode & 0o777, 0o600);
assert.equal(statSync(receiptPath).mode & 0o777, 0o600);
assert.equal(readFileSync(receiptPath, 'utf8').includes(installedDescriptor), false);
assert.equal(JSON.parse(readFileSync(client, 'utf8')).mcpServers['cua-driver'].command, 'cua-driver');
const rollback = rollbackTransaction(receiptPath);
assert.equal(rollback.status, 'restored');
assert.deepEqual(JSON.parse(readFileSync(destination, 'utf8')), { prior: true });
assert.deepEqual(JSON.parse(readFileSync(client, 'utf8')), { mcpServers: { local: { command: 'local' } } });

const driftDestination = join(temp, 'drift.json');
const driftReceipt = join(temp, 'drift-receipt.json');
applyTransaction({ outputs: [{ path: driftDestination, content: '{"installed":true}\n' }], receiptPath: driftReceipt });
writeFileSync(driftDestination, '{"operator":"changed"}\n');
assert.throws(() => rollbackTransaction(driftReceipt), /drift blocks rollback/);

const atomicDestination = join(temp, 'atomic.json');
writeFileSync(atomicDestination, '{"before":true}\n');
const blocker = join(temp, 'not-a-directory');
writeFileSync(blocker, 'block');
assert.throws(() => applyTransaction({ outputs: [
  { path: atomicDestination, content: '{"after":true}\n' },
  { path: join(blocker, 'fails.json'), content: '{}\n' },
], receiptPath: join(temp, 'atomic-receipt.json') }));
assert.deepEqual(JSON.parse(readFileSync(atomicDestination, 'utf8')), { before: true });

console.log('mcp host manifest consumer: ok');
