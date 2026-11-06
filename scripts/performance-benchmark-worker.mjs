#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { renderBootstrap } from '../packages/control-plane/src/bootstrap.ts';
import { createInstallerEngine } from '../packages/installer-engine/dist/index.js';

const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; };
const action = option('--action');
const iterations = Number(option('--iterations') ?? 1);
if (!action || !Number.isSafeInteger(iterations) || iterations < 1 || iterations > 100) throw new Error('usage: performance-benchmark-worker.mjs --action ACTION --iterations 1..100');

const digest = character => character.repeat(64);
const facts = Object.freeze({ schemaVersion:1, hostId:'benchmark-host', collectedAt:'2026-11-05T00:00:00.000Z', os:'darwin', osVersion:'15', arch:'arm64', environment:'native', roles:['fixture'], packageManagers:['brew'], capabilities:[] });
const desired = Object.freeze({ schemaVersion:1, revision:'fixture-revision', hostId:'benchmark-host', packages:[], services:[], consents:[], offline:true });
const bootstrapConfig = Object.freeze({ manifestUrl:'https://app.install.doctor/releases/fixture-v2/manifest', signatureUrl:'https://app.install.doctor/releases/fixture-v2/manifest.sig', signerIdentity:'fixture', signerPublicKey:'ssh-ed25519 AAAA fixture' });
const elapsed = async operation => { const start = performance.now(); const value = await operation(); return { milliseconds:performance.now() - start, value }; };
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const percentile = (values, ratio) => [...values].sort((left,right) => left-right)[Math.max(0, Math.ceil(values.length * ratio) - 1)];

const task = (id, dependencies = []) => ({
  schemaVersion:1, id, inputDigest:digest({ 'fixture.root':'a', 'fixture.left':'b', 'fixture.right':'c', 'fixture.final':'d' }[id] ?? 'e'), dependencies,
  predicate:'fixture', requiredCapabilities:[], operations:{check:'check',apply:'apply',verify:'verify'}, timeoutMs:2_000,
  retry:{class:'never',maxAttempts:1,backoffMs:0}, resources:{cpu:1,memoryMiB:16,network:false}, privilege:'user', network:'none', consent:'none',
  lockDomains:[], cleanup:'none', compensation:'none', failurePolicy:'continue-independent'
});
const simpleTasks = [task('fixture.root')];
const dagTasks = [task('fixture.root'), task('fixture.left',['fixture.root']), task('fixture.right',['fixture.root']), task('fixture.final',['fixture.left','fixture.right'])];
const durations = Object.freeze({ 'fixture.root':9, 'fixture.left':15, 'fixture.right':21, 'fixture.final':8 });

function engineFor(tasks, mutate) {
  return createInstallerEngine({ maxConcurrency:2, resourceLimits:{cpu:2,memoryMiB:64,networkConcurrency:1}, adapter:{
    discover: async () => facts,
    plan: async () => ({ tasks, selectedTaskIds:tasks.map(item => item.id) }),
    check: async () => mutate ? 'needed' : 'verified',
    apply: async node => { if (mutate) await sleep(durations[node.id] ?? 1); },
    verify: async () => 'verified',
  }});
}

async function launcherRender() {
  const result = await elapsed(async () => renderBootstrap(bootstrapConfig));
  if (!result.value.startsWith('#!/usr/bin/env bash')) throw new Error('launcher render fixture is invalid');
  return { launcherRender:result.milliseconds };
}

async function plan() {
  const engine = engineFor(dagTasks, false);
  const result = await elapsed(() => engine.plan(facts, desired, 'fixture-release'));
  if (result.value.selectedTaskIds.length !== dagTasks.length) throw new Error('planning omitted the representative DAG');
  return { timeToPlan:result.milliseconds, planDigest:result.value.digest };
}

async function unchanged() {
  const engine = engineFor(simpleTasks, false);
  const approved = await engine.plan(facts, desired, 'fixture-release');
  const result = await elapsed(() => engine.run({ runId:`unchanged-${process.pid}-${Date.now()}`, releaseId:'fixture-release', desiredState:desired, approvedPlanDigest:approved.digest }));
  if (result.value.exitCode !== 0 || result.value.receipt.status !== 'success') throw new Error('unchanged run failed');
  return { unchangedRun:result.milliseconds };
}

async function dag() {
  const engine = engineFor(dagTasks, true);
  const approved = await engine.plan(facts, desired, 'fixture-release');
  const monotonicEvents = [];
  const result = await engine.run(
    { runId:`dag-${process.pid}-${Date.now()}`, releaseId:'fixture-release', desiredState:desired, approvedPlanDigest:approved.digest },
    event => monotonicEvents.push({ event, at:performance.now() }),
  );
  if (result.exitCode !== 0) throw new Error('representative DAG failed');
  const time = (taskId, status) => monotonicEvents.find(item => item.event.kind === 'task-status' && item.event.taskId === taskId && item.event.status === status)?.at;
  const starts = new Map(); const finishes = new Map(); const latencies = new Map();
  for (const node of dagTasks) {
    const start = time(node.id, 'running'); const finish = time(node.id, 'verified');
    if (start === undefined || finish === undefined || finish < start) throw new Error(`missing monotonic lifecycle for ${node.id}`);
    starts.set(node.id, start); finishes.set(node.id, finish); latencies.set(node.id, finish - start);
  }
  const readyAt = new Map(dagTasks.map(node => [node.id, node.dependencies.length === 0 ? starts.get(node.id) : Math.max(...node.dependencies.map(id => finishes.get(id)))]));
  const queueWaits = dagTasks.map(node => Math.max(0, starts.get(node.id) - readyAt.get(node.id)));
  const critical = new Map();
  for (const node of dagTasks) critical.set(node.id, latencies.get(node.id) + (node.dependencies.length === 0 ? 0 : Math.max(...node.dependencies.map(id => critical.get(id)))));
  const observedMakespan = Math.max(...finishes.values()) - Math.min(...starts.values());
  const occupied = [...latencies.values()].reduce((sum,value) => sum + value, 0);
  const effectiveCapacity = 2;
  const boundaries = [...new Set([...starts.values(), ...finishes.values()])].sort((left,right) => left-right);
  let availableCapacityTime = 0;
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const intervalStart = boundaries[index]; const intervalEnd = boundaries[index + 1];
    const midpoint = intervalStart + ((intervalEnd - intervalStart) / 2);
    const eligible = dagTasks.filter(node => readyAt.get(node.id) <= midpoint && finishes.get(node.id) > midpoint).length;
    availableCapacityTime += (intervalEnd - intervalStart) * Math.min(effectiveCapacity, eligible);
  }
  return {
    taskLatency:percentile([...latencies.values()], .95), queueWait:percentile(queueWaits,.95),
    queueUtilization:Math.min(1, occupied / Math.max(0.001, availableCapacityTime)),
    criticalPath:Math.max(...critical.values()), observedMakespan,
  };
}

async function exactResources() {
  const diskPayload = Buffer.alloc(128 * 1024, 0x5a);
  const networkSent = Buffer.alloc(64 * 1024, 0x6b);
  const networkResponse = Buffer.alloc(32 * 1024, 0x7c);
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'install-doctor-perf-'));
  const file = path.join(directory, 'payload');
  const usageStart = process.resourceUsage();
  try {
    await fs.promises.writeFile(file, diskPayload, { flag:'wx', mode:0o600 });
    const read = await fs.promises.readFile(file);
    if (!read.equals(diskPayload)) throw new Error('disk fixture content mismatch');
    let serverReceived = 0;
    const server = net.createServer(socket => {
      socket.on('data', chunk => { serverReceived += chunk.length; });
      socket.on('end', () => socket.end(networkResponse));
    });
    await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('loopback fixture has no port');
    let clientReceived = 0;
    await new Promise((resolve,reject) => {
      const socket = net.createConnection({ host:'127.0.0.1', port:address.port }, () => socket.end(networkSent));
      socket.on('data', chunk => { clientReceived += chunk.length; }); socket.on('end',resolve); socket.on('error',reject);
    });
    await new Promise(resolve => server.close(resolve));
    if (serverReceived !== networkSent.length || clientReceived !== networkResponse.length) throw new Error('loopback byte counters disagree');
    const usageEnd = process.resourceUsage();
    return {
      cpuTime:(usageEnd.userCPUTime + usageEnd.systemCPUTime - usageStart.userCPUTime - usageStart.systemCPUTime) / 1000,
      peakRss:usageEnd.maxRSS, diskReadBytes:read.length, diskWriteBytes:diskPayload.length,
      networkSentBytes:serverReceived, networkReceivedBytes:clientReceived,
    };
  } finally { await fs.promises.rm(directory, { recursive:true, force:true }); }
}

const actions = { 'launcher-render':launcherRender, plan, unchanged, dag, resources:exactResources };
if (!(action in actions) && action !== 'warm-all') throw new Error(`unknown benchmark action: ${action}`);
const samples = [];
for (let index = 0; index < iterations; index += 1) {
  if (action === 'warm-all') samples.push({ ...(await launcherRender()), ...(await plan()), ...(await unchanged()), ...(await dag()), ...(await exactResources()) });
  else samples.push(await actions[action]());
}
process.stdout.write(`${JSON.stringify({ schemaVersion:1, pid:process.pid, action, samples })}\n`);
