import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLaunchdServiceStateAdapter } from '../dist/index.js';

async function fixture(initial) {
  const uid = process.geteuid();
  const root = await realpath(await mkdtemp(join(tmpdir(), 'install-doctor-launchd-')));
  const definitions = join(root, 'Library', 'LaunchAgents');
  await mkdir(definitions, { recursive: true });
  const definitionPath = join(definitions, 'com.install-doctor.fixture.plist');
  await writeFile(definitionPath, '<plist><dict><key>Label</key><string>com.install-doctor.fixture</string></dict></plist>', { mode: 0o600 });
  const state = { ...initial };
  const calls = [];
  const execute = async (file, args) => {
    calls.push([file, ...args]);
    if (file === '/usr/bin/plutil') return args[1] === 'KeepAlive'
      ? { code: 0, stdout: `${state.keepAlive === true}\n` }
      : { code: 0, stdout: 'com.install-doctor.fixture\n' };
    const [verb, ...rest] = args;
    if (verb === 'print-disabled') return { code: 0, stdout: state.override === 'missing'
      ? 'disabled services = {\n}\n'
      : `disabled services = {\n  "com.install-doctor.fixture" => ${state.override === 'disabled'}\n}\n` };
    if (verb === 'print') return state.loaded
      ? { code: 0, stdout: `service = {\n  state = ${state.activity === 'running' ? 'running' : state.activity === 'waiting' ? 'waiting' : 'not running'}\n}\n` }
      : { code: 113, stdout: '', stderr: 'Could not find service' };
    if (verb === 'enable' || verb === 'disable') { state.override = verb === 'enable' ? 'enabled' : 'disabled'; return { code: 0, stdout: '' }; }
    if (verb === 'bootstrap') { state.loaded = true; return { code: 0, stdout: '' }; }
    if (verb === 'bootout') { state.loaded = false; state.activity = 'not-running'; return { code: 0, stdout: '' }; }
    if (verb === 'kickstart') { state.activity = 'running'; return { code: 0, stdout: '' }; }
    if (verb === 'kill' && rest[0] === 'SIGTERM') { state.activity = 'not-running'; return { code: 0, stdout: '' }; }
    throw new Error(`unexpected launchd command: ${args.join(' ')}`);
  };
  return {
    state,
    calls,
    adapter: createLaunchdServiceStateAdapter({
      launchctlPath: '/bin/launchctl',
      plutilPath: '/usr/bin/plutil',
      effectiveUid: uid,
      authorizedUserHome: root,
      authorizedDefinitions: [{ serviceId: 'com.install-doctor.fixture', domain: { kind: 'gui', uid }, definitionPath }],
      execute,
    }),
  };
}

test('launchd adapter captures explicit and default enablement without synthesizing an override', async () => {
  const value = await fixture({ override: 'disabled', loaded: true, activity: 'not-running' });
  const captured = await value.adapter.capture('com.install-doctor.fixture');
  assert.deepEqual({ ...captured, definition: undefined }, {
    domain: { kind: 'gui', uid: process.geteuid() }, definition: undefined,
    enablementOverride: 'disabled', loaded: true, activity: 'not-running',
  });
  const missing = await fixture({ override: 'missing', loaded: false, activity: 'not-running' });
  assert.equal((await missing.adapter.capture('com.install-doctor.fixture')).enablementOverride, 'default');
  const waiting = await fixture({ override: 'enabled', loaded: true, activity: 'waiting' });
  assert.equal((await waiting.adapter.capture('com.install-doctor.fixture')).activity, 'not-running');
});

test('launchd default enablement restores only while no explicit override has appeared', async () => {
  const value = await fixture({ override: 'missing', loaded: true, activity: 'not-running' });
  const target = await value.adapter.capture('com.install-doctor.fixture');
  value.state.loaded = false;
  await value.adapter.restore('com.install-doctor.fixture', target);
  assert.deepEqual(value.state, { override: 'missing', loaded: true, activity: 'not-running' });
  const mutations = value.calls.filter(call => call[0] === '/bin/launchctl' && !['print', 'print-disabled'].includes(call[1])).map(call => call[1]);
  assert.deepEqual(mutations, ['bootstrap']);

  value.state.override = 'disabled'; value.state.loaded = false;
  await assert.rejects(value.adapter.restore('com.install-doctor.fixture', target), /default enablement override changed/);
  assert.equal(value.state.loaded, false);
});

test('launchd adapter restores loaded activity and applies disabled override last', async () => {
  const value = await fixture({ override: 'disabled', loaded: true, activity: 'running' });
  const target = await value.adapter.capture('com.install-doctor.fixture');
  value.state.override = 'disabled'; value.state.loaded = false; value.state.activity = 'not-running';
  await value.adapter.restore('com.install-doctor.fixture', target);
  assert.deepEqual(value.state, { override: 'disabled', loaded: true, activity: 'running' });
  const mutations = value.calls.filter(call => call[0] === '/bin/launchctl' && !['print', 'print-disabled'].includes(call[1])).map(call => call[1]);
  assert.deepEqual(mutations, ['enable', 'bootstrap', 'kickstart', 'disable']);
});

test('launchd adapter rejects unenrolled labels and definition identity drift', async () => {
  const value = await fixture({ override: 'enabled', loaded: true, activity: 'not-running' });
  await assert.rejects(value.adapter.capture('../escape'), /invalid launchd service identifier/);
  await assert.rejects(value.adapter.capture('com.install-doctor.other'), /not enrolled/);
  const captured = await value.adapter.capture('com.install-doctor.fixture');
  await writeFile(captured.definition.canonicalPath, 'changed', { mode: 0o600 });
  await assert.rejects(value.adapter.restore('com.install-doctor.fixture', captured), /definition identity changed/);
});

test('launchd adapter rejects KeepAlive definitions before state can be captured', async () => {
  const value = await fixture({ override: 'enabled', loaded: true, activity: 'running', keepAlive: true });
  await assert.rejects(value.adapter.capture('com.install-doctor.fixture'), /KeepAlive=false/);
});
