# Spec Delta

## Purpose

Defines the sole mutation authority and transaction semantics for safe, resumable, renderer-neutral provisioning across supported host platforms.

## ADDED Requirements

### Requirement: Every managed effect is a typed operation
The engine SHALL admit only schema-valid operations with explicit preconditions, effects, postconditions, authority, lock domains, dependencies, timeout, cancellation, and recovery behavior.

#### Scenario: Model proposes untyped mutation
- **WHEN** a model, renderer, plugin, or caller submits text or shell outside an admitted typed operation
- **THEN** the engine rejects it before mutation and records a bounded denial

### Requirement: DAG execution preserves safety and progress
The engine SHALL execute ready independent nodes within resource limits, serialize shared mutation domains, block dependents after failure, and continue unrelated safe branches when policy permits.

#### Scenario: Parallel tasks share a package manager
- **WHEN** two ready operations require the same exclusive package-manager domain
- **THEN** no more than one mutates that domain while unrelated ready operations may proceed

### Requirement: Durable evidence controls resume
Every mutating run SHALL use content-addressed journals and single-owner leases; resume SHALL require exact released-uncommitted evidence for the same approved plan and observed host identity.

#### Scenario: Interrupted operation
- **WHEN** execution stops after mutation may have begun
- **THEN** a fresh apply refuses adoption and an explicit resume reconciles evidence before continuing

### Requirement: Configuration rollback is exact and bounded
Installer-owned configuration SHALL support reverse-dependency rollback of validated bytes, metadata, and supported service state; unsupported package, storage, network, operating-system, and external rollback SHALL be explicit before approval.

#### Scenario: Configuration changed concurrently
- **WHEN** a managed target differs from the post-activation evidence at rollback time
- **THEN** automatic rollback stops as ambiguous rather than overwriting the concurrent change

### Requirement: Offline execution remains authority-complete
An offline bundle SHALL contain a signed exact platform closure and SHALL execute with network denied without accepting new inference, provider, plan, artifact, or secret authority.

#### Scenario: Offline bundle has surplus artifact
- **WHEN** a bundle includes an artifact outside its signed selected closure
- **THEN** verification fails before materialization or execution
