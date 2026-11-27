import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const descriptor = join(root, 'home/dot_config/mcp-portals/endpoints.json');
const helper = join(root, 'home/dot_local/bin/executable_mcp-portal-profile.mjs');
const raw = await readFile(descriptor, 'utf8');
const config = JSON.parse(raw);
const canonicalAutomation = JSON.parse(await readFile(
  join(root, 'config/mcp-portals/canonical-profiles/macos-automation.json'),
  'utf8',
));

assert.equal(config.schemaVersion, 1);
assert.deepEqual(Object.keys(config.profiles), ['primary', 'automation', 'sandbox', 'ops', 'canary']);
assert.deepEqual(Object.values(config.profiles).map(({ url }) => url), [
  'https://mcp.megabyte.space/mcp',
  'https://automation.mcp.megabyte.space/mcp',
  'https://sandbox.mcp.megabyte.space/mcp',
  'https://ops.mcp.megabyte.space/mcp',
  'https://canary.mcp.megabyte.space/mcp',
]);
assert.deepEqual(config.localOnlyServers, ['cua-driver', 'browsermcp']);
assert.equal(raw.includes('test-client-id'), false);
assert.equal(raw.includes('test-client-secret'), false);
assert.deepEqual(config.profiles.automation.secretRefs, {
  clientId: canonicalAutomation.remote.runtimeSecretRefs.clientId.name,
  clientSecret: canonicalAutomation.remote.runtimeSecretRefs.clientSecret.name,
});

const temp = await mkdtemp(join(tmpdir(), 'mcp-portal-profile-'));
try {
  const bin = join(temp, 'bin');
  const getSecret = join(bin, 'get-secret');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(bin));
  await writeFile(getSecret, '#!/bin/sh\nprintf "resolved-%s\\n" "$1"\n');
  await chmod(getSecret, 0o700);
  const probe = join(temp, 'probe.mjs');
  await writeFile(probe, `
    import assert from 'node:assert/strict';
    assert.equal(process.env.MCP_PORTAL_PROFILE, 'automation');
    assert.equal(process.env.MCP_PORTAL_URL, 'https://automation.mcp.megabyte.space/mcp');
    assert.equal(process.env.MCP_PORTAL_CF_ACCESS_CLIENT_ID, 'resolved-CF_ACCESS_MCP_AUTOMATION_CLIENT_ID');
    assert.equal(process.env.MCP_PORTAL_CF_ACCESS_CLIENT_SECRET, 'resolved-CF_ACCESS_MCP_AUTOMATION_CLIENT_SECRET');
  `);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, MCP_PORTAL_CONFIG: descriptor };
  execFileSync(process.execPath, [helper, 'exec', 'automation', '--', process.execPath, probe], { env, stdio: 'pipe' });
  const first = execFileSync(process.execPath, [helper, 'list'], { env, encoding: 'utf8' });
  const second = execFileSync(process.execPath, [helper, 'list'], { env, encoding: 'utf8' });
  assert.equal(first, second);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('mcp portal profiles: ok');
