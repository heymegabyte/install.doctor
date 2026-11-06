# Performance evidence

Install Doctor performance claims remain fixture-scoped until equivalent clean-host canaries exist.
The v2 harness deliberately calls launcher string generation `launcher-render`: it is not execution of
the signed stage-zero launcher and cannot substantiate curl, TLS, SSHSIG, artifact-download, runtime,
or engine-handoff latency.

`scripts/run-performance-benchmarks.mjs` launches
`scripts/performance-benchmark-worker.mjs` in two distinct sampling modes:

- Every cold sample runs in a fresh process. Distinct positive process IDs are retained as evidence.
- Every warm sample runs repeatedly in one persistent process. Its single process ID is retained.

Both modes require at least three samples. Evidence records p50, p95, and maximum; pinned budgets are
evaluated against p95. The representative four-node dependency DAG includes fan-out and fan-in. Task
latency and queue wait use monotonic observer timestamps. Queue wait begins only when dependencies have
completed. Queue utilization divides occupied worker time by the time-integral of capacity that
dependency-eligible unfinished work could actually use, capped at the effective capacity of two;
unavoidable serial dependency intervals are therefore not mislabeled as idle scheduler capacity.
Critical path is calculated by a dependency-aware dynamic program rather than by renaming makespan.

Evidence binds the synthetic release ID, source commit, deterministic normalized-plan digest, exact
fixture platform tuple, unclassified local hardware class, and isolation method. These bindings make
results reproducible and prevent a local fixture from being relabeled as a fleet or production receipt.

The unchanged fixture asserts successful verification without applying a mutation. A dedicated private
temporary file provides exact fixture disk payload byte counts. A loopback TCP exchange provides exact
request and response payload byte counts observed at opposite endpoints. Those counters are not disk or
network throughput and do not describe a production interface. Cumulative process CPU time and worker
peak RSS are measured through Node's resource-usage interface.

Portable child-tree peak CPU percentage, kernel-level peak disk throughput, and kernel-level peak
network throughput are explicitly `unsupported`. They have no samples, statistics, pass result, or
budget. The evidence never substitutes zero or a declared resource estimate for a missing measurement.
Real-host performance evidence must add platform-appropriate child-tree/cgroup or operating-system
sampling and bind it to the exact release, source commit, plan, platform tuple, hardware class, method,
and expiry before any production claim is allowed.

Run the focused gate with:

```sh
bash scripts/test-performance-benchmarks.sh
```

Budgets live in `scripts/performance-budgets.json`; the evidence contract is
`scripts/performance-evidence.schema.json`. The strict validator rejects missing or duplicate cells,
insufficient samples, fake cold/warm process evidence, invalid distributions, invented unsupported
values, self-widened thresholds, inconsistent pass results, and attempts to promote hermetic evidence
to production. Generated local output must not be committed as universal performance evidence.
