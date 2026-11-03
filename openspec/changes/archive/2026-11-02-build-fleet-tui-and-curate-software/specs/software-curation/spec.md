# Software curation

## Purpose

Defines how Install Doctor selects, audits, replaces, and retires software without unsafe host mutation.

## ADDED Requirements

### Requirement: Explicit catalog eligibility

Every automatically selected item SHALL be eligible for the detected role and SHALL NOT be deprecated, disabled, recipe-less, or a public-listening service selected only by popularity.

#### Scenario: Automatic selection

- **WHEN** the automatic catalog is resolved for a host
- **THEN** opt-in and deprecated entries are excluded

### Requirement: Auditable popularity evidence

The repository SHALL provide a repeatable catalog audit that records metadata completeness, GitHub stars and freshness when available, AI/web capabilities, and a cohort-relative recommendation without making network results required for provisioning.

#### Scenario: Offline audit

- **WHEN** the catalog audit runs without a GitHub token
- **THEN** it emits complete local evidence and marks remote popularity unknown

### Requirement: Tailscale retirement

New desired state SHALL NOT install or configure Tailscale. Existing running installations SHALL NOT be silently uninstalled.

#### Scenario: Existing Tailscale service

- **WHEN** provisioning finds an existing Tailscale installation
- **THEN** it leaves the live service unchanged and does not select it again

### Requirement: Python tooling

uv SHALL be the default Python project/package tool. Poetry SHALL remain available only for explicit legacy compatibility.

#### Scenario: Default Python tooling

- **WHEN** a developer profile is selected
- **THEN** uv is eligible and Poetry is not automatically selected
