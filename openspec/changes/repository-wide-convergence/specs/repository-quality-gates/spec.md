# Repository quality gates delta

## Purpose

Defines durable automated gates that prevent repository-wide correctness, provenance, hygiene, and generated-file drift from recurring.

## ADDED Requirements

### Requirement: Deterministic audit output

Repository audit output SHALL be schema-versioned, deterministically ordered, secret-free, and reproducible from tracked source.

#### Scenario: Repeated unchanged run

- **WHEN** the audit runs twice against the same Git tree and tool versions
- **THEN** its tracked-path dispositions are identical apart from explicitly volatile timestamps

### Requirement: Dirty-worktree preservation

Automated remediation SHALL distinguish pre-existing modifications and SHALL not overwrite unrelated user changes.

#### Scenario: Overlapping modified file

- **WHEN** a finding touches a file already modified by the user
- **THEN** the patch preserves compatible edits or records the overlap instead of resetting the file

### Requirement: Generated-file provenance

Generated artifacts SHALL identify a canonical generator and SHALL be verified by regeneration or an equivalent deterministic integrity check.

#### Scenario: Generated catalog drift

- **WHEN** source catalog data changes
- **THEN** the gate detects a committed generated catalog that was not regenerated
