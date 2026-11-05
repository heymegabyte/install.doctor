#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const requestedPasses = Number.parseInt(process.env.CONVERGENCE_PASSES || '10', 10);
if (!Number.isFinite(requestedPasses) || requestedPasses < 10) {
  throw new Error('CONVERGENCE_PASSES must be an integer greater than or equal to 10');
}
const passes = requestedPasses;
const receiptDir = resolve(root, '.agent', 'prompt-convergence-passes');
const models = (process.env.CONVERGENCE_MODELS || 'litellm/deepseek-v4-pro,litellm/deepseek-flash,litellm/deepseek-v3.2')
  .split(',').map((model) => model.trim()).filter(Boolean);
mkdirSync(receiptDir, { recursive: true });
const lockPath = resolve(root, '.agent', 'prompt-convergence.lock');
const runPath = resolve(receiptDir, 'run.json');
let lockFd;
if (existsSync(lockPath)) {
  let owner = 0;
  try { owner = JSON.parse(readFileSync(lockPath, 'utf8')).pid; } catch { owner = 0; }
  let alive = false;
  if (Number.isInteger(owner) && owner > 0) {
    try { process.kill(owner, 0); alive = true; } catch { alive = false; }
  }
  if (alive) throw new Error(`another convergence runner (pid ${owner}) owns ${lockPath}`);
  unlinkSync(lockPath);
}
try {
  lockFd = openSync(lockPath, 'wx', 0o600);
  writeFileSync(lockFd, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
} catch (error) {
  throw new Error(`another convergence runner owns ${lockPath}`, { cause: error });
}

const hash = (value) => createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
const stateHash = () => hash(`${git('status', '--porcelain=v2', '-z')}\0${git('diff', '--binary')}`);
const run = existsSync(runPath)
  ? JSON.parse(readFileSync(runPath, 'utf8'))
  : {
      schemaVersion: 1,
      runId: randomUUID(),
      startedAt: new Date().toISOString(),
      baselineHead: git('rev-parse', 'HEAD').trim(),
      baselineStateHash: stateHash(),
      requiredPasses: passes,
    };
if (run.requiredPasses !== passes) throw new Error('existing run has a different requiredPasses value');
if (!existsSync(runPath)) writeReceipt(runPath, run);

function writeReceipt(path, receipt) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

function compactOutput(stdout = '') {
  const text = [];
  const errors = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === 'text' && event.part?.type === 'text' && event.part.text) text.push(event.part.text);
      if (event.type === 'error') errors.push(event.error?.data?.message || event.error?.name || 'unknown error');
    } catch {
      if (line.length < 2_000) text.push(line);
    }
  }
  return { text: text.join('\n').slice(-32_000), errors: [...new Set(errors)].slice(-20) };
}

const invariant = `You are one pass in an evidence-gated repository convergence loop for install.doctor.
Read AGENTS.md, CLAUDE.md, CODEX.md, the active openspec/changes/repository-wide-convergence artifacts,
docs/aid/MASTER-PROMPT.md, docs/aid/CURRENT-STATE.md, docs/aid/NEXT-STEPS.md, prompts/, and
.agent/swarm-audits/prompt-convergence.json when present. Reconcile all durable user prompts and the current
dirty worktree. Find the single highest-value NEW improvement not already implemented, then implement it with
tests. Prefer deletion, integration, truthful failure propagation, source-of-truth consolidation, security,
and reproducibility. Preserve unrelated edits. Never deploy, commit, rewrite Git history, uninstall software,
contact fleet hosts, mutate running services, expose secrets, remove user data, or implement a Figma-gated
visual redesign. Public API removals require the repository deprecation cadence. Stateful migrations require
preservation and executable parity evidence. The runner exclusively owns ${receiptDir}, its run manifest,
and its lock: read prior receipts but never create, edit, rename, or delete anything in that directory.
Keep every temporary file inside the repository (prefer .agent/tmp); never request or access /tmp or any
external directory. Use apply_patch for hand edits. If no high-confidence winner
remains, make no product edit and state exactly NO_NEW_WINNER. Finish by running the narrowest relevant tests
and return a concise receipt listing changes, evidence, tests, risks, and whether a new winner was implemented.`;

let consecutiveNoWinner = 0;
try {
for (let pass = 1; pass <= passes; pass += 1) {
  const successfulPath = resolve(receiptDir, `pass-${String(pass).padStart(2, '0')}.json`);
  if (existsSync(successfulPath)) {
    const existing = JSON.parse(readFileSync(successfulPath, 'utf8'));
    if (existing.schemaVersion !== 1 || existing.runId !== run.runId || existing.status !== 0) {
      throw new Error(`foreign or invalid successful receipt: ${successfulPath}`);
    }
    consecutiveNoWinner = existing.summary?.includes('NO_NEW_WINNER')
      ? consecutiveNoWinner + 1
      : 0;
    continue;
  }
  process.stderr.write(`convergence: starting pass ${pass}/${passes}\n`);
  const prompt = `${invariant}\n\nThis is convergence pass ${pass} of ${passes}. Read receipts in ${receiptDir} before choosing work.`;
  let successfulReceipt;
  for (let attempt = 0; attempt < models.length; attempt += 1) {
    const model = models[attempt];
    const result = spawnSync('opencode', ['run', prompt, '--pure', '--auto', '--format', 'json', '-m', model], {
      cwd: root,
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 128 * 1024 * 1024,
      timeout: 30 * 60 * 1000,
    });
    const compact = compactOutput(result.stdout);
    const receipt = {
      schemaVersion: 1, runId: run.runId, pass, attempt: attempt + 1, pid: process.pid,
      model, status: result.status, signal: result.signal,
      promptHash: hash(prompt), baselineHead: run.baselineHead,
      baselineStateHash: run.baselineStateHash, resultingStateHash: stateHash(),
      summary: compact.text, errors: compact.errors, stderr: (result.stderr || '').slice(-8_000),
      completedAt: new Date().toISOString(),
    };
    const substantiveReceipt = compact.text.trim().length >= 500
      && /\btests?(?: run)?\s*:/i.test(compact.text)
      && /\brisks?\b/i.test(compact.text)
      && /(?:new winner|NO_NEW_WINNER|implemented)/i.test(compact.text);
    const validSuccess = result.status === 0 && !result.error && compact.errors.length === 0 && substantiveReceipt;
    if (!validSuccess && receipt.status === 0) {
      receipt.status = 1;
      receipt.errors.push('OpenCode exited zero without a substantive final receipt');
    }
    if (result.error) receipt.errors.push(result.error.message);
    const suffix = validSuccess ? '' : `-attempt-${String(attempt + 1).padStart(2, '0')}`;
    writeReceipt(resolve(receiptDir, `pass-${String(pass).padStart(2, '0')}${suffix}.json`), receipt);
    if (validSuccess) { successfulReceipt = receipt; break; }
  }
  if (!successfulReceipt) process.exit(1);
  if (/^\s*(?:\*\*)?NO_NEW_WINNER(?:\*\*)?\s*$/m.test(successfulReceipt.summary)) consecutiveNoWinner += 1;
  else consecutiveNoWinner = 0;
  if (pass >= 10 && consecutiveNoWinner >= 2) break;
}
} finally {
  closeSync(lockFd);
  unlinkSync(lockPath);
}
