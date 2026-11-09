# Install Doctor installer engine

This package is the strict, renderer-neutral lifecycle core being introduced by OpenSpec task B03.

Implemented and tested:

- `discover → validate → plan → approve → apply → verify → record`
- deterministic normalized plan IDs and digests
- strict Zod validation at invocation, contract, plan, event, and receipt boundaries
- idempotent `check` before mutation and a read-only `status` path
- one canonical, gapless event stream consumed by plain, JSON, NDJSON, headless, CI, and passive TUI projections
- renderer-failure isolation
- shell-free, bounded argv operation execution through the headless CLI
- a deterministic self-contained Node.js 22+ bundle that runs without `node_modules`
- strict invocation-file ownership and group/other-write checks on POSIX
- protected content-addressed run directories with exclusive host ownership, fenced leases, immutable hash-chained journal generations, atomic file/directory synchronization, and real plan/journal/receipt evidence paths
- resumed-run postcondition revalidation and unchanged second-run mutation suppression
- signed, content-addressed offline bundle creation, verification, exact-closure planning, and atomic materialization
- Linux-only offline execution through Bubblewrap with a freshly proven isolated network namespace, live host attestation, durable journaling, cancellation, and explicit resume
- `rollback-config-plan`, `rollback-config-execute`, `rollback-config-resume`, and `rollback-config-status` commands that derive compensation only from committed install evidence, require exact approval, restore in reverse dependency order, and reject state-confused replay
- native systemd service-state rollback for strictly representable `enabled|disabled` and `active|inactive` states, using a root-owned non-writable `/usr/bin/systemctl`, fixed argv/environment, bounded output/time, and exact postcondition verification
- strict Desktop Tools lifecycle adapters whose model-facing inputs cannot select engine invocations, shell text, paths, plan bodies, locks, or journals; apply and configuration rollback require adapter-issued consent grants and deprovision remains preview-only

The engine is the canonical lifecycle owner for the production bootstrap. `scripts/provision.sh` builds and approves the exact normalized plan, then delegates selected package, service, file, directory, Chezmoi, installx, hook, and network operations to one engine run. The provisioner rejects an exit-zero engine process unless its committed evidence matches that approved run; installx is materialized by engine-owned operations and may execute only the selected package closure. The outer stage-zero receipt remains separate compatibility evidence and must not be treated as a substitute for the engine journal and receipt.

Run:

```bash
npm install
npm test
```

The CLI accepts a strict invocation file:

```bash
node dist/install-doctor-engine.mjs --input /absolute/path/to/invocation.json
```

Run invocations require an absolute `stateRoot`; the CLI creates protected evidence beneath it and refuses a competing live owner. Operations are argv arrays executed with `shell: false`. The CLI inherits only a small nonsecret environment allowlist and returns stable engine exit classes rather than arbitrary child exit codes.

CLI diagnostics are one bounded line on stderr; machine-readable query results and renderer output remain on stdout. Exit `2` is reserved for malformed invocations, `3` for a valid request rejected by current state or authority, `4` for integrity/evidence failure, `5` for pending reboot, `6` for pending verification, `7` for an execution failure before mutation is uncertain, `8` for a failure after mutation may have begun, and `130` for cancellation. Read-only queries use `1` for a successfully answered negative state. A fresh `run` never adopts durable uncommitted evidence: callers must select explicit `resume` with the same run identity and approved plan.

The current filesystem journal is a private-user backend. Privileged/system-wide cutover remains blocked on hardened platform backends that prove parent-component symlink/junction resistance, Windows ACL/reparse-point semantics, and exact native process identity; it must not be described as power-loss-complete or race-proof on every platform yet.

Offline execution is intentionally two-step. `bundle-apply` materializes only verified artifacts with `offline:true` and `networkPolicy:"deny"`; `bundle-execute` consumes that immutable materialization and requires exact manifest and plan approvals. After an interrupted execution, use `bundle-resume` with the same `runId`, bundle, materialized root, state root, trust input, and approvals. Resume is accepted only for released uncommitted evidence; absent, active, committed, or corrupt evidence fails closed. Execution commands do not accept a caller-supplied clock and are unavailable unless the current non-root Linux host can prove Bubblewrap network isolation and reproduce the signed semantic host facts.

Operation-manifest schema v5 binds each native package operation to its exact signed package name, version, and architecture. Read-only status uses that authority with the trusted fixed-path `dpkg-query` and Debian version comparator; it does not request broker authority or create transaction evidence. Earlier operation-manifest versions fail closed rather than being reinterpreted under the stronger package-status contract.

Offline execution has no provider, inference, endpoint, or model-recovery input. Its strict CLI schema rejects those fields, and cancellation or failure recovery is derived only from the signed plan plus durable journal evidence. A provider outage therefore cannot be converted into fabricated success or new mutation authority.

Configuration rollback is also plan-first. `rollback-config-plan` reads only a committed source run and returns the exact reversible installer-owned configuration closure. The caller approves only its digest: `rollback-config-execute` accepts no plan or compensation payload, reloads the source evidence, independently derives the plan, shares the host mutation lease, and requires absent rollback evidence. `rollback-config-resume` requires released-uncommitted evidence for the same derived plan. Caller-provided plans or compensation bytes and automatic package, operating-system, network, storage, or external rollback are not accepted. Systemd evidence is accepted only on Linux when a trusted native adapter is discovered before any mutation. Static, masked, indirect, generated, failed, activating, and other states are rejected because the v1 systemd snapshot cannot restore them exactly. On macOS, v2 launchd evidence must bind an enrolled system/gui/user domain, a still-identical safe plist with explicit `KeepAlive=false`, exact default/enabled/disabled override state, loaded state, and running/not-running activity. A default state is restored without ever creating an override and fails before mutation if an explicit override appeared concurrently; ambiguous, mixed-privilege, stale, or self-respawning definitions fail during preflight. Windows SCM and Windows file rollback remain explicitly unsupported and fail before mutation.

Portable Desktop Tools profiles have a separate bounded export command after building the
package: `node bin/desktop-tools-profile-export.mjs export --environment /absolute/ENVIRONMENT.md
--machine <id> --facts /absolute/facts.json --catalog /absolute/catalog.json
--release-manifest /absolute/manifest --release-signature /absolute/manifest.sig
--release-id <id> --signer-id <id> --signer-public-key /absolute/key.pub
--output /absolute/profile.json`. It creates the output exclusively as mode `0600`, authenticates
the bounded, current Desktop Tools release and derives exact catalog membership before resolving recipes, and never
exports source machine identities, service endpoints, or secret references. Standalone planning
re-verifies the same catalog, resolves the closure again, verifies every exported recipe digest,
and reconstructs its plan draft rather than accepting one from the export or caller.

## Planned behavior — not implemented yet

The following sections are the B04–B13 design target. They are not claims about the current package or production `/start` behavior.
