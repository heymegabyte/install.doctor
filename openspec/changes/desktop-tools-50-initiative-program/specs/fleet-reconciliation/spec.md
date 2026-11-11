# Spec Delta

## Purpose

Defines durable, policy-bound reconciliation of enrolled hosts while preserving intentional exceptions, operator control, host usability, and honest state.

## ADDED Requirements

### Requirement: Reconciliation is desired-state and evidence driven
Each enrolled host SHALL reconcile a versioned desired state against observed facts through discover, validate, plan, approve, apply, verify, and status without creating duplicate identities, schedules, services, or effects.

#### Scenario: Unchanged second run
- **WHEN** desired state, release, policy, and observed postconditions are unchanged
- **THEN** reconciliation performs no mutation and emits a verified no-op receipt

### Requirement: Fleet scheduling respects host constraints
Reconciliation SHALL honor maintenance windows, power, connectivity, metered-network, resource pressure, workload criticality, and bounded catch-up policies.

#### Scenario: Mobile host misses maintenance
- **WHEN** a mobile host reconnects after several missed runs on metered power-constrained connectivity
- **THEN** it schedules bounded priority work rather than replaying the full backlog

### Requirement: Reboots are first-class operations
Required reboots SHALL be planned with user and workload coordination, restart-safe continuation, post-boot identity verification, and explicit rollback or recovery outcomes.

#### Scenario: Reboot does not return
- **WHEN** the host misses its bounded post-reboot heartbeat
- **THEN** the run remains pending or failed with recovery guidance and never reports the pre-reboot plan verified

### Requirement: Rollout is bounded by capacity and cost
The system SHALL forecast local capacity, remote storage, bandwidth, API operations, telemetry, model usage, and restoration cost before enabling sustained work or deleting recovery points.

#### Scenario: Low storage headroom
- **WHEN** forecast headroom crosses policy thresholds
- **THEN** new expensive work is deferred or narrowed without deleting the last usable recovery point
