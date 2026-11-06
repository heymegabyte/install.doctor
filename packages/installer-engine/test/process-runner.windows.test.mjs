import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runProcess } from '../dist/index.js';

const windowsOnly = { skip: process.platform !== 'win32' };

test('Windows timeout removes the parent and its grandchild before settling', windowsOnly, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'install-doctor-windows-tree-'));
  const heartbeat = join(directory, 'heartbeat');
  const grandchildPidFile = join(directory, 'grandchild.pid');
  const parent = join(directory, 'parent.mjs');
  const grandchildSource = `
    const fs = require('node:fs');
    setInterval(() => fs.appendFileSync(${JSON.stringify(heartbeat)}, 'x'), 20);
  `;
  await writeFile(parent, `
    import { spawn } from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildSource)}], {
      stdio: 'ignore',
      windowsHide: true,
    });
    if (grandchild.pid === undefined) throw new Error('grandchild did not start');
    writeFileSync(${JSON.stringify(grandchildPidFile)}, String(grandchild.pid));
    setInterval(() => {}, 1_000);
  `, { mode: 0o600 });

  await assert.rejects(
    runProcess({
      argv: [process.execPath, parent],
      cwd: directory,
      env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' },
      timeoutMs: 500,
      terminationGraceMs: 100,
    }),
    /operation timeout after process-tree cleanup/,
  );

  const grandchildPid = Number.parseInt(await readFile(grandchildPidFile, 'utf8'), 10);
  assert.ok(Number.isSafeInteger(grandchildPid) && grandchildPid > 0, 'fixture must record a valid grandchild PID');
  assert.throws(() => process.kill(grandchildPid, 0), 'grandchild must be absent when timeout settles');
  const before = (await readFile(heartbeat, 'utf8').catch(() => '')).length;
  await new Promise(resolve => setTimeout(resolve, 150));
  const after = (await readFile(heartbeat, 'utf8').catch(() => '')).length;
  assert.equal(after, before, 'grandchild continued writing after Windows tree cleanup');
});
