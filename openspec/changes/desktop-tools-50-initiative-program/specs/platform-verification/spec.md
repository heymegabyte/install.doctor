# Spec Delta

## Purpose

Defines how Desktop Tools earns and retains platform support claims through reproducible fixtures, real-host canaries, adversarial testing, and fresh evidence.

## ADDED Requirements

### Requirement: Support cells require current lifecycle evidence
Each platform, architecture, version, role, and capability cell SHALL remain unverified until an independent trusted run proves fresh install, unchanged reapply, upgrade, interruption recovery, restart, and applicable rollback behavior.

#### Scenario: Evidence expires
- **WHEN** a verified cell exceeds its freshness policy or its bound implementation changes
- **THEN** the published cell becomes stale or unverified until requalified

### Requirement: Platform laboratories are disposable and representative
The test system SHALL create isolated fixtures for every claimed macOS, Linux, Windows, WSL, Proxmox, Qubes, immutable-OS, and container boundary without using production hosts as unbounded test targets.

#### Scenario: Platform is unavailable in automation
- **WHEN** a required real platform cannot be provisioned safely
- **THEN** its cell remains explicitly blocked rather than inferred from mocks or another OS

### Requirement: Fault injection covers mutation boundaries
Qualification SHALL inject process loss, reboot, storage exhaustion, network failure, corrupt artifacts, credential expiry, lock loss, clock skew, permission drift, and telemetry outage at applicable transaction boundaries.

#### Scenario: Failure after uncertain mutation
- **WHEN** an injected failure occurs after an effect may have begun
- **THEN** the engine reports uncertain mutation and proves safe explicit reconciliation or resume

### Requirement: Performance claims are measured
Published speed and scale claims SHALL derive from versioned benchmarks for bootstrap, planning, critical path, queue use, cold and warm operations, and host resources without weakening reliability or lock correctness.

#### Scenario: Optimization regresses safety
- **WHEN** a faster implementation violates an invariant or increases unbounded resource pressure
- **THEN** it is rejected regardless of benchmark improvement
