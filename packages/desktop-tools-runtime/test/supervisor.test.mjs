import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { PROVISIONING_PROMPT, PROVISIONING_PROMPT_VERSION, approvedSkills, approvedTools, generateOpenCodeConfig, main, minimalEnvironment, prepareProvisioningPrompt } from '../src/desktop-tools-supervisor.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)]));
  return value;
}
function octal(value, length) { return `${value.toString(8).padStart(length - 1, '0')}\0`; }
function tarEntry(name, bytes, mode) {
  const header = Buffer.alloc(512); header.write(name, 0, 100); header.write(octal(mode, 8), 100, 8, 'ascii');
  header.write(octal(0, 8), 108, 8, 'ascii'); header.write(octal(0, 8), 116, 8, 'ascii'); header.write(octal(bytes.length, 12), 124, 12, 'ascii');
  header.write(octal(0, 12), 136, 12, 'ascii'); header.fill(0x20, 148, 156); header[156] = 0x30;
  header.write('ustar\0', 257, 6, 'ascii'); header.write('00', 263, 2, 'ascii');
  header.write(`${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)]);
}

async function writePromptContext(root, toolContextDigest) {
  const unsigned = {
    schemaVersion: 1,
    promptVersion: PROVISIONING_PROMPT_VERSION,
    promptDigest: createHash('sha256').update(PROVISIONING_PROMPT).digest('hex'),
    profile: { id: 'profile-1', revision: 'revision-7', digest: '1'.repeat(64) },
    release: { id: 'release-1', version: '2.2.5', digest: '2'.repeat(64) },
    discoveredFacts: { arch: 'x64', platform: 'linux' },
    policy: { concurrency: 2, network: false, toolContextDigest },
    capabilities: ['configuration.read', 'packages.plan'],
    permittedTools: ['desktop_tools_discover', 'desktop_tools_plan'],
  };
  const context = { ...unsigned, contextDigest: createHash('sha256').update(`${JSON.stringify(canonical(unsigned))}\n`).digest('hex') };
  const path = join(root, 'provisioning-context.json');
  await writeFile(path, `${JSON.stringify(context)}\n`, { mode: 0o600 });
  return { context, path };
}

async function writeSessionContext(root, overrides = {}) {
  const context = {
    schemaVersion: 1,
    sessionId: 'session-1',
    runId: 'run-1',
    parentSessionId: null,
    parentRunId: null,
    createdAt: '2026-11-08T12:00:00.000Z',
    machine: { id: 'machine-1', fingerprint: '3'.repeat(64) },
    actor: { id: 'actor-1' },
    authorization: { id: 'authorization-1', scopes: ['profile:read', 'session:create'], expiresAt: '2026-11-08T12:10:00.000Z' },
    ...overrides,
  };
  const path = join(root, `session-context-${context.sessionId}.json`);
  await writeFile(path, `${JSON.stringify(context)}\n`, { mode: 0o600 });
  return { context, path };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'desktop-tools-runtime-'));
  const runtime = join(root, 'opencode');
  await writeFile(runtime, '#!/bin/sh\nif [ "$1" = --version ]; then printf "opencode 2.2.5\\n"; exit 0; fi\nprintf "%s\\n" "$@" >"$DESKTOP_TOOLS_STATE_DIR/argv"\nprintf "%s\\n" "${API_TOKEN-unset}" >"$DESKTOP_TOOLS_STATE_DIR/secret"\nprintf "%s\\n" "$OPENCODE_SERVER_USERNAME" >"$DESKTOP_TOOLS_STATE_DIR/username"\ntest -n "$OPENCODE_SERVER_PASSWORD" && printf present >"$DESKTOP_TOOLS_STATE_DIR/password-present"\ntest -f "$DESKTOP_TOOLS_PROMPT_EVIDENCE" && printf "%s\\n%s\\n%s\\n" "$DESKTOP_TOOLS_PROMPT_VERSION" "$DESKTOP_TOOLS_PROMPT_DIGEST" "$DESKTOP_TOOLS_CONTEXT_DIGEST" >"$DESKTOP_TOOLS_STATE_DIR/prompt-binding"\nprintf "%s\\n" "$OPENCODE_CONFIG_CONTENT" >"$DESKTOP_TOOLS_STATE_DIR/opencode-config"\n', { mode: 0o700 });
  await chmod(runtime, 0o700);
  const sha256 = createHash('sha256').update(await readFile(runtime)).digest('hex');
  const state = join(root, 'state');
  await mkdir(join(state, 'config'), { recursive: true, mode: 0o700 });
  await writeFile(join(state, 'config', 'inference-token'), 'scoped-test-token-abcdefghijklmnopqrstuvwxyz\n', { mode: 0o600 });
  const session = await writeSessionContext(root);
  const engine = join(root, 'desktop-tools-engine.mjs');
  await writeFile(engine, '#!/usr/bin/env node\n', { mode: 0o700 });
  const engineSha256 = createHash('sha256').update(await readFile(engine)).digest('hex');
  const toolsArchive = join(root, 'desktop-tools-tools.tar.gz');
  await writeFile(toolsArchive, gzipSync(Buffer.concat([
    tarEntry('contracts/runtime-policy.json', Buffer.from('{}\n'), 0o600),
    tarEntry('contracts/supervisor-api.schema.json', Buffer.from('{}\n'), 0o600),
    tarEntry('contracts/typed-tools.json', Buffer.from('{}\n'), 0o600),
    tarEntry('bin/desktop-tools-mcp-server.mjs', Buffer.from('#!/usr/bin/env node\n'), 0o700), Buffer.alloc(1024),
  ]), { mtime: 0 }));
  const toolsSha256 = createHash('sha256').update(await readFile(toolsArchive)).digest('hex');
  const toolContext = join(root, 'tool-context.json');
  await writeFile(toolContext, `${JSON.stringify({ schemaVersion: 1, sessionId: session.context.sessionId, runId: session.context.runId,
    releaseId: 'release-1', releaseDigest: '2'.repeat(64), profileRevision: 'revision-7', profileDigest: '1'.repeat(64),
    facts: {}, desiredState: {}, plan: {}, operations: {} })}\n`, { mode: 0o600 });
  const toolContextDigest = createHash('sha256').update(await readFile(toolContext)).digest('hex');
  const prompt = await writePromptContext(root, toolContextDigest);
  const toolArgs = ['--engine', engine, '--engine-sha256', engineSha256, '--tools-archive', toolsArchive, '--tools-sha256', toolsSha256, '--tool-context', toolContext];
  return { root, runtime, sha256, state, prompt, session, toolArgs };
}

test('prepares protected state and validates an exact pinned runtime', async () => {
  const item = await fixture();
  await main(['prepare', '--state-dir', item.state]);
  assert.equal((await stat(item.state)).mode & 0o777, 0o700);
  const result = await main(['validate', '--state-dir', item.state, '--runtime', item.runtime, '--sha256', item.sha256, '--version', '2.2.5']);
  assert.equal(result.runtime, item.runtime);
  await assert.rejects(main(['validate', '--state-dir', item.state, '--runtime', item.runtime, '--sha256', '0'.repeat(64), '--version', '2.2.5']), /digest/);
});

test('run binds only private loopback and strips inherited secret variables', async () => {
  const item = await fixture();
  process.env.API_TOKEN = 'must-not-leak';
  const result = await main(['run', '--state-dir', item.state, '--runtime', item.runtime, '--sha256', item.sha256, '--version', '2.2.5', '--port', '4123', '--provisioning-context', item.prompt.path, '--session-context', item.session.path, ...item.toolArgs]);
  assert.equal(await readFile(join(item.state, 'argv'), 'utf8'), 'serve\n--hostname\n127.0.0.1\n--port\n4123\n');
  assert.equal(await readFile(join(item.state, 'secret'), 'utf8'), 'unset\n');
  assert.equal(await readFile(join(item.state, 'username'), 'utf8'), 'desktop-tools\n');
  assert.equal(await readFile(join(item.state, 'password-present'), 'utf8'), 'present');
  assert.equal(await readFile(join(item.state, 'prompt-binding'), 'utf8'), `${PROVISIONING_PROMPT_VERSION}\n${item.prompt.context.promptDigest}\n${item.prompt.context.contextDigest}\n`);
  const evidencePath = join(item.state, 'history', 'prompt-bindings', `${item.prompt.context.contextDigest}.json`);
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  assert.equal(evidence.state, 'recorded-before-execution');
  assert.equal(evidence.promptDigest, item.prompt.context.promptDigest);
  assert.equal(evidence.contextDigest, item.prompt.context.contextDigest);
  assert.equal((await stat(evidencePath)).mode & 0o777, 0o600);
  const config = JSON.parse(await readFile(join(item.state, 'opencode-config'), 'utf8'));
  assert.equal(config.model, 'projectsites/dynamic/code');
  assert.equal(config.providers.projectsites.settings.apiKey, `{file:${join(item.state, 'config', 'inference-token')}}`);
  assert.equal(config.providers.projectsites.settings.baseURL, 'https://desktop.tools/api/ai/v1');
  assert.equal(config.instructions.length, 1);
  assert.equal(config.mcp['desktop-tools'].type, 'local');
  assert.equal(config.mcp['desktop-tools'].enabled, true);
  assert.equal(config.mcp['desktop-tools'].command[0], '/usr/bin/env');
  assert.ok(config.mcp['desktop-tools'].command.includes('-i'));
  assert.ok(config.mcp['desktop-tools'].command.some(value => /desktop-tools-mcp-server-[a-f0-9]{64}\.mjs$/.test(value)));
  assert.equal(JSON.stringify(config.mcp).includes('scoped-test-token'), false);
  assert.match(config.instructions[0], /config\/prompts\/[a-f0-9]{64}\/provisioning\.md$/);
  assert.deepEqual(config.policies.slice(0, 2), [
    { action: 'provider.use', resource: '*', effect: 'deny' },
    { action: 'provider.use', resource: 'projectsites', effect: 'allow' }
  ]);
  assert.equal(JSON.stringify(config).toLowerCase().includes('litellm'), false);
  assert.equal(JSON.stringify(config).includes('scoped-test-token'), false);
  assert.equal(createHash('sha256').update(await readFile(join(item.state, 'config', 'skills', 'desktop-tools-provisioning', 'SKILL.md'))).digest('hex'), approvedSkills[0].sha256);
  assert.equal((await stat(join(item.state, 'config', 'skills', 'desktop-tools-provisioning', 'SKILL.md'))).mode & 0o777, 0o600);
  assert.equal((await stat(join(item.state, 'config', 'server-password'))).mode & 0o777, 0o600);
  assert.equal(result.evidence.captureComplete, false);
  const history = JSON.parse(await readFile(result.evidence.historyPath, 'utf8'));
  const recording = JSON.parse(await readFile(result.evidence.recordingPath, 'utf8'));
  assert.deepEqual(recording, history);
  assert.equal(history.evidenceState, 'headers-persisted');
  assert.equal(history.captureComplete, false);
  assert.deepEqual(history.profile, item.prompt.context.profile);
  assert.deepEqual(history.machine, item.session.context.machine);
  assert.deepEqual(history.actor, item.session.context.actor);
  assert.deepEqual(history.authorization, item.session.context.authorization);
  assert.deepEqual(history.release, item.prompt.context.release);
  assert.deepEqual(history.prompt, { version: PROVISIONING_PROMPT_VERSION, digest: item.prompt.context.promptDigest, contextDigest: item.prompt.context.contextDigest });
  assert.deepEqual(history.runtime, { version: '2.2.5', digest: item.sha256 });
  assert.deepEqual(history.skills, approvedSkills);
  assert.deepEqual(history.tools, item.prompt.context.permittedTools);
  assert.equal(history.parentSessionId, null);
  assert.equal((await stat(result.evidence.historyPath)).mode & 0o777, 0o600);
  assert.equal((await stat(result.evidence.recordingPath)).mode & 0o777, 0o600);
  delete process.env.API_TOKEN;
});

test('rejects arbitrary options and privileged ports', async () => {
  const item = await fixture();
  await assert.rejects(main(['run', '--shell', '/bin/sh']), /unsupported/);
  await assert.rejects(main(['run', '--state-dir', item.state, '--runtime', item.runtime, '--sha256', item.sha256, '--version', '2.2.5', '--port', '80']), /unprivileged/);
});

test('generates restart-survivable hardened service definitions without secrets', async () => {
  const item = await fixture();
  const output = join(item.root, 'service');
  await main(['service', '--state-dir', item.state, '--runtime', item.runtime, '--sha256', item.sha256, '--version', '2.2.5', '--output-dir', output, '--port', '4444', '--provisioning-context', item.prompt.path, '--session-context', item.session.path, ...item.toolArgs]);
  const unit = await readFile(join(output, 'desktop-tools-supervisor.service'), 'utf8');
  const plist = await readFile(join(output, 'tools.desktop.supervisor.plist'), 'utf8');
  assert.match(unit, /Restart=on-failure/);
  assert.match(unit, /NoNewPrivileges=yes/);
  assert.match(unit, /desktop-tools-supervisor\.mjs/);
  assert.doesNotMatch(unit, /supervisor\.test\.mjs/);
  assert.match(unit, new RegExp(`${item.state.replaceAll('/', '\\/')}\\/runtime\\/opencode-${item.sha256}`));
  assert.match(unit, /--port" "4444"/);
  assert.match(unit, /--provisioning-context/);
  assert.match(unit, /--session-context/);
  assert.match(plist, /<key>KeepAlive<\/key>/);
  assert.match(plist, /<string>127\.0\.0\.1<\/string>|--port/);
  assert.doesNotMatch(`${unit}${plist}`, /API_TOKEN|must-not-leak/);
  assert.equal((await stat(join(output, 'desktop-tools-supervisor.service'))).mode & 0o777, 0o600);
  assert.equal((await stat(join(item.state, 'bin', 'desktop-tools-supervisor.mjs'))).mode & 0o777, 0o700);
  assert.equal((await stat(join(item.state, 'runtime', `opencode-${item.sha256}`))).mode & 0o777, 0o700);
  await assert.rejects(stat(join(output, 'run')), /ENOENT/);
});

test('evidence collision fails closed before OpenCode launch and cannot claim complete capture', async () => {
  const item = await fixture();
  await main(['prepare', '--state-dir', item.state]);
  const recordingPath = join(item.state, 'recordings', `${item.session.context.sessionId}.header.json`);
  await writeFile(recordingPath, '{"captureComplete":true}\n', { mode: 0o600 });
  await assert.rejects(
    main(['run', '--state-dir', item.state, '--runtime', item.runtime, '--sha256', item.sha256, '--version', '2.2.5', '--provisioning-context', item.prompt.path, '--session-context', item.session.path, ...item.toolArgs]),
    /evidence collision/,
  );
  await assert.rejects(readFile(join(item.state, 'argv'), 'utf8'), /ENOENT/);
  const history = JSON.parse(await readFile(join(item.state, 'history', `${item.session.context.sessionId}.json`), 'utf8'));
  assert.equal(history.captureComplete, false);
});

test('session evidence rejects invalid lineage context before OpenCode launch', async () => {
  const item = await fixture();
  const invalid = await writeSessionContext(item.root, { sessionId: 'session-invalid', parentSessionId: '../parent' });
  await assert.rejects(
    main(['run', '--state-dir', item.state, '--runtime', item.runtime, '--sha256', item.sha256, '--version', '2.2.5', '--provisioning-context', item.prompt.path, '--session-context', invalid.path, ...item.toolArgs]),
    /parent session id is invalid/,
  );
  await assert.rejects(readFile(join(item.state, 'argv'), 'utf8'), /ENOENT/);
});

test('tool authority must be the exact closure digest bound into the verified prompt', async () => {
  const item = await fixture();
  const contextPath = item.toolArgs[item.toolArgs.indexOf('--tool-context') + 1];
  const changed = JSON.parse(await readFile(contextPath, 'utf8')); changed.operations = { injected: { argv: ['/bin/sh'] } };
  await writeFile(contextPath, `${JSON.stringify(changed)}\n`, { mode: 0o600 });
  await assert.rejects(
    main(['run', '--state-dir', item.state, '--runtime', item.runtime, '--sha256', item.sha256, '--version', '2.2.5',
      '--provisioning-context', item.prompt.path, '--session-context', item.session.path, ...item.toolArgs]),
    /tool context is not bound/,
  );
  await assert.rejects(readFile(join(item.state, 'argv'), 'utf8'), /ENOENT/);
});

test('minimal environment contains no inherited credential-shaped values', () => {
  process.env.AWS_SECRET_ACCESS_KEY = 'secret';
  process.env.ANTHROPIC_API_KEY = 'ambient-anthropic';
  process.env.DEEPSEEK_API_KEY = 'ambient-deepseek';
  process.env.OPENAI_API_KEY = 'ambient-openai';
  const environment = minimalEnvironment('/tmp/desktop-tools-state');
  assert.equal(environment.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(environment.ANTHROPIC_API_KEY, undefined);
  assert.equal(environment.DEEPSEEK_API_KEY, undefined);
  assert.equal(environment.OPENAI_API_KEY, undefined);
  assert.equal(environment.DESKTOP_TOOLS_STATE_DIR, '/tmp/desktop-tools-state');
  assert.equal(environment.OPENCODE_DISABLE_PROJECT_CONFIG, '1');
  assert.deepEqual(JSON.parse(environment.OPENCODE_CONFIG_CONTENT).permissions, [{ action: '*', resource: '*', effect: 'deny' }]);
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

test('strict config permits only ProjectSites, pinned skills, and task-specific typed tools', () => {
  const credential = '/private/state/config/inference-token';
  const config = generateOpenCodeConfig(credential);
  assert.deepEqual(Object.keys(config.providers), ['projectsites']);
  assert.equal(config.providers.projectsites.settings.apiKey, `{file:${credential}}`);
  assert.ok(config.policies.some(rule => rule.action === 'integration.use' && rule.resource === '*' && rule.effect === 'deny'));
  assert.ok(config.policies.some(rule => rule.action === 'tool.use' && rule.resource === 'external_directory:*' && rule.effect === 'deny'));
  assert.equal(config.policies.some(rule => rule.action === 'websearch.use'), false);
  assert.deepEqual(config.permissions[0], { action: '*', resource: '*', effect: 'deny' });
  assert.equal(config.permissions.some(rule => rule.action === 'websearch' && rule.effect === 'allow'), false);
  for (const action of ['shell', 'edit', 'execute']) {
    assert.ok(config.policies.some(rule => rule.action === 'tool.use' && rule.resource === `${action}:*` && rule.effect === 'deny'));
  }
  assert.deepEqual(config.policies.filter(rule => rule.action === 'skill.use' && rule.effect === 'allow').map(rule => rule.resource), approvedSkills.map(skill => skill.id));
  assert.deepEqual(config.permissions.filter(rule => rule.action.startsWith('desktop_tools_')).map(rule => rule.action), approvedTools);
  assert.equal(config.permissions.some(rule => rule.action === 'shell' && rule.effect === 'allow'), false);
  assert.equal(config.permissions.some(rule => rule.action === 'edit' && rule.effect === 'allow'), false);
});

test('run refuses missing, permissive, and malformed inference credential state', async () => {
  const item = await fixture();
  await rm(join(item.state, 'config', 'inference-token'));
  await assert.rejects(main(['run', '--state-dir', item.state, '--runtime', item.runtime, '--sha256', item.sha256, '--version', '2.2.5', '--provisioning-context', item.prompt.path]), /credential is unavailable/);
  await writeFile(join(item.state, 'config', 'inference-token'), 'scoped-test-token-abcdefghijklmnopqrstuvwxyz\n', { mode: 0o600 });
  await chmod(join(item.state, 'config', 'inference-token'), 0o644);
  await assert.rejects(main(['run', '--state-dir', item.state, '--runtime', item.runtime, '--sha256', item.sha256, '--version', '2.2.5', '--provisioning-context', item.prompt.path]), /credential state is unsafe/);
  await chmod(join(item.state, 'config', 'inference-token'), 0o600);
  await writeFile(join(item.state, 'config', 'inference-token'), 'short\n', { mode: 0o600 });
  await assert.rejects(main(['run', '--state-dir', item.state, '--runtime', item.runtime, '--sha256', item.sha256, '--version', '2.2.5', '--provisioning-context', item.prompt.path]), /credential/);
});

test('rejects tampered, secret-shaped, and over-authorized prompt contexts before execution', async () => {
  const item = await fixture();
  const tampered = { ...item.prompt.context, policy: { network: true } };
  await writeFile(item.prompt.path, JSON.stringify(tampered), { mode: 0o600 });
  await assert.rejects(prepareProvisioningPrompt(item.prompt.path, item.state), /digest mismatch/);
  const secretShaped = { ...item.prompt.context, discoveredFacts: { apiToken: 'must-not-enter-prompt' } };
  const secretUnsigned = { ...secretShaped }; delete secretUnsigned.contextDigest;
  secretShaped.contextDigest = createHash('sha256').update(`${JSON.stringify(canonical(secretUnsigned))}\n`).digest('hex');
  await writeFile(item.prompt.path, JSON.stringify(secretShaped), { mode: 0o600 });
  await assert.rejects(prepareProvisioningPrompt(item.prompt.path, item.state), /secret-shaped/);
  const excessive = { ...item.prompt.context, permittedTools: ['desktop_tools_root_shell'] };
  const excessiveUnsigned = { ...excessive }; delete excessiveUnsigned.contextDigest;
  excessive.contextDigest = createHash('sha256').update(`${JSON.stringify(canonical(excessiveUnsigned))}\n`).digest('hex');
  await writeFile(item.prompt.path, JSON.stringify(excessive), { mode: 0o600 });
  await assert.rejects(prepareProvisioningPrompt(item.prompt.path, item.state), /unapproved tool/);
});
