import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { open, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInheritedSecretFdBroker } from '../dist/index.js';

test('rejects regular files, stdio descriptors, oversized bounds, and unknown purposes', async () => {
  const path = join(tmpdir(), `install-doctor-secret-fd-${process.pid}-${Date.now()}`);
  await writeFile(path, 'not a secret transport', { mode: 0o600 });
  const handle = await open(path, 'r');
  try {
    assert.throws(
      () => createInheritedSecretFdBroker({ fd: handle.fd, purpose: 'sudo-password', maxBytes: 1_024 }),
      /anonymous pipe or socket/,
    );
    assert.throws(() => createInheritedSecretFdBroker({ fd: 0, purpose: 'sudo-password', maxBytes: 1_024 }));
    assert.throws(() => createInheritedSecretFdBroker({ fd: handle.fd, purpose: 'sudo-password', maxBytes: 4_097 }));
    assert.throws(() => createInheritedSecretFdBroker({ fd: handle.fd, purpose: 'other', maxBytes: 1_024 }));
  } finally {
    await handle.close();
    await unlink(path);
  }
});

test('admits an inherited anonymous pipe as a one-shot capability without reading its bytes', { skip: process.platform === 'win32' }, async () => {
  const moduleUrl = new URL('../dist/index.js', import.meta.url).href;
  const program = `
    import { createInheritedSecretFdBroker } from ${JSON.stringify(moduleUrl)};
    const broker = createInheritedSecretFdBroker({ fd: 3, purpose: 'sudo-password', maxBytes: 1024 });
    const result = { purpose: broker.purpose, maxBytes: broker.maxBytes, sourceFd: broker.claimSourceFd() };
    let replayRejected = false;
    try { broker.claimSourceFd(); } catch { replayRejected = true; }
    process.stdout.write(JSON.stringify({ ...result, replayRejected }));
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program], {
    env: { PATH: process.env.PATH ?? '' },
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  let pipeError;
  child.stdout.on('data', chunk => stdout.push(chunk));
  child.stderr.on('data', chunk => stderr.push(chunk));
  // The child intentionally proves that admission does not read the secret
  // bytes. Linux may therefore reset the parent side while it is being closed;
  // that expected transport result must not become an unhandled test error.
  child.stdio[3].on('error', error => {
    if (error.code !== 'ECONNRESET' && error.code !== 'EPIPE') pipeError = error;
  });
  child.stdio[3].end('value-that-must-not-be-read');
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.ifError(pipeError);
  assert.equal(code, 0, Buffer.concat(stderr).toString('utf8'));
  assert.deepEqual(JSON.parse(Buffer.concat(stdout).toString('utf8')), {
    purpose: 'sudo-password', maxBytes: 1_024, sourceFd: 3, replayRejected: true,
  });
});
