# Repository convergence delta

## Purpose

Provides deterministic evidence that every tracked repository file was reviewed with an appropriate method and that justified improvements were applied safely.

## ADDED Requirements

### Requirement: Complete tracked-file accounting

The audit SHALL produce exactly one disposition record for every tracked file and SHALL fail on omitted, duplicated, or unclassified paths.

#### Scenario: Repository inventory changes

- **WHEN** a tracked path is added, moved, or removed
- **THEN** regeneration updates the ledger and validation rejects stale coverage

### Requirement: Class-appropriate inspection

The audit SHALL inspect source, generated, encrypted, binary, documentation, configuration, test, and sentinel files using validators appropriate to each class.

#### Scenario: Encrypted file

- **WHEN** an encrypted Ansible Vault file is audited
- **THEN** its envelope, permissions, and references are checked without decrypting its contents

#### Scenario: Binary asset

- **WHEN** a media asset is audited
- **THEN** type, decodability, size, duplication, and repository references are evaluated

### Requirement: Evidence-based remediation

The system SHALL apply high-confidence reversible improvements and SHALL record evidence-gated or approval-gated findings without silently changing them.

#### Scenario: Speculative improvement

- **WHEN** a proposed change lacks reliable evidence or requires an irreversible product decision
- **THEN** it is recorded with rationale rather than implemented

### Requirement: Convergence proof

The audit SHALL finish only after two consecutive complete finding passes produce no new actionable item above the configured value threshold.

#### Scenario: New finding during verification

- **WHEN** verification exposes a new qualifying defect
- **THEN** the defect is added to the active work and the convergence-pass count resets
