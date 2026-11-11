#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyResult, runHarness } from './run-routine-test-harness.mjs';

const temp = await mkdtemp(join(tmpdir(), 'routine-harness-'));
const make = async (name, body) => { const path = join(temp, name); await writeFile(path, `#!/usr/bin/env bash\n${body}\n`); await chmod(path, 0o755); return path; };
const pass = await make('a-pass.sh', 'sleep .15; echo "PASS fixture"');
const skip = await make('b-skip.sh', 'echo "SKIP fixture unavailable"');
const blocked = await make('c-blocked.sh', 'echo "BLOCKED fixture authorization"');
const unverified = await make('d-unverified.sh', 'echo "UNVERIFIED fixture receipt"');
const fail = await make('e-fail.sh', 'echo "failure detail"; exit 7');
const timeout = await make('f-timeout.sh', 'sleep 2');
const serialA = await make('g-serial-a.sh', 'if ! mkdir "$LOCK_DIR" 2>/dev/null; then exit 9; fi; sleep .08; rmdir "$LOCK_DIR"; echo PASS');
const serialB = await make('h-serial-b.sh', 'if ! mkdir "$LOCK_DIR" 2>/dev/null; then exit 9; fi; sleep .08; rmdir "$LOCK_DIR"; echo PASS');
const excluded = await make('z-platform.sh', 'exit 99');
const logDir = join(temp, 'logs');
const report = await runHarness({ files: [excluded, serialB, fail, timeout, unverified, pass, serialA, blocked, skip], logDir,
  env: { ...process.env, LOCK_DIR: join(temp, 'lock') }, config: { budgetMs: 2_000, suiteTimeoutMs: 250, maxParallel: 4,
    excluded: { 'z-platform.sh': 'platform harness fixture' }, serial: ['g-serial-a.sh', 'h-serial-b.sh'] } });

assert.deepEqual(report.counts, { PASS: 3, FAIL: 2, SKIP: 2, BLOCKED: 1, UNVERIFIED: 1 });
assert.equal(report.results.find(({ name }) => name === 'e-fail.sh').exitCode, 7);
assert.equal(report.results.find(({ name }) => name === 'f-timeout.sh').timedOut, true);
assert.equal(report.results.find(({ name }) => name === 'z-platform.sh').status, 'SKIP');
assert.deepEqual(report.results.map(({ name }) => name), [...report.results.map(({ name }) => name)].sort());
assert.match(await readFile(join(logDir, '005-e-fail.sh.log'), 'utf8'), /failure detail/);
assert.equal(classifyResult(0, 'SKIP only'), 'SKIP');
assert.equal(classifyResult(0, 'PASS one\nSKIP optional'), 'PASS');
assert.equal(classifyResult(1, 'SKIP misleading'), 'FAIL');
console.log('PASS routine harness parallel, serial, timeout, exclusion, log, ordering, and status contracts');
