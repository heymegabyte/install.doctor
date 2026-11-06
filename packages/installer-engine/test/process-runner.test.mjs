import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runProcess } from '../dist/index.js';

test('timeout terminates an entire POSIX process group with bounded escalation', { skip: process.platform === 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'install-doctor-process-tree-'));
  const heartbeat = join(directory, 'heartbeat');
  const child = join(directory, 'child.mjs');
  await writeFile(child, `
    import { spawn } from 'node:child_process';
    process.on('SIGTERM', () => {});
    spawn(process.execPath, ['-e', ${JSON.stringify(`
      const fs = require('node:fs');
      process.on('SIGTERM', () => {});
      setInterval(() => fs.appendFileSync(${JSON.stringify(heartbeat)}, 'x'), 20);
    `)}], { stdio: 'ignore' });
    setInterval(() => {}, 1000);
  `, { mode: 0o600 });
  const started = Date.now();
  await assert.rejects(
    runProcess({ argv: [process.execPath, child], cwd: directory, env: { PATH: process.env.PATH ?? '' }, timeoutMs: 200, terminationGraceMs: 100 }),
    /operation timeout after process-tree cleanup/,
  );
  assert.ok(Date.now() - started < 2_000, 'termination escalation exceeded its bound');
  const before = (await readFile(heartbeat, 'utf8').catch(() => '')).length;
  await new Promise(resolve => setTimeout(resolve, 150));
  const after = (await readFile(heartbeat, 'utf8').catch(() => '')).length;
  assert.equal(after, before, 'grandchild continued writing after timeout cleanup');
});

test('cancellation waits for a TERM-ignoring descendant after its leader exits', { skip: process.platform === 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'install-doctor-cancel-tree-'));
  const heartbeat = join(directory, 'heartbeat');
  const ready = join(directory, 'ready');
  const leader = join(directory, 'leader.mjs');
  await writeFile(leader, `
    import { spawn } from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    process.on('SIGTERM', () => process.exit(0));
    spawn(process.execPath, ['-e', ${JSON.stringify(`
      const fs = require('node:fs');
      process.on('SIGTERM', () => {});
      fs.writeFileSync(${JSON.stringify(ready)}, 'ready');
      setInterval(() => fs.appendFileSync(${JSON.stringify(heartbeat)}, 'x'), 20);
    `)}], { stdio: 'ignore' });
    setInterval(() => {}, 1000);
  `, { mode: 0o600 });

  const controller = new AbortController();
  const operation = runProcess({
    argv: [process.execPath, leader], cwd: directory, env: { PATH: process.env.PATH ?? '' },
    timeoutMs: 5_000, terminationGraceMs: 100, signal: controller.signal,
  });
  const readyDeadline = Date.now() + 2_000;
  while (!(await readFile(ready, 'utf8').catch(() => ''))) {
    assert.ok(Date.now() < readyDeadline, 'grandchild did not become ready');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  controller.abort();
  await assert.rejects(operation, /operation cancelled after process-tree cleanup/);
  const before = (await readFile(heartbeat, 'utf8').catch(() => '')).length;
  await new Promise(resolve => setTimeout(resolve, 150));
  const after = (await readFile(heartbeat, 'utf8').catch(() => '')).length;
  assert.equal(after, before, 'TERM-ignoring grandchild survived cancellation settlement');
});

test('process output is stream-redacted before callbacks observe split or multiline secrets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'install-doctor-redacted-output-'));
  const child = join(directory, 'output.mjs');
  await writeFile(child, `
    const fragments = [
      'token=super', 'secretvalue\\n',
      '-----BEGIN OPENSSH PRIVATE KEY-----\\r\\n',
      'private-body-that-must-not-escape\\r\\n',
      '-----END OPENSSH PRIVATE KEY-----\\r\\n',
      'after\\n',
    ];
    for (const fragment of fragments) process.stdout.write(fragment);
  `, { mode: 0o600 });
  const lines = [];
  const code = await runProcess({
    argv: [process.execPath, child], cwd: directory, env: { PATH: process.env.PATH ?? '' },
    timeoutMs: 2_000, onOutput: (stream, line) => lines.push(`${stream}:${line}`),
  });
  assert.equal(code, 0);
  const output = lines.join('\n');
  assert.equal(output.includes('supersecretvalue'), false);
  assert.equal(output.includes('private-body-that-must-not-escape'), false);
  assert.equal(output.includes('PRIVATE KEY'), false);
  assert.match(output, /token=\[REDACTED\]/);
  assert.match(output, /\[REDACTED\]/);
  assert.match(output, /after/);
});
