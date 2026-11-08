import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { approvedSkills, approvedTools, generateOpenCodeConfig, main, minimalEnvironment } from '../src/desktop-tools-supervisor.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'desktop-tools-runtime-'));
  const runtime = join(root, 'opencode');
  await writeFile(runtime, '#!/bin/sh\nif [ "$1" = --version ]; then printf "opencode 2.2.5\\n"; exit 0; fi\nprintf "%s\\n" "$@" >"$DESKTOP_TOOLS_STATE_DIR/argv"\nprintf "%s\\n" "${API_TOKEN-unset}" >"$DESKTOP_TOOLS_STATE_DIR/secret"\nprintf "%s\\n" "$OPENCODE_SERVER_USERNAME" >"$DESKTOP_TOOLS_STATE_DIR/username"\ntest -n "$OPENCODE_SERVER_PASSWORD" && printf present >"$DESKTOP_TOOLS_STATE_DIR/password-present"\nprintf "%s\\n" "$OPENCODE_CONFIG_CONTENT" >"$DESKTOP_TOOLS_STATE_DIR/opencode-config"\n', { mode: 0o700 });
  await chmod(runtime, 0o700);
  const sha256 = createHash('sha256').update(await readFile(runtime)).digest('hex');
  const state = join(root, 'state');
  await mkdir(join(state, 'config'), { recursive: true, mode: 0o700 });
  await writeFile(join(state, 'config', 'inference-token'), 'scoped-test-token-abcdefghijklmnopqrstuvwxyz\n', { mode: 0o600 });
  return { root, runtime, sha256, state };
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
  await main(['run', '--state-dir', item.state, '--runtime', item.runtime, '--sha256', item.sha256, '--version', '2.2.5', '--port', '4123']);
  assert.equal(await readFile(join(item.state, 'argv'), 'utf8'), 'serve\n--hostname\n127.0.0.1\n--port\n4123\n');
  assert.equal(await readFile(join(item.state, 'secret'), 'utf8'), 'unset\n');
  assert.equal(await readFile(join(item.state, 'username'), 'utf8'), 'desktop-tools\n');
  assert.equal(await readFile(join(item.state, 'password-present'), 'utf8'), 'present');
  const config = JSON.parse(await readFile(join(item.state, 'opencode-config'), 'utf8'));
  assert.equal(config.model, 'projectsites/dynamic/code');
  assert.equal(config.providers.projectsites.settings.apiKey, `{file:${join(item.state, 'config', 'inference-token')}}`);
  assert.equal(config.providers.projectsites.settings.baseURL, 'https://desktop.tools/api/ai/v1');
  assert.deepEqual(config.policies.slice(0, 2), [
    { action: 'provider.use', resource: '*', effect: 'deny' },
    { action: 'provider.use', resource: 'projectsites', effect: 'allow' }
  ]);
  assert.equal(JSON.stringify(config).toLowerCase().includes('litellm'), false);
  assert.equal(JSON.stringify(config).includes('scoped-test-token'), false);
  assert.equal(createHash('sha256').update(await readFile(join(item.state, 'config', 'skills', 'desktop-tools-provisioning', 'SKILL.md'))).digest('hex'), approvedSkills[0].sha256);
  assert.equal((await stat(join(item.state, 'config', 'skills', 'desktop-tools-provisioning', 'SKILL.md'))).mode & 0o777, 0o600);
  assert.equal((await stat(join(item.state, 'config', 'server-password'))).mode & 0o777, 0o600);
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
  await main(['service', '--state-dir', item.state, '--runtime', item.runtime, '--sha256', item.sha256, '--version', '2.2.5', '--output-dir', output, '--port', '4444']);
  const unit = await readFile(join(output, 'desktop-tools-supervisor.service'), 'utf8');
  const plist = await readFile(join(output, 'tools.desktop.supervisor.plist'), 'utf8');
  assert.match(unit, /Restart=on-failure/);
  assert.match(unit, /NoNewPrivileges=yes/);
  assert.match(unit, /desktop-tools-supervisor\.mjs/);
  assert.doesNotMatch(unit, /supervisor\.test\.mjs/);
  assert.match(unit, new RegExp(`${item.state.replaceAll('/', '\\/')}\\/runtime\\/opencode-${item.sha256}`));
  assert.match(unit, /--port" "4444"/);
  assert.match(plist, /<key>KeepAlive<\/key>/);
  assert.match(plist, /<string>127\.0\.0\.1<\/string>|--port/);
  assert.doesNotMatch(`${unit}${plist}`, /API_TOKEN|must-not-leak/);
  assert.equal((await stat(join(output, 'desktop-tools-supervisor.service'))).mode & 0o777, 0o600);
  assert.equal((await stat(join(item.state, 'bin', 'desktop-tools-supervisor.mjs'))).mode & 0o777, 0o700);
  assert.equal((await stat(join(item.state, 'runtime', `opencode-${item.sha256}`))).mode & 0o777, 0o700);
  await assert.rejects(stat(join(output, 'run')), /ENOENT/);
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
  await assert.rejects(main(['run', '--state-dir', item.state, '--runtime', item.runtime, '--sha256', item.sha256, '--version', '2.2.5']), /credential is unavailable/);
  await writeFile(join(item.state, 'config', 'inference-token'), 'scoped-test-token-abcdefghijklmnopqrstuvwxyz\n', { mode: 0o600 });
  await chmod(join(item.state, 'config', 'inference-token'), 0o644);
  await assert.rejects(main(['run', '--state-dir', item.state, '--runtime', item.runtime, '--sha256', item.sha256, '--version', '2.2.5']), /credential state is unsafe/);
  await chmod(join(item.state, 'config', 'inference-token'), 0o600);
  await writeFile(join(item.state, 'config', 'inference-token'), 'short\n', { mode: 0o600 });
  await assert.rejects(main(['run', '--state-dir', item.state, '--runtime', item.runtime, '--sha256', item.sha256, '--version', '2.2.5']), /credential/);
});
