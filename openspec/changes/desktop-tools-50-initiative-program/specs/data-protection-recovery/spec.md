# Spec Delta

## Purpose

Defines workload-aware, encrypted, independently recoverable protection for ZFS and non-ZFS hosts with tested restoration and honest recovery objectives.

## ADDED Requirements

### Requirement: Protection maps authoritative data to recovery methods
Every database, VM, container volume, service configuration, user dataset, and required key SHALL have an explicit snapshot, replication, independent backup, verification, and restore disposition with justified inapplicability.

#### Scenario: New authoritative source appears
- **WHEN** inventory discovers authoritative data without an applicable recovery method
- **THEN** coverage becomes incomplete and cannot report healthy protection

### Requirement: ZFS protection preserves dependencies and encryption
Managed ZFS policies SHALL coordinate snapshots, pruning, scrubs, bookmarks, holds, clones, resumable transfers, common replication anchors, raw encrypted history, destination identity, and capacity thresholds.

#### Scenario: Prune would break replication
- **WHEN** a snapshot is required by a hold, clone, resume token, or common incremental history
- **THEN** policy pruning preserves it and reports the dependency

### Requirement: Independent backups remain independently recoverable
Critical data SHALL maintain an encrypted usable copy outside the source host failure domain without relying on the source, its local snapshots, or normal online secret access for restoration.

#### Scenario: Source and controller are unavailable
- **WHEN** a recovery drill removes source-host, controller, normal DNS, and operational secret-service access
- **THEN** the documented trusted bootstrap can restore the selected workload from independently held material

### Requirement: Verification proves client-side recovery
Protection verification SHALL include structural checks, rotating content checks, full checks on policy, and isolated representative restores that prove decryption and application behavior.

#### Scenario: Repository chunks verify but restore cannot decrypt
- **WHEN** server-side structure is sound but the client lacks valid recovery material
- **THEN** recovery status fails rather than treating structural verification as a usable backup
