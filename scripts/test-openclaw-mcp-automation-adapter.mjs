import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadPinnedProfiles, rollbackTransaction } from './mcp-host-manifest-consumer.mjs';
import { mergeOpenClawConfig } from './openclaw-mcp-automation-adapter.mjs';

const repositoryRoot = dirname(new URL(import.meta.url).pathname);
const projectRoot = join(repositoryRoot, '..');
const adapter = join(repositoryRoot, 'openclaw-mcp-automation-adapter.mjs');
const canonicalRoot = join(projectRoot, 'config', 'mcp-portals');
const canonical = { pinPath: join(canonicalRoot, 'canonical-pin.json'), sourceDirectory: join(canonicalRoot, 'canonical-profiles') };

for (const [hostClass, project, profileId] of [
  ['macos-workstation', 'macos.megabyte.space', 'macos-automation'],
  ['ubuntu-runner', 'ubuntu.megabyte.space', 'ubuntu-automation'],
]) {
  const loaded = await loadPinnedProfiles({ ...canonical, hostClass });
  const existing = { untouched: { nested: true }, mcp: { setting: 'keep', servers: { local: { command: 'local-mcp' } } } };
  const merged = mergeOpenClawConfig(existing, loaded, hostClass);
  assert.deepEqual(merged.untouched, existing.untouched);
  assert.equal(merged.mcp.setting, 'keep');
  assert.deepEqual(merged.mcp.servers.local, { command: 'local-mcp' });
  const managed = merged.mcp.servers['megabyte-automation'];
  assert.equal(managed.url, 'https://automation.mcp.megabyte.space/mcp');
  assert.equal(managed['x-installDoctor'].profileId, profileId);
  assert.deepEqual(managed.headers, {
    'CF-Access-Client-Id': '${CF_ACCESS_MCP_AUTOMATION_CLIENT_ID}',
    'CF-Access-Client-Secret': '${CF_ACCESS_MCP_AUTOMATION_CLIENT_SECRET}',
  });
  assert.equal(JSON.stringify(managed).includes(project), false, 'project identity belongs to the canonical pin, not a second editable config field');
  assert.throws(() => mergeOpenClawConfig({ mcp: { servers: { 'megabyte-automation': { url: 'https://foreign.invalid' } } } }, loaded, hostClass), /collision/);
}

const temp = mkdtempSync(join(tmpdir(), 'openclaw-mcp-automation-'));
const config = join(temp, 'openclaw.json');
const receipt = join(temp, 'state', 'receipt.json');
const original = { existing: 'preserved', mcp: { servers: { local: { command: 'local' } } } };
writeFileSync(config, `${JSON.stringify(original)}\n`);
chmodSync(config, 0o664);
const common = ['--host-class', 'ubuntu-runner', '--pin', canonical.pinPath, '--source-directory', canonical.sourceDirectory, '--config', config];
const plan = execFileSync(process.execPath, [adapter, 'plan', ...common], { encoding: 'utf8' });
assert.equal(plan.includes('synthetic-client'), false);
const planJson = JSON.parse(plan);
assert.equal(planJson.preservation.existingMcpServers, 1);
assert.equal(planJson.runtimeSecretNames.length, 2);
assert.deepEqual(JSON.parse(readFileSync(config, 'utf8')), original, 'plan must not mutate config');

const applied = execFileSync(process.execPath, [adapter, 'apply', ...common, '--receipt', receipt], { encoding: 'utf8' });
assert.equal(JSON.parse(applied).status, 'installed');
assert.equal(statSync(config).mode & 0o777, 0o600);
assert.equal(statSync(receipt).mode & 0o777, 0o600);
const installedText = readFileSync(config, 'utf8');
assert.equal(installedText.includes('synthetic-client'), false);
assert.equal(installedText.includes('${CF_ACCESS_MCP_AUTOMATION_CLIENT_ID}'), true);
assert.deepEqual(JSON.parse(installedText).mcp.servers.local, { command: 'local' });
const receiptText = readFileSync(receipt, 'utf8');
assert.equal(receiptText.includes('CF_ACCESS_MCP_AUTOMATION'), false);
assert.equal(JSON.parse(receiptText).operation, 'install-openclaw-mcp-automation');
assert.equal(rollbackTransaction(receipt).status, 'restored');
assert.deepEqual(JSON.parse(readFileSync(config, 'utf8')), original);

const bin = join(temp, 'bin');
mkdirSync(bin);
writeFileSync(join(bin, 'get-secret'), `#!/bin/sh\ncase "$1" in\n  CF_ACCESS_MCP_AUTOMATION_CLIENT_ID) printf synthetic-client-id ;;\n  CF_ACCESS_MCP_AUTOMATION_CLIENT_SECRET) printf synthetic-client-secret ;;\n  *) exit 9 ;;\nesac\n`);
writeFileSync(join(bin, 'openclaw'), `#!/bin/sh\n[ "$CF_ACCESS_MCP_AUTOMATION_CLIENT_ID" = synthetic-client-id ] || exit 21\n[ "$CF_ACCESS_MCP_AUTOMATION_CLIENT_SECRET" = synthetic-client-secret ] || exit 22\nprintf runtime-ok\n`);
chmodSync(join(bin, 'get-secret'), 0o700);
chmodSync(join(bin, 'openclaw'), 0o700);
const runtime = execFileSync(process.execPath, [adapter, 'exec', ...common, '--allowed-executable', join(bin, 'openclaw'), '--', join(bin, 'openclaw'), 'gateway'], {
  encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
});
assert.equal(runtime, 'runtime-ok');
assert.throws(() => execFileSync(process.execPath, [adapter, 'exec', ...common, '--allowed-executable', join(bin, 'openclaw'), '--', '/bin/echo'], { encoding: 'utf8', stdio: 'pipe' }), /exactly match/);
writeFileSync(join(bin, 'get-secret'), '#!/bin/sh\nexit 1\n');
chmodSync(join(bin, 'get-secret'), 0o700);
assert.throws(() => execFileSync(process.execPath, [adapter, 'exec', ...common, '--allowed-executable', join(bin, 'openclaw'), '--', join(bin, 'openclaw')], {
  encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdio: 'pipe',
}), /unable to resolve CF_ACCESS_MCP_AUTOMATION_CLIENT_ID/);

console.log('openclaw MCP automation adapter: ok');
