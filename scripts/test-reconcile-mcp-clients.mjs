import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyTransaction, loadPinnedProfiles, rollbackTransaction } from './mcp-host-manifest-consumer.mjs';
import { buildClientPlan, renderClient, selectProfile, verifyInstalledPlan } from './reconcile-mcp-clients.mjs';

const root = join(new URL('..', import.meta.url).pathname);
const loaded = await loadPinnedProfiles({
  pinPath: join(root, 'config/mcp-portals/canonical-pin.json'),
  sourceDirectory: join(root, 'config/mcp-portals/canonical-profiles'),
  hostClass: 'macos-workstation',
});
const human = selectProfile(loaded, 'human');
const automation = selectProfile(loaded, 'automation');
assert.equal(human.id, 'macos-human');
assert.equal(human.remote.managedName, 'megabyte-primary');
assert.equal(automation.id, 'macos-automation');
assert.equal(automation.remote.managedName, 'megabyte-automation');

const fixtures = {
  codex: '# keep\n[mcp_servers.local]\ncommand = "local"\n',
  'claude-code': '{"other":"keep","projects":{"nested":{"mcpServers":{"project-local":{"command":"nested"}}}},"mcpServers":{"local":{"command":"local"}}}\n',
  'claude-desktop': '{"preferences":{"keep":true}}\n',
  cursor: '{\n  "mcpServers": {"cua-driver": {"command": "cua"}}\n}\n',
  opencode: '{\n  // keep this comment\n  "mcp": {\n    "local": {"type":"local","command":["local"]}\n  },\n  "tools": {"keep": true}\n}\n',
};
for (const [kind, source] of Object.entries(fixtures)) {
  const rendered = renderClient({ kind, source, profile: human });
  assert.equal(rendered.changed, true);
  assert.match(rendered.content, /megabyte-primary/);
  assert.doesNotMatch(rendered.content, /megabyte-automation/);
  assert.ok(rendered.preservedNames.includes(kind === 'cursor' ? 'cua-driver' : kind === 'claude-desktop' ? undefined : 'local') || kind === 'claude-desktop');
  if (kind === 'opencode') assert.match(rendered.content, /\/\/ keep this comment/);
  const repeated = renderClient({ kind, source: rendered.content, profile: human });
  assert.equal(repeated.changed, false);
  assert.equal(repeated.content, rendered.content);
}

assert.throws(() => renderClient({ kind: 'cursor', source: '{"mcpServers":{"megabyte-primary":{"url":"https://foreign.invalid"}}}', profile: human }), /collision/);
assert.throws(() => renderClient({ kind: 'opencode', source: '{/* unterminated', profile: human }), /unterminated|valid JSON/);

const temp = mkdtempSync(join(tmpdir(), 'reconcile-mcp-clients-'));
const clients = Object.entries(fixtures).map(([kind, source]) => {
  const path = join(temp, `${kind}.${kind === 'codex' ? 'toml' : 'json'}`);
  writeFileSync(path, source);
  return { kind, path };
});
const plan = buildClientPlan({ clients, loaded, callerClass: 'human' });
assert.equal(plan.outputs.length, 5);
assert.ok(plan.outputs.every(output => output.changed));
assert.ok(plan.outputs.every(output => output.content.includes('megabyte-primary') && !output.content.includes('megabyte-automation')));
const receiptPath = join(temp, 'receipt.json');
const createdCursor = join(temp, 'created', 'cursor.json');
const creationPlan = buildClientPlan({ clients: [{ kind: 'cursor', path: createdCursor }], loaded, callerClass: 'human' });
assert.equal(creationPlan.outputs[0].existed, false);
assert.equal(creationPlan.outputs[0].existingDigest, null);
applyTransaction({ outputs: creationPlan.outputs.map(({ path, content }) => ({ path, content })), receiptPath: join(temp, 'creation-receipt.json'), operation: 'reconcile-mcp-clients' });
assert.equal(statSync(createdCursor).mode & 0o777, 0o600);

applyTransaction({ outputs: plan.outputs.map(({ path, content }) => ({ path, content })), receiptPath, operation: 'reconcile-mcp-clients' });
verifyInstalledPlan(plan);
for (const { path } of clients) assert.equal(statSync(path).mode & 0o777, 0o600);
assert.equal(statSync(receiptPath).mode & 0o777, 0o600);
assert.equal(readFileSync(receiptPath, 'utf8').includes('megabyte-primary'), false);
assert.equal(JSON.parse(readFileSync(receiptPath, 'utf8')).operation, 'reconcile-mcp-clients');
rollbackTransaction(receiptPath);
for (const [index, source] of Object.values(fixtures).entries()) assert.equal(readFileSync(clients[index].path, 'utf8'), source);

const automationPlan = buildClientPlan({ clients, loaded, callerClass: 'automation' });
assert.ok(automationPlan.outputs.every(output => output.content.includes('megabyte-automation') && !output.content.includes('megabyte-primary')));

console.log('mcp client reconciliation: ok');
