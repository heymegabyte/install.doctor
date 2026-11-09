import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blueprintDigest, exportMarkdown } from '../../aid-core/dist/core.js';
import { fetchProfileDesiredState } from '../dist/profile-desired-state.js';
import { ProtectedDeviceCredentialStore } from '../dist/target-device-credential.js';

const future = '2099-11-09T14:00:00.000Z';
const environment = {
  schemaVersion: 4,
  revision: 'revision-1',
  appUrl: 'https://desktop.tools',
  routing: { engine: 'projectsites', preferredProvider: 'deepseek', allowPremium: false, maxTaskCostMicros: 0 },
  skills: { repository: 'heymegabyte/agent-skills', commit: 'a'.repeat(40), include: [] },
  defaults: { packages: ['git'], shellHistory: 'hishtory', tier: 'workstation' },
  roles: [{ id: 'workstation', tier: 'workstation', packages: ['ripgrep'], capabilities: ['workstation'] }],
  machines: [{ id: 'zen', os: 'linux', role: 'workstation', tier: 'workstation', capabilities: ['linux'], packageOverrides: { add: ['jq'], remove: [] } }],
  services: [{ id: 'alloy', kind: 'loki', pushUrl: 'https://loki.example.test/push',
    credentialRef: 'infisical://desktop-tools/profiles/example/loki-writer', machineIds: ['zen'] }],
  privacy: { shellAnalysis: 'local', screenshots: 'off', terminalInput: false, productLearning: false },
  profile: { id: 'profile-1', revision: 'revision-1', visibility: 'public-bootstrap' },
  promptPolicy: { id: 'deterministic', version: 'v1', mode: 'deterministic-only', allowedRoutes: [] },
  secretReferences: [],
};

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'desktop-tools-desired-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = join(root, 'config');
  await mkdir(config, { mode: 0o700 });
  const credentialPath = join(config, 'device-credential.json');
  const environmentPath = join(config, 'ENVIRONMENT.md');
  const request = {
    schemaVersion: 1, requestId: 'request-1',
    binding: { tenantId: 'tenant-1', profileId: 'profile-1', targetPublicKey: 'A'.repeat(43),
      targetKeyFingerprint: 'a'.repeat(64), scopes: ['profile:read'], nonce: 'n'.repeat(32), expiresAt: future },
    machineLabel: 'zen', verificationCode: 'ABCD-EF12', pollKeyFingerprint: 'b'.repeat(64),
    createdAt: '2026-11-09T13:00:00.000Z',
  };
  await new ProtectedDeviceCredentialStore(credentialPath).save({ schemaVersion: 1, request,
    credential: 'secret-device-credential-never-log', credentialId: 'credential-1', expiresAt: future,
    storedAt: '2026-11-09T13:01:00.000Z' });
  const markdown = exportMarkdown(environment);
  const profileDigest = await blueprintDigest(environment);
  return { credentialPath, environmentPath, markdown, profileDigest };
}

test('fetches exact profile desired state, resolves one machine, and is unchanged on a second run', async t => {
  const item = await fixture(t);
  let calls = 0;
  const fetch = async (url, init) => {
    calls += 1;
    assert.equal(String(url), 'https://brian.desktop.tools/api/device/current');
    assert.equal(init.headers.authorization, 'Bearer secret-device-credential-never-log');
    return Response.json({ tenant: 'tenant-1', deviceId: 'credential-1', revision: 'revision-1',
      digest: item.profileDigest, updatedAt: '2026-11-09T13:02:00.000Z', markdown: item.markdown });
  };
  const input = { origin: 'https://brian.desktop.tools', credentialPath: item.credentialPath,
    environmentPath: item.environmentPath, expectedProfileId: 'profile-1', expectedProfileDigest: item.profileDigest,
    machineId: 'zen', hostOs: 'linux', fetch };
  const first = await fetchProfileDesiredState(input);
  assert.deepEqual(first.selectedPackages, ['git', 'jq', 'ripgrep']);
  assert.deepEqual(first.selectedServices, ['alloy']);
  assert.equal(first.machineRole, 'workstation');
  assert.equal(first.unchanged, false);
  assert.equal(await readFile(item.environmentPath, 'utf8'), item.markdown);
  assert.equal((await fetchProfileDesiredState(input)).unchanged, true);
  assert.equal(calls, 2);
});

test('rejects profile, digest, device, scope, origin, and partial-response substitution', async t => {
  const item = await fixture(t);
  const body = { tenant: 'tenant-1', deviceId: 'credential-1', revision: 'revision-1',
    digest: item.profileDigest, updatedAt: '2026-11-09T13:02:00.000Z', markdown: item.markdown };
  const base = { origin: 'https://brian.desktop.tools', credentialPath: item.credentialPath,
    environmentPath: item.environmentPath, expectedProfileId: 'profile-1', expectedProfileDigest: item.profileDigest,
    machineId: 'zen', hostOs: 'linux' };
  await assert.rejects(fetchProfileDesiredState({ ...base, expectedProfileDigest: 'f'.repeat(64), fetch: async () => Response.json(body) }), /authority/);
  await assert.rejects(fetchProfileDesiredState({ ...base, machineId: 'other', fetch: async () => Response.json(body) }), /exact machine/);
  await assert.rejects(fetchProfileDesiredState({ ...base, hostOs: 'darwin', fetch: async () => Response.json(body) }), /operating system/);
  await assert.rejects(fetchProfileDesiredState({ ...base, origin: 'https://desktop.tools.evil.example', fetch: async () => Response.json(body) }), /exact Desktop Tools/);
  await assert.rejects(fetchProfileDesiredState({ ...base, fetch: async () => Response.json({ ...body, deviceId: 'credential-2' }) }), /authority/);
  await assert.rejects(fetchProfileDesiredState({ ...base, fetch: async () => new Response('{', { status: 200 }) }), /UTF-8 JSON/);
  await assert.rejects(fetchProfileDesiredState({ ...base, fetch: async () => new Response('{}', {
    status: 200, headers: { 'content-length': '2100001' },
  }) }), /byte bound/);
  await writeFile(item.environmentPath, 'unsafe', { mode: 0o644 });
  await assert.rejects(fetchProfileDesiredState({ ...base, fetch: async () => Response.json(body) }), /mode 0600/);
});

test('failed refresh preserves the previous complete desired state', async t => {
  const item = await fixture(t);
  await writeFile(item.environmentPath, item.markdown, { mode: 0o600 });
  const input = { origin: 'https://brian.desktop.tools', credentialPath: item.credentialPath,
    environmentPath: item.environmentPath, expectedProfileId: 'profile-1', expectedProfileDigest: item.profileDigest,
    machineId: 'zen', hostOs: 'linux', fetch: async () => Response.json({
      tenant: 'tenant-1', deviceId: 'credential-1', revision: 'revision-1', digest: 'f'.repeat(64),
      updatedAt: '2026-11-09T13:02:00.000Z', markdown: item.markdown,
    }) };
  await assert.rejects(fetchProfileDesiredState(input), /authority/);
  assert.equal(await readFile(item.environmentPath, 'utf8'), item.markdown);
});
