# Design: shared-controller OnePrompt supervisor adoption

**Architect:** codex
**Architect Role:** assigned

## Context

`home/dot_local/bin/executable_oneprompt-convergence-supervisor` currently owns portable launchd/systemd lifecycle under the legacy label `com.heymegabyte.oneprompt-convergence`. Desired state is represented by `pause` and `stop` files and health by a heartbeat file. The completed change intentionally did not adopt the live service because OnePrompt did not yet consume those files.

OnePrompt commit `d0144d3c3c10bf297fabd68ce82063838f0402ac` now has a repository-native controller using `$XDG_STATE_HOME/oneprompt-convergence/state.sqlite`, a worker, and service identity `tools.theme.oneprompt.converge`. The linked theme.tools change will replace its local controller/storage implementation with `@theme.tools/workflows/convergence` and the shared SQLite adapter. This change makes the host adapter follow that authority.

## Goals / Non-Goals

**Goals:**

- Ensure one installed service identity and one desired-state database per user.
- Preserve stop/pause intent, ownership epoch, attempt history, checkpoints, blockers, budgets, and rollback evidence.
- Keep launchd/systemd behavior portable, inert on install, and independently observable.
- Pin and verify the exact shared controller artifact and OnePrompt consumer revision.
- Preserve the existing supervisor's lifecycle UX while eliminating its duplicate state machine.

**Non-Goals:**

- Selecting convergence work or changing OnePrompt's prompt/check/deploy policy.
- Automatically starting, resuming, deploying, or publishing anything during chezmoi apply or `install`.
- Taking over an unknown operator-owned definition without explicit adoption.
- Solving distributed multi-host ownership.
- Reworking Desktop Tools, unrelated service units, or current dirty configuration files.

## Decisions

### 1. Keep install.doctor as the service-manager authority only

The supervisor continues to validate repository/controller paths, atomically render user launchd/systemd definitions, start/stop manager units, tail bounded logs, and report manager observation. It no longer interprets pause/stop/heartbeat files as authoritative state.

Desired-mode and controller status operations delegate to a versioned OnePrompt machine interface backed by `@theme.tools/workflows/convergence`. The interface accepts an explicit absolute state directory, returns schema-validated JSON, and supports install/inspect/pause/resume/stop/verify without rendering or controlling a service. This avoids installing a second controller implementation in install.doctor and ensures the repository worker and host supervisor share one artifact and database.

### 2. Standardize the real service identity

The canonical label/unit identity is `tools.theme.oneprompt.converge`. launchd uses `~/Library/LaunchAgents/tools.theme.oneprompt.converge.plist` and target `gui/<uid>/tools.theme.oneprompt.converge`. systemd uses a filesystem-safe corresponding unit name while recording `tools.theme.oneprompt.converge` as the logical identity in config and status.

The rendered command runs OnePrompt's bounded worker through its verified machine interface with the canonical state directory. Install remains inert: it writes configuration and definitions but neither loads nor starts them.

### 3. Pin the consumer and shared artifact

Installation records the canonical repository path, OnePrompt revision, machine-interface path and digest, shared package name/version/artifact digest, state schema compatibility, manager, and rendered-definition digest. `verify` recomputes these identities before start/resume and fails closed on drift. No package source is copied into install.doctor.

An intentional OnePrompt upgrade uses an explicit reinstall/upgrade path that validates state compatibility first. Mutable workspace links and unqualified `latest` artifacts are not accepted for a managed service.

### 4. Make legacy adoption explicit and most-restrictive

Ordinary `install` refuses if the legacy label, the new label, or legacy file intent exists outside matching adapter-managed metadata. `adopt` is a separate explicit operation:

1. Inspect both manager identities, processes, repository paths, definitions, SQLite state, and file intent without mutation.
2. Refuse if two writers are active, an owner lease is live, definitions target different repositories, or artifact/schema verification fails.
3. Persist stop intent to the shared database and stop/boot out any adapter-managed legacy definition before changing files.
4. Create a timestamped recovery bundle containing definitions, adapter config, legacy intent metadata, database copy/hash, and manager observations without secrets.
5. Migrate the database through the shared adapter. Reconcile file intent using `stopped > paused > running`; legacy files may make the result more restrictive but never resume a paused/stopped database. A legacy heartbeat is historical only and cannot establish current health.
6. Atomically install the new inactive definition and mark the legacy definition retired. Do not start until the operator explicitly invokes `resume` or `start`.

Unknown/operator-owned definitions remain untouched and block adoption with exact recovery instructions.

### 5. Use SQLite intent for every lifecycle transition

`pause` and `stop` first commit intent through the shared-controller interface, then ask the manager to terminate/unload the service. `resume` first verifies artifact, database, definition, and absence of a live competing owner, then commits running intent and starts the single canonical service. `start` does not silently clear paused/stopped intent.

Late workers remain fenced by ownership epoch and desired mode. Service-manager success cannot override a failed database transition, and a database transition followed by manager failure is reported as incomplete rather than rolled back into a misleading running state.

### 6. Merge status without conflating evidence

`status --json` combines controller status with a separately collected manager observation. It includes logical identity, configured repository and artifact identities, desired mode, supervisor state, worker liveness, heartbeat freshness, progress/checkpoint, epoch, blockers, budgets, next wake, and adoption/migration state. `healthy` is derived only when all required evidence agrees; missing or malformed SQLite/controller output is an error, not an idle state.

Logs remain diagnostic. Their existence, modification time, or contents never prove liveness or progress.

### 7. Preserve portable and least-privilege operation

State/config directories use mode `0700`; database, definitions, recovery manifests, and logs use the narrowest practical user permissions. Definitions contain a minimal allowlisted environment and no tokens. Repository and executable paths must be absolute, canonical, non-control-character paths. The service runs as the current user and does not gain root, network, production, or credential authority from installation.

### 8. Test in disposable homes and fake managers

Focused tests build a disposable OnePrompt fixture whose machine interface uses the shared controller conformance fixture. Fake launchctl/systemctl implementations record calls and simulated state. Tests must prove inert/idempotent install, single identity, most-restrictive adoption, unknown-definition refusal, pause/stop ordering, stale epoch fencing, crash recovery, status classification, permissions, artifact drift failure, rollback bundle integrity, and explicit uninstall behavior without touching the workstation's live service.

## Rollout

1. Complete and release theme.tools `extract-portable-convergence-control-plane`; record version/digest and consumer compatibility.
2. Update OnePrompt to the shared artifact and prove its v1 SQLite migration and thin machine interface.
3. Implement this change only in the supervisor utility, focused tests, and docs, preserving all unrelated install.doctor changes.
4. Run synthetic launchd/systemd lifecycle and adoption tests.
5. Inspect live state read-only and prepare an adoption plan/backup. Live adoption requires the existing authorized operator action and must verify no active writer.
6. Adopt to `tools.theme.oneprompt.converge`, leave it inactive, then explicitly start and run one bounded recovery drill when authorized.
7. Retain recovery evidence and the disabled legacy definition until rollback and restart verification pass.

## Rollback

Stop the new service through SQLite intent, unload its managed definition, verify no owner lease/process remains, restore the pre-adoption database and adapter config from the recovery bundle, and restore—but do not automatically start—the prior managed definition. Unknown operator-owned files are never removed or restored by automation. Rollback status must remain stopped until an explicit start.

## Open Questions

- The exact immutable shared package version and OnePrompt revision will be filled from the theme.tools release receipt; placeholders are not valid install inputs.
- Whether systemd's physical unit filename uses a direct label or escaped alias can follow current repository conventions, provided status records and duplicate detection use the single logical identity `tools.theme.oneprompt.converge`.
