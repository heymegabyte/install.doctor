import assert from 'node:assert/strict';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  OfflineSandboxUnavailableError,
  createOfflineSandboxRuntime,
  probeOfflineSandbox,
  runOfflineSandboxedOperation,
} from '../dist/index.js';

test('unsupported platforms refuse before probing or invoking an operation', async t => {
  let probes = 0;
  let executions = 0;
  const runtime = createOfflineSandboxRuntime({
    platform: 'darwin',
    effectiveUserId: 501, effectiveGroupId: 20,
    inspectExecutable: async () => { probes += 1; return { regular: true, symbolicLink: false, uid: 0, mode: 0o755 }; },
    hostNetworkNamespace: async () => 'net:[1]',
    run: async () => { executions += 1; return { exitCode: 0, stdout: 'net:[2]\n', stderr: '' }; },
  });
  const capability = await runtime.probe();
  assert.deepEqual(capability, { supported: false, platform: 'darwin', reason: 'offline execution sandbox is unsupported on darwin' });
  await assert.rejects(runtime.execute({
    materializedRoot: '/tmp/offline', executableFileDescriptor: 3,
    artifactFileDescriptors: [], arguments: [], timeoutMs: 1_000,
  }), OfflineSandboxUnavailableError);
  assert.equal(probes, 0);
  assert.equal(executions, 0);
});

test('Linux capability requires a trusted Bubblewrap binary and a distinct network namespace', async () => {
  const base = {
    platform: 'linux',
    effectiveUserId: 1000, effectiveGroupId: 1000,
    hostNetworkNamespace: async () => 'net:[100]',
    run: async () => ({ exitCode: 0, stdout: 'net:[200]\n', stderr: '' }),
  };
  const insecure = await probeOfflineSandbox({
    ...base,
    inspectExecutable: async () => ({ regular: true, symbolicLink: false, uid: 1000, mode: 0o777 }),
  });
  assert.equal(insecure.supported, false);
  assert.match(insecure.reason, /trusted root-owned/);

  const sameNamespace = await probeOfflineSandbox({
    ...base,
    inspectExecutable: async () => ({ regular: true, symbolicLink: false, uid: 0, mode: 0o755 }),
    run: async () => ({ exitCode: 0, stdout: 'net:[100]\n', stderr: '' }),
  });
  assert.equal(sameNamespace.supported, false);
  assert.match(sameNamespace.reason, /did not isolate/);

  const supported = await probeOfflineSandbox({
    ...base,
    inspectExecutable: async () => ({ regular: true, symbolicLink: false, uid: 0, mode: 0o755 }),
  });
  assert.deepEqual(supported, {
    supported: true, platform: 'linux', kind: 'linux-bubblewrap-network-namespace',
    executablePath: '/usr/bin/bwrap', hostNetworkNamespace: 'net:[100]', isolatedNetworkNamespace: 'net:[200]',
  });
});

test('Linux execution reprobes immediately, contains paths, and invokes only Bubblewrap with unshared networking', async t => {
  const root = await mkdtemp(join(tmpdir(), 'install-doctor-offline-sandbox-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = join(root, 'tool');
  await writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const calls = [];
  const runtime = createOfflineSandboxRuntime({
    platform: 'linux',
    effectiveUserId: 1000, effectiveGroupId: 1000,
    inspectExecutable: async path => path.startsWith('/usr/bin/')
      ? { regular: true, symbolicLink: false, uid: 0, mode: 0o755 }
      : { regular: true, symbolicLink: false, uid: 501, mode: 0o700 },
    hostNetworkNamespace: async () => 'net:[100]',
    run: async request => {
      calls.push(request);
      if (request.purpose === 'probe') return { exitCode: 0, stdout: 'net:[200]\n', stderr: '' };
      return { exitCode: 0, stdout: 'done\n', stderr: '' };
    },
  });
  const executableHandle = await open(executable, 'r');
  t.after(() => executableHandle.close());
  const result = await runtime.execute({
    materializedRoot: root, executableFileDescriptor: executableHandle.fd,
    artifactFileDescriptors: [], arguments: ['safe'], timeoutMs: 1_000,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 2, 'each execution must perform a fresh isolation proof before operation admission');
  assert.equal(calls[1].argv[0], '/usr/bin/bwrap');
  assert.ok(calls[1].argv.includes('--unshare-net'));
  assert.equal(calls[1].argv.includes('--share-net'), false);
  assert.ok(calls[1].argv.includes('--cap-drop'));
  assert.ok(calls[1].argv.includes('ALL'));
  assert.equal(calls[1].argv.includes('--bind'), false);
  assert.ok(calls[1].argv.includes('--ro-bind-data'), 'verified descriptors must be copied without reopening a pathname');
  assert.equal(calls[1].argv.includes('/proc/self/fd/3'), false, 'Bubblewrap closes unclaimed descriptor paths before mount setup');
  assert.equal(calls[1].argv.includes('/'), false, 'host root must never be mounted into the sandbox');
  assert.deepEqual(calls[1].fileDescriptors, [executableHandle.fd]);
  assert.equal(calls[1].argv.includes('--preserve-fds'), false, 'Bubblewrap 0.9 uses descriptor-backed data mounts');
  assert.ok(calls[1].argv.includes('/run/install-doctor/operation'));

  await assert.rejects(runtime.execute({
    materializedRoot: root, executableFileDescriptor: -1, artifactFileDescriptors: [], arguments: [], timeoutMs: 1_000,
  }), /verified file descriptor/);
  assert.equal(calls.length, 2, 'descriptor rejection must happen before another probe or operation');
});

test('Linux user sandbox refuses root and never admits a capability probe', async () => {
  let calls = 0;
  const capability = await probeOfflineSandbox({
    platform: 'linux', effectiveUserId: 0, effectiveGroupId: 0,
    inspectExecutable: async () => ({ regular: true, symbolicLink: false, uid: 0, mode: 0o755 }),
    hostNetworkNamespace: async () => 'net:[1]',
    run: async () => { calls += 1; return { exitCode: 0, stdout: 'net:[2]\n', stderr: '' }; },
  });
  assert.equal(capability.supported, false);
  assert.match(capability.reason, /refuse a root/);
  assert.equal(calls, 0);
});

test('default runtime refuses safely when this host cannot prove Linux namespace isolation', async t => {
  if (process.platform === 'linux') {
    t.skip('covered by the optional real Linux canary when Bubblewrap is available');
    return;
  }
  const root = await mkdtemp(join(tmpdir(), 'install-doctor-offline-default-sandbox-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const marker = join(root, 'marker');
  const executable = join(root, 'tool');
  await writeFile(executable, `#!/bin/sh\nprintf x > ${JSON.stringify(marker)}\n`, { mode: 0o700 });
  await assert.rejects(runOfflineSandboxedOperation({
    materializedRoot: root, executableFileDescriptor: 3, artifactFileDescriptors: [], arguments: [], timeoutMs: 1_000,
  }), OfflineSandboxUnavailableError);
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
});

test('real Linux Bubblewrap adapter proves a distinct namespace before execution', { skip: process.platform !== 'linux' }, async t => {
  const capability = await probeOfflineSandbox();
  if (!capability.supported) {
    if (process.env.INSTALL_DOCTOR_REQUIRE_REAL_OFFLINE_SANDBOX === '1') {
      assert.fail(`required real offline sandbox is unavailable: ${capability.reason}`);
    }
    t.skip(capability.reason);
    return;
  }
  const root = await mkdtemp(join(tmpdir(), 'install-doctor-offline-linux-canary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = join(root, 'verify-namespace');
  await writeFile(executable, `#!/bin/sh
set -eu
child="$(/usr/bin/readlink /proc/self/ns/net)"
[ "$child" != "$1" ]
`, { mode: 0o700 });
  const handle = await open(executable, 'r');
  t.after(() => handle.close());
  const result = await runOfflineSandboxedOperation({
    materializedRoot: root, executableFileDescriptor: handle.fd, artifactFileDescriptors: [],
    arguments: [capability.hostNetworkNamespace], timeoutMs: 5_000,
  });
  assert.equal(result.exitCode, 0, `offline sandbox operation failed: ${result.stderr}`);
});
