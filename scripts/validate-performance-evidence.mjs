#!/usr/bin/env node
import fs from 'node:fs';
import childProcess from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const [evidencePath, policyPath] = process.argv.slice(2);
if (!evidencePath || !policyPath) throw new Error('usage: validate-performance-evidence.mjs EVIDENCE BUDGETS');
const evidence = JSON.parse(fs.readFileSync(evidencePath,'utf8'));
const policy = JSON.parse(fs.readFileSync(policyPath,'utf8'));
const errors = [];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceCommit = childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { cwd:root, encoding:'utf8' }).trim();
const planEvidence = JSON.parse(childProcess.execFileSync(process.execPath, [path.join(root, 'scripts/performance-benchmark-worker.mjs'), '--action', 'plan', '--iterations', '1'], {
  cwd:root, encoding:'utf8', maxBuffer:4 * 1024 * 1024, env:{ ...process.env, NODE_NO_WARNINGS:'1' },
}));
const authoritativePlanDigest = planEvidence?.samples?.[0]?.planDigest;
const exact = (value, keys, location) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { errors.push(`${location} must be an object`); return; }
  for (const key of Object.keys(value)) if (!keys.includes(key)) errors.push(`${location}.${key} is unknown`);
  for (const key of keys) if (!(key in value)) errors.push(`${location}.${key} is required`);
};
const finite = value => Number.isFinite(value) && value >= 0;
exact(policy,['schemaVersion','fixtureId','minimumSamples','budgets'],'policy');
if (policy.schemaVersion !== 2 || policy.fixtureId !== 'installer-hermetic-v2') errors.push('policy identity is not v2');
if (!Number.isSafeInteger(policy.minimumSamples) || policy.minimumSamples < 3) errors.push('policy.minimumSamples must be at least three');
if (!Array.isArray(policy.budgets) || policy.budgets.length === 0) errors.push('policy.budgets must be non-empty');
const expected = new Map();
for (const [index,cell] of (policy.budgets ?? []).entries()) {
  exact(cell,['name','temperature','unit','requiredStatus','comparison','value'],`policy.budgets[${index}]`);
  const key = `${cell.name}:${cell.temperature}`;
  if (expected.has(key)) errors.push(`${key} policy cell is duplicated`); else expected.set(key,cell);
  if (!['cold','warm'].includes(cell.temperature) || !['measured','unsupported'].includes(cell.requiredStatus)) errors.push(`${key} has invalid policy classification`);
  if (cell.requiredStatus === 'measured' && (!['min','max'].includes(cell.comparison) || !finite(cell.value))) errors.push(`${key} measured budget is invalid`);
  if (cell.requiredStatus === 'unsupported' && (cell.comparison !== null || cell.value !== null)) errors.push(`${key} unsupported budget must not invent a threshold`);
}
exact(evidence,['schemaVersion','fixtureId','scope','claimsProductionPerformance','generatedAt','runtime','authority','sampling','processEvidence','measurements'],'$');
if (evidence.schemaVersion !== 2 || evidence.fixtureId !== policy.fixtureId) errors.push('evidence identity does not match v2 policy');
if (evidence.scope !== 'hermetic-fixture' || evidence.claimsProductionPerformance !== false) errors.push('hermetic evidence cannot claim production performance');
if (!Number.isFinite(Date.parse(evidence.generatedAt))) errors.push('generatedAt must be a timestamp');
exact(evidence.runtime,['node','platform','arch'],'$.runtime');
if (evidence.runtime?.node !== process.version || evidence.runtime?.platform !== process.platform || evidence.runtime?.arch !== process.arch) errors.push('runtime identity does not match the validating host');
exact(evidence.authority,['releaseId','sourceCommit','planDigest','fixturePlatform','hardwareClass','isolation'],'$.authority');
exact(evidence.authority?.fixturePlatform,['os','osVersion','arch','environment','packageManager'],'$.authority.fixturePlatform');
if (evidence.authority?.releaseId !== 'fixture-release'
  || evidence.authority?.sourceCommit !== sourceCommit
  || evidence.authority?.planDigest !== authoritativePlanDigest
  || JSON.stringify(evidence.authority?.fixturePlatform) !== JSON.stringify({os:'darwin',osVersion:'15',arch:'arm64',environment:'native',packageManager:'brew'})
  || evidence.authority?.hardwareClass !== 'local-unclassified'
  || evidence.authority?.isolation !== 'fresh-process-and-loopback-fixture') errors.push('fixture authority binding is invalid');
exact(evidence.sampling,['cold','warm','minimumSamples'],'$.sampling');
if (evidence.sampling?.cold !== 'fresh-process-per-sample' || evidence.sampling?.warm !== 'persistent-process-repeated-samples' || evidence.sampling?.minimumSamples !== policy.minimumSamples) errors.push('sampling authority is invalid');
exact(evidence.processEvidence,['coldPids','warmPids'],'$.processEvidence');
const coldPids = evidence.processEvidence?.coldPids;
const warmPids = evidence.processEvidence?.warmPids;
if (!Array.isArray(coldPids) || coldPids.length < policy.minimumSamples || coldPids.some(pid => !Number.isSafeInteger(pid) || pid < 1) || new Set(coldPids).size !== coldPids.length) errors.push('cold samples require distinct positive process identities');
if (!Array.isArray(warmPids) || warmPids.length !== 1 || !Number.isSafeInteger(warmPids[0]) || warmPids[0] < 1) errors.push('warm samples require exactly one persistent process identity');
if (!Array.isArray(evidence.measurements) || evidence.measurements.length !== expected.size) errors.push('measurements must cover policy exactly once');
const seen = new Set();
for (const [index,item] of (evidence.measurements ?? []).entries()) {
  exact(item,['name','temperature','unit','status','sampleCount','statistics','budget','passed','method','limitation'],`$.measurements[${index}]`);
  const key = `${item.name}:${item.temperature}`; const cell = expected.get(key);
  if (!cell || seen.has(key)) { errors.push(`${key} is unexpected or duplicated`); continue; } seen.add(key);
  if (item.unit !== cell.unit || item.status !== cell.requiredStatus) errors.push(`${key} classification differs from policy`);
  if (typeof item.method !== 'string' || item.method.length < 8) errors.push(`${key} lacks a measurement method`);
  if (item.status === 'unsupported') {
    if (item.sampleCount !== 0 || item.statistics !== null || item.budget !== null || item.passed !== null || typeof item.limitation !== 'string' || item.limitation.length < 16) errors.push(`${key} unsupported evidence must be explicit and value-free`);
    continue;
  }
  if (!Number.isSafeInteger(item.sampleCount) || item.sampleCount < policy.minimumSamples) errors.push(`${key} has insufficient samples`);
  exact(item.statistics,['p50','p95','max'],`${key}.statistics`);
  if (![item.statistics?.p50,item.statistics?.p95,item.statistics?.max].every(finite) || item.statistics.p50 > item.statistics.p95 || item.statistics.p95 > item.statistics.max) errors.push(`${key} distribution is invalid`);
  exact(item.budget,['comparison','value','statistic'],`${key}.budget`);
  if (item.budget?.comparison !== cell.comparison || item.budget?.value !== cell.value || item.budget?.statistic !== 'p95') errors.push(`${key} does not use the pinned p95 budget`);
  const passed = cell.comparison === 'max' ? item.statistics?.p95 <= cell.value : item.statistics?.p95 >= cell.value;
  if (item.passed !== passed || !passed) errors.push(`${key} exceeds its budget or has inconsistent pass evidence`);
  if (item.limitation !== null) errors.push(`${key} measured evidence limitation must be null`);
}
for (const key of expected.keys()) if (!seen.has(key)) errors.push(`${key} is missing`);
const measured = key => evidence.measurements?.find(item => `${item.name}:${item.temperature}` === key && item.status === 'measured');
for (const [key, exactBytes] of [
  ['fixture-disk-read-bytes:warm', 131072], ['fixture-disk-write-bytes:warm', 131072],
  ['fixture-network-received-bytes:warm', 32768], ['fixture-network-sent-bytes:warm', 65536],
]) {
  const item = measured(key);
  if (!item || item.statistics?.p50 !== exactBytes || item.statistics?.p95 !== exactBytes || item.statistics?.max !== exactBytes) errors.push(`${key} must preserve the exact fixture byte count`);
}
if ((measured('cpu-time:warm')?.statistics?.p50 ?? 0) <= 0 || (measured('peak-rss:warm')?.statistics?.p50 ?? 0) <= 0) errors.push('resource measurements must be positive');
const critical = measured('critical-path:warm')?.statistics;
const makespan = measured('observed-makespan:warm')?.statistics;
if (!critical || !makespan || makespan.p50 < critical.p50 || makespan.p95 < critical.p95 || makespan.max < critical.max) errors.push('observed makespan cannot be shorter than the dependency critical path');
if (errors.length) { console.error(errors.map(error => `- ${error}`).join('\n')); process.exit(1); }
console.log(`performance evidence valid: ${seen.size} v2 fixture-scoped measurements`);
