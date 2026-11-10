# Tasks

## 1. Dependency and observed-state baseline

- [x] 1.1 Obtain the completed theme.tools `extract-portable-convergence-control-plane` artifact version, digest, runtime compatibility, migration evidence, and OnePrompt consumer receipt; block implementation on a mutable/source-only artifact.
- [x] 1.2 Re-inspect the current install.doctor worktree and confine edits to the OnePrompt supervisor utility, focused tests, and this change's evidence/docs; preserve every unrelated dirty path and the completed `provision-oneprompt-convergence-supervisor` artifacts.
- [ ] 1.3 Observe the live legacy and actual service identities, definitions, processes, repository revision, SQLite database, legacy files, and manager state read-only; record discrepancies without starting, stopping, adopting, or overwriting either identity.
- [ ] 1.4 Add failing disposable tests for artifact drift, duplicate labels/writers, most-restrictive legacy adoption, corrupt/unknown SQLite state, lifecycle ordering, stale settlement, and rollback recovery.

## 2. Shared-controller delegation

- [x] 2.1 Define and validate the OnePrompt machine-interface JSON contract used by the supervisor for controller install/inspect/pause/resume/stop/verify and manager observations; reject version, schema, repository, or artifact mismatches.
- [x] 2.2 Replace file-based desired-mode and heartbeat interpretation with calls to the shared-controller-backed machine interface and canonical `state.sqlite`; retain bounded logs only as diagnostics.
- [x] 2.3 Record and verify repository path/revision, machine-interface digest, shared package version/artifact digest, schema version, manager, logical identity, and rendered-definition digest before service admission.

## 3. Canonical service identity and lifecycle

- [x] 3.1 Render idempotent inert launchd and systemd definitions for logical identity `tools.theme.oneprompt.converge`, a minimal environment, the exact verified worker, and the canonical state directory; prove install makes no manager call and admits no worker.
- [x] 3.2 Implement pause and stop as SQLite-intent-first transitions followed by manager termination; implement start/resume with definition/artifact/state revalidation and no implicit clearing of durable stop intent.
- [x] 3.3 Implement status and verify output that distinguishes manager, worker, heartbeat, progress, checkpoint, blockers, budgets, migration/adoption, and artifact evidence without inferring health from logs.
- [x] 3.4 Preserve uninstall as an explicit operation that removes only adapter-managed definitions, retains stopped SQLite state and recovery evidence, and never deletes an unknown definition or article/application data.

## 4. Legacy adoption and rollback

- [x] 4.1 Implement a read-only adoption plan followed by an explicit adoption operation that rejects active/ambiguous writers and mismatched repositories before mutation.
- [x] 4.2 Create and verify a permission-safe recovery bundle, persist shared-controller stop intent, disable the adapter-managed legacy label, migrate SQLite through the shared adapter, and reconcile legacy files using `stopped > paused > running` without treating legacy heartbeat as current health.
- [x] 4.3 Atomically install the inactive canonical definition and record legacy retirement; prove duplicate retries are idempotent and cannot install or start a second writer.
- [x] 4.4 Implement and test rollback that stops/unloads the new identity, verifies no owner, restores the database/config/managed definition from the exact recovery bundle, and remains stopped pending explicit operator action.

## 5. Verification and handoff

- [x] 5.1 Run focused synthetic lifecycle tests on fake launchd and systemd, shared-controller conformance/migration fixtures, shell/static checks, permissions and secret scans, plus strict OpenSpec validation; preserve first failures and distinguish infrastructure from behavior.
- [x] 5.2 Inspect the diff and generated definitions for unrelated dirty changes, duplicate state authorities, copied package code, weak path validation, secret/environment leakage, auto-start behavior, unsafe deletion, and label drift.
- [x] 5.3 Produce a machine-readable cross-repository receipt tying install.doctor revision, theme.tools artifact digest, OnePrompt revision, state migration, service definition digest, test results, fresh/cached status, and rollback target.
- [ ] 5.4 Only when separately authorized, execute live adoption and one bounded start/stop/crash-recovery drill; otherwise record it as unverified and do not claim the background service is running.
