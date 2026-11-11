#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const terminal = new Set(['PASS', 'FAIL', 'SKIP', 'BLOCKED', 'UNVERIFIED']);

export function classifyResult(exitCode, output, timedOut = false) {
  if (timedOut || exitCode !== 0) return 'FAIL';
  const signals = output.split(/\r?\n/).map((line) => line.match(/^\s*(PASS|SKIP|BLOCKED|UNVERIFIED)\b/)?.[1]).filter(Boolean);
  if (signals.includes('PASS')) return 'PASS';
  for (const status of ['BLOCKED', 'UNVERIFIED', 'SKIP']) if (signals.includes(status)) return status;
  return 'PASS';
}

function safeName(index, file) {
  return `${String(index + 1).padStart(3, '0')}-${basename(file).replace(/[^a-zA-Z0-9_.-]/g, '_')}.log`;
}

async function execute(suite, timeoutMs, logPath, env) {
  const started = Date.now();
  const detached = process.platform !== 'win32';
  const child = spawn('bash', [suite.file], { cwd: root, env, detached, stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  child.stdout.on('data', (chunk) => chunks.push(chunk));
  child.stderr.on('data', (chunk) => chunks.push(chunk));
  let timedOut = false;
  const signal = (name) => {
    try { detached ? process.kill(-child.pid, name) : child.kill(name); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  let killTimer;
  const timer = setTimeout(() => { timedOut = true; signal('SIGTERM'); killTimer = setTimeout(() => signal('SIGKILL'), 2_000); killTimer.unref(); }, timeoutMs);
  const exitCode = await new Promise((resolveExit) => child.once('close', (code) => resolveExit(code ?? 1)));
  clearTimeout(timer);
  if (killTimer) clearTimeout(killTimer);
  const output = Buffer.concat(chunks).toString('utf8');
  await writeFile(logPath, output);
  return { ...suite, status: classifyResult(exitCode, output, timedOut), exitCode, timedOut, durationMs: Date.now() - started, logPath };
}

export async function runHarness({ files, config, logDir, env = process.env }) {
  const ordered = [...files].map((file) => resolve(file)).sort((a, b) => basename(a).localeCompare(basename(b)));
  await rm(logDir, { recursive: true, force: true });
  await mkdir(logDir, { recursive: true });
  const excluded = new Map(Object.entries(config.excluded ?? {}));
  const serial = new Set(config.serial ?? []);
  const suites = ordered.map((file, index) => ({ file, index, name: basename(file), mode: serial.has(basename(file)) ? 'serial' : 'parallel' }));
  const results = [];
  for (const suite of suites.filter(({ name }) => excluded.has(name))) {
    const logPath = join(logDir, safeName(suite.index, suite.file));
    const reason = excluded.get(suite.name);
    await writeFile(logPath, `SKIP ${suite.name}: ${reason}\n`);
    results.push({ ...suite, status: 'SKIP', reason, exitCode: 0, timedOut: false, durationMs: 0, logPath });
  }
  const runnable = suites.filter(({ name }) => !excluded.has(name));
  const deadline = Date.now() + config.budgetMs;
  const runOne = async (suite) => {
    if (Date.now() >= deadline) {
      const logPath = join(logDir, safeName(suite.index, suite.file));
      await writeFile(logPath, `BLOCKED ${suite.name}: routine budget exhausted before start\n`);
      return { ...suite, status: 'BLOCKED', reason: 'routine budget exhausted before start', exitCode: null, timedOut: false, durationMs: 0, logPath };
    }
    const remaining = deadline - Date.now();
    return execute(suite, Math.max(1, Math.min(config.suiteTimeoutMs, remaining)), join(logDir, safeName(suite.index, suite.file)), env);
  };
  const parallel = runnable.filter(({ mode }) => mode === 'parallel');
  let cursor = 0;
  const workers = Array.from({ length: Math.min(config.maxParallel, parallel.length) }, async () => {
    while (cursor < parallel.length) { const suite = parallel[cursor++]; results.push(await runOne(suite)); }
  });
  await Promise.all(workers);
  for (const suite of runnable.filter(({ mode }) => mode === 'serial')) results.push(await runOne(suite));
  results.sort((a, b) => a.index - b.index);
  const counts = Object.fromEntries([...terminal].map((status) => [status, results.filter((row) => row.status === status).length]));
  const budgetExceeded = results.some(({ reason, timedOut }) => timedOut || reason === 'routine budget exhausted before start');
  const report = { schemaVersion: 1, budgetMs: config.budgetMs, suiteTimeoutMs: config.suiteTimeoutMs, counts, budgetExceeded,
    results: results.map(({ file, name, mode, status, exitCode, timedOut, durationMs, logPath, reason }) => ({ file, name, mode, status, exitCode, timedOut, durationMs, logPath, ...(reason ? { reason } : {}) })) };
  await writeFile(join(logDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function main() {
  const configPath = process.env.TEST_ALL_CONFIG ? resolve(process.env.TEST_ALL_CONFIG) : join(root, 'config/routine-test-harness.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const logDir = process.env.TEST_ALL_LOG_DIR ? resolve(process.env.TEST_ALL_LOG_DIR) : join(root, 'artifacts/test-all', `${Date.now()}-${process.pid}`);
  const report = await runHarness({ files: process.argv.slice(2), config, logDir });
  for (const row of report.results) {
    console.log(`${row.status} ${row.name} [${row.mode}] ${row.durationMs}ms — ${row.logPath}${row.reason ? ` (${row.reason})` : ''}`);
    if (row.status === 'FAIL') {
      const output = await readFile(row.logPath, 'utf8');
      console.error(output.split(/\r?\n/).slice(-80).join('\n'));
    }
  }
  console.log(`SUMMARY ${Object.entries(report.counts).map(([key, value]) => `${key}=${value}`).join(' ')} logs=${logDir}`);
  process.exitCode = report.counts.FAIL > 0 || report.budgetExceeded ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`FAIL test harness: ${error.stack ?? error}`); process.exitCode = 1; });
