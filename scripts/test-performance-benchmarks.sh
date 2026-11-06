#!/usr/bin/env bash
# B11: hermetic, fixture-scoped performance evidence and budgets.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HARNESS="$ROOT/scripts/run-performance-benchmarks.mjs"
VALIDATOR="$ROOT/scripts/validate-performance-evidence.mjs"
BUDGETS="$ROOT/scripts/performance-budgets.json"
SCHEMA="$ROOT/scripts/performance-evidence.schema.json"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

if node "$HARNESS" --iterations 3 --output "$TMP/evidence.json"; then pass 'hermetic benchmark harness stays within fixture budgets'; else fail 'benchmark harness failed'; fi
if node "$VALIDATOR" "$TMP/evidence.json" "$BUDGETS"; then pass 'measured evidence validates against versioned contract'; else fail 'measured evidence is invalid'; fi

if node - "$TMP/evidence.json" <<'NODE'
const value = JSON.parse(require('node:fs').readFileSync(process.argv[2], 'utf8'));
if (value.schemaVersion !== 2 || value.fixtureId !== 'installer-hermetic-v2') process.exit(1);
if (value.scope !== 'hermetic-fixture' || value.claimsProductionPerformance !== false) process.exit(2);
if (!value.authority || value.authority.releaseId !== 'fixture-release' || !/^[a-f0-9]{64}$/.test(value.authority.planDigest)) process.exit(8);
if (!/^[a-f0-9]{40}$/.test(value.authority.sourceCommit) || value.authority.fixturePlatform.environment !== 'native') process.exit(9);
if (value.sampling.cold !== 'fresh-process-per-sample' || value.sampling.warm !== 'persistent-process-repeated-samples') process.exit(3);
const names = new Set(value.measurements.map(item => `${item.name}:${item.temperature}`));
for (const expected of ['launcher-render:cold','launcher-render:warm','time-to-plan:cold','time-to-plan:warm','unchanged-run:cold','unchanged-run:warm','task-latency:cold','task-latency:warm','queue-wait:warm','queue-utilization:warm','critical-path:warm','observed-makespan:warm','cpu-time:warm','peak-rss:warm','fixture-disk-read-bytes:warm','fixture-disk-write-bytes:warm','fixture-network-received-bytes:warm','fixture-network-sent-bytes:warm','peak-cpu-percent:warm','peak-disk-throughput:warm','peak-network-throughput:warm']) if (!names.has(expected)) process.exit(4);
const measured = value.measurements.filter(item => item.status === 'measured');
if (!measured.every(item => item.sampleCount >= 3 && Number.isFinite(item.statistics.p50) && Number.isFinite(item.statistics.p95) && Number.isFinite(item.statistics.max))) process.exit(5);
if (!value.measurements.filter(item => item.status === 'unsupported').every(item => item.sampleCount === 0 && item.statistics === null && item.budget === null && item.passed === null && item.limitation)) process.exit(6);
if (!measured.every(item => item.method && !item.method.includes('declared resource'))) process.exit(7);
NODE
then pass 'v2 distinguishes fresh-process cold samples, persistent warm samples, measured distributions, and unsupported peaks'; else fail 'required v2 measurements or sampling semantics are absent'; fi

# Evidence cannot widen its own budgets.
node - "$TMP/evidence.json" "$TMP/widened.json" <<'NODE'
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
value.measurements[0].budget.value = value.measurements[0].budget.value + 1;
fs.writeFileSync(process.argv[3], JSON.stringify(value));
NODE
if node "$VALIDATOR" "$TMP/widened.json" "$BUDGETS" >/dev/null 2>&1; then fail 'self-widened budget was accepted'; else pass 'evidence budgets are pinned to policy'; fi

# Production claims are forbidden for hermetic fixture evidence.
node - "$TMP/evidence.json" "$TMP/production-claim.json" <<'NODE'
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
value.claimsProductionPerformance = true;
fs.writeFileSync(process.argv[3], JSON.stringify(value));
NODE
if node "$VALIDATOR" "$TMP/production-claim.json" "$BUDGETS" >/dev/null 2>&1; then fail 'fixture evidence was allowed to claim production performance'; else pass 'fixture evidence cannot become a production claim'; fi

# Evidence authority is immutable: results must remain bound to the measured
# release, source, plan, platform, and isolation boundary.
node - "$TMP/evidence.json" "$TMP/tampered-authority.json" <<'NODE'
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
value.authority.planDigest = '0'.repeat(64);
fs.writeFileSync(process.argv[3], JSON.stringify(value));
NODE
if node "$VALIDATOR" "$TMP/tampered-authority.json" "$BUDGETS" >/dev/null 2>&1; then fail 'tampered benchmark authority was accepted'; else pass 'benchmark authority remains bound to measured plan'; fi

# Labels cannot counterfeit process isolation or an unavailable measurement.
node - "$TMP/evidence.json" "$TMP/fake-processes.json" "$TMP/fake-unsupported.json" <<'NODE'
const fs = require('node:fs');
const source = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const processes = structuredClone(source);
processes.processEvidence.coldPids[1] = processes.processEvidence.coldPids[0];
fs.writeFileSync(process.argv[3], JSON.stringify(processes));
const unsupported = structuredClone(source);
const item = unsupported.measurements.find(value => value.status === 'unsupported');
Object.assign(item, { sampleCount:3, statistics:{p50:0,p95:0,max:0}, budget:{comparison:'max',value:0,statistic:'p95'}, passed:true });
fs.writeFileSync(process.argv[4], JSON.stringify(unsupported));
NODE
if node "$VALIDATOR" "$TMP/fake-processes.json" "$BUDGETS" >/dev/null 2>&1; then fail 'duplicate cold process identities were accepted'; else pass 'cold process identity evidence cannot be counterfeited'; fi
if node "$VALIDATOR" "$TMP/fake-unsupported.json" "$BUDGETS" >/dev/null 2>&1; then fail 'unsupported peak was converted to a fabricated zero'; else pass 'unsupported peaks cannot become fabricated zero measurements'; fi

node - "$TMP/evidence.json" "$TMP/fake-resources.json" "$TMP/inconsistent-dag.json" <<'NODE'
const fs = require('node:fs');
const source = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const resources = structuredClone(source);
for (const name of ['cpu-time','fixture-disk-read-bytes','fixture-disk-write-bytes','fixture-network-received-bytes','fixture-network-sent-bytes']) {
  resources.measurements.find(value => value.name === name).statistics = { p50:0, p95:0, max:0 };
}
fs.writeFileSync(process.argv[3], JSON.stringify(resources));
const dag = structuredClone(source);
dag.measurements.find(value => value.name === 'observed-makespan').statistics = { p50:1, p95:1, max:1 };
fs.writeFileSync(process.argv[4], JSON.stringify(dag));
NODE
if node "$VALIDATOR" "$TMP/fake-resources.json" "$BUDGETS" >/dev/null 2>&1; then fail 'fabricated zero resource measurements were accepted'; else pass 'fixed resource fixtures retain exact positive measurements'; fi
if node "$VALIDATOR" "$TMP/inconsistent-dag.json" "$BUDGETS" >/dev/null 2>&1; then fail 'impossible DAG timing was accepted'; else pass 'DAG timing evidence remains internally consistent'; fi

node -e 'const s=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); if(s.$id!=="https://install.doctor/schemas/performance-evidence/v2") process.exit(1)' "$SCHEMA" \
  && pass 'versioned JSON schema is published' || fail 'versioned JSON schema is missing'

# Cold evidence must actually come from distinct worker processes, while warm
# samples must share one process. These identities are evidence, not labels.
if node - "$TMP/evidence.json" <<'NODE'
const value = JSON.parse(require('node:fs').readFileSync(process.argv[2], 'utf8'));
if (value.processEvidence.coldPids.length < 3 || new Set(value.processEvidence.coldPids).size !== value.processEvidence.coldPids.length) process.exit(1);
if (value.processEvidence.warmPids.length !== 1) process.exit(2);
NODE
then pass 'cold and warm process identities prove their sampling model'; else fail 'sampling model is only asserted, not evidenced'; fi

printf 'performance-benchmarks: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
