# Shared OnePrompt convergence-supervisor delta

## ADDED Requirements

### Requirement: one authoritative service and state authority

The host provisioner SHALL manage exactly one logical service identity, `tools.theme.oneprompt.converge`, and SHALL use the shared-controller-backed SQLite database as the only desired-mode and ownership authority.

#### Scenario: legacy and canonical definitions are both discovered

- **WHEN** install or start discovers both service identities without a completed verified adoption record
- **THEN** it fails closed, starts neither identity, and reports the exact conflicting definitions and observed processes

### Requirement: durable operator intent

Pause and stop SHALL be committed to canonical SQLite state before manager termination, and no automatic wake or stale worker SHALL override that intent.

#### Scenario: manager termination fails after stop intent

- **WHEN** stopped intent commits but the service manager cannot terminate the worker
- **THEN** status reports stopped intent plus incomplete manager enforcement and ownership fencing prevents late mutation settlement

### Requirement: independent health evidence

Status SHALL combine schema-validated shared-controller state and separately observed manager state, distinguishing supervisor liveness, worker liveness, heartbeat freshness, checkpoint progress, and artifact compatibility without using logs as health.

#### Scenario: active service with invalid database

- **WHEN** the manager reports active but SQLite state is corrupt or from an unknown future schema
- **THEN** status and verification fail closed and do not report healthy or idle convergence

### Requirement: portable supported service managers

The utility SHALL render inert user definitions for launchd and systemd using the logical identity `tools.theme.oneprompt.converge`, an exact verified worker, a minimal environment, and no secrets.

#### Scenario: repeated installation

- **WHEN** the same repository revision, controller artifact, state schema, and manager are installed repeatedly
- **THEN** definitions remain byte-stable and no service-manager start or worker admission occurs

### Requirement: synthetic lifecycle verification

Lifecycle and adoption tests SHALL use disposable homes, fake service managers, and shared-controller conformance fixtures and SHALL NOT mutate a live definition, process, or state database.

#### Scenario: isolated migration drill

- **WHEN** a legacy stopped fixture is adopted into a valid running SQLite fixture
- **THEN** the result remains stopped, one inactive canonical definition exists, recovery evidence is complete, and no fake manager start is recorded

### Requirement: immutable shared-controller compatibility

Installation and start SHALL verify the exact OnePrompt revision, machine-interface digest, shared package version/artifact digest, and supported state schema before admitting a worker.

#### Scenario: package artifact changes after installation

- **WHEN** the shared controller artifact digest differs from managed configuration
- **THEN** start and resume fail before service admission and status identifies artifact drift

### Requirement: explicit recoverable legacy adoption

Migration from `com.heymegabyte.oneprompt-convergence` and legacy intent files SHALL require an explicit operation, a verified no-writer boundary, a recovery bundle, and most-restrictive intent reconciliation.

#### Scenario: paused database with no legacy stop file

- **WHEN** adoption sees paused SQLite state and otherwise running legacy file intent
- **THEN** the canonical result remains paused and the legacy identity is retired without starting the new identity

### Requirement: safe rollback

Rollback SHALL stop and unload the canonical managed service, verify no current owner, restore exact backed-up state and managed definitions, and retain stopped intent until explicit restart.

#### Scenario: rollback after failed canonical start

- **WHEN** an authorized operator invokes rollback using a valid recovery bundle
- **THEN** the prior database and managed definition are restored, the canonical definition is inactive, and neither identity is started automatically
