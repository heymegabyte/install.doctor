#!/usr/bin/env node
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const worker = path.join(root, 'scripts/performance-benchmark-worker.mjs');
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; };
const iterations = Number(option('--iterations') ?? 7);
const outputPath = option('--output');
if (!Number.isSafeInteger(iterations) || iterations < 3 || iterations > 100) throw new Error('--iterations must be an integer from 3 through 100');
const policy = JSON.parse(fs.readFileSync(path.join(root, 'scripts/performance-budgets.json'), 'utf8'));
const sourceCommit = childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { cwd:root, encoding:'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('benchmark source commit is unavailable');

const invoke = (action, count) => {
  const raw = childProcess.execFileSync(process.execPath, [worker, '--action', action, '--iterations', String(count)], {
    cwd:root, encoding:'utf8', maxBuffer:4 * 1024 * 1024, env:{ ...process.env, NODE_NO_WARNINGS:'1' },
  });
  const parsed = JSON.parse(raw);
  if (parsed.schemaVersion !== 1 || parsed.action !== action || parsed.samples.length !== count) throw new Error(`invalid ${action} worker evidence`);
  return parsed;
};
const cold = new Map();
const coldPids = [];
for (const action of ['launcher-render','plan','unchanged','dag']) {
  const actionSamples = [];
  for (let index = 0; index < iterations; index += 1) {
    const result = invoke(action, 1); coldPids.push(result.pid); actionSamples.push(result.samples[0]);
  }
  cold.set(action, actionSamples);
}
if (new Set(coldPids).size !== coldPids.length) throw new Error('cold samples did not use distinct fresh processes');
const warm = invoke('warm-all', iterations);
const planDigests = [
  ...cold.get('plan').map(value => value.planDigest),
  ...warm.samples.map(value => value.planDigest),
];
if (new Set(planDigests).size !== 1 || !/^[a-f0-9]{64}$/.test(planDigests[0] ?? '')) {
  throw new Error('benchmark planning did not preserve one deterministic plan identity');
}

const percentile = (values, ratio) => [...values].sort((left,right) => left-right)[Math.max(0, Math.ceil(values.length * ratio) - 1)];
const stats = values => {
  if (values.length < policy.minimumSamples || values.some(value => !Number.isFinite(value) || value < 0)) throw new Error('measurement has invalid or insufficient samples');
  return { p50:Number(percentile(values,.50).toFixed(3)), p95:Number(percentile(values,.95).toFixed(3)), max:Number(Math.max(...values).toFixed(3)) };
};
const sources = new Map([
  ['launcher-render:cold',cold.get('launcher-render').map(value => value.launcherRender)],
  ['launcher-render:warm',warm.samples.map(value => value.launcherRender)],
  ['time-to-plan:cold',cold.get('plan').map(value => value.timeToPlan)],
  ['time-to-plan:warm',warm.samples.map(value => value.timeToPlan)],
  ['unchanged-run:cold',cold.get('unchanged').map(value => value.unchangedRun)],
  ['unchanged-run:warm',warm.samples.map(value => value.unchangedRun)],
  ['task-latency:cold',cold.get('dag').map(value => value.taskLatency)],
  ['task-latency:warm',warm.samples.map(value => value.taskLatency)],
  ['queue-wait:warm',warm.samples.map(value => value.queueWait)],
  ['queue-utilization:warm',warm.samples.map(value => value.queueUtilization)],
  ['critical-path:warm',warm.samples.map(value => value.criticalPath)],
  ['observed-makespan:warm',warm.samples.map(value => value.observedMakespan)],
  ['cpu-time:warm',warm.samples.map(value => value.cpuTime)],
  ['peak-rss:warm',warm.samples.map(value => value.peakRss)],
  ['fixture-disk-read-bytes:warm',warm.samples.map(value => value.diskReadBytes)],
  ['fixture-disk-write-bytes:warm',warm.samples.map(value => value.diskWriteBytes)],
  ['fixture-network-received-bytes:warm',warm.samples.map(value => value.networkReceivedBytes)],
  ['fixture-network-sent-bytes:warm',warm.samples.map(value => value.networkSentBytes)],
]);
const methods = Object.freeze({
  'launcher-render':'`renderBootstrap` string generation only; not stage-zero execution',
  'time-to-plan':'normalized representative dependency-DAG plan in the installer engine',
  'unchanged-run':'approved engine run whose check returns verified and performs no apply',
  'task-latency':'monotonic observer time from running to verified; per-run p95 across representative DAG tasks',
  'queue-wait':'monotonic running time minus dependency-derived ready time; per-run p95',
  'queue-utilization':'sum of monotonic running intervals divided by the time-integral of min(effective capacity 2, dependency-eligible unfinished tasks)',
  'critical-path':'dependency-DAG dynamic program over monotonic measured task latencies',
  'observed-makespan':'monotonic first-task-start through last-task-finish interval',
  'cpu-time':'Node process.resourceUsage user plus system CPU delta for the exact resource fixture',
  'peak-rss':'Node process.resourceUsage maxRSS for the persistent benchmark worker',
  'fixture-disk-read-bytes':'exact bytes returned by a verified dedicated temporary-file read',
  'fixture-disk-write-bytes':'exact payload bytes written to a dedicated temporary file',
  'fixture-network-received-bytes':'exact loopback response payload bytes observed by the fixture client',
  'fixture-network-sent-bytes':'exact loopback request payload bytes observed by the fixture server',
});
const limitations = Object.freeze({
  'peak-cpu-percent':'Portable child-tree peak CPU sampling is not implemented by this hermetic fixture; cumulative CPU time is measured instead.',
  'peak-disk-throughput':'Portable kernel-level peak disk throughput is not implemented; exact fixture payload bytes are measured without inferring device throughput.',
  'peak-network-throughput':'Portable kernel-level peak network throughput is not implemented; exact loopback payload bytes are measured without inferring interface throughput.',
});
const measurements = policy.budgets.map(cell => {
  const key = `${cell.name}:${cell.temperature}`;
  if (cell.requiredStatus === 'unsupported') return {
    name:cell.name, temperature:cell.temperature, unit:cell.unit, status:'unsupported', sampleCount:0,
    statistics:null, budget:null, passed:null, method:'explicit capability declaration', limitation:limitations[cell.name],
  };
  const values = sources.get(key);
  if (!values) throw new Error(`missing measured source for ${key}`);
  const statistics = stats(values);
  const passed = cell.comparison === 'max' ? statistics.p95 <= cell.value : statistics.p95 >= cell.value;
  return {
    name:cell.name, temperature:cell.temperature, unit:cell.unit, status:'measured', sampleCount:values.length,
    statistics, budget:{ comparison:cell.comparison, value:cell.value, statistic:'p95' }, passed,
    method:methods[cell.name], limitation:null,
  };
});
const evidence = {
  schemaVersion:2, fixtureId:policy.fixtureId, scope:'hermetic-fixture', claimsProductionPerformance:false,
  generatedAt:new Date().toISOString(), runtime:{node:process.version,platform:process.platform,arch:process.arch},
  authority:{
    releaseId:'fixture-release', sourceCommit, planDigest:planDigests[0],
    fixturePlatform:{
      os:process.platform,
      osVersion:os.release(),
      arch:process.arch,
      environment:'native',
      packageManager:process.platform === 'darwin' ? 'brew' : process.platform === 'win32' ? 'winget' : 'native',
    },
    hardwareClass:'local-unclassified', isolation:'fresh-process-and-loopback-fixture',
  },
  sampling:{ cold:'fresh-process-per-sample', warm:'persistent-process-repeated-samples', minimumSamples:policy.minimumSamples },
  processEvidence:{ coldPids, warmPids:[warm.pid] }, measurements,
};
const serialized = `${JSON.stringify(evidence,null,2)}\n`;
if (outputPath) fs.writeFileSync(path.resolve(outputPath), serialized, { mode:0o600 }); else process.stdout.write(serialized);
if (measurements.some(item => item.status === 'measured' && !item.passed)) process.exitCode = 1;
