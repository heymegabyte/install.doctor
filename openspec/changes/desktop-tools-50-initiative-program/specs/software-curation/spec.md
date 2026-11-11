# Spec Delta

## MODIFIED Requirements

### Requirement: Explicit catalog eligibility

Every selectable item SHALL have a strict complete lifecycle recipe and SHALL be eligible for the detected platform, architecture, role, capability, support cell, dependency closure, load policy, authority, and consent. It SHALL NOT be deprecated, disabled, recipe-less, revoked, unverifiable, conflicting, or a public-listening service selected only by popularity.

#### Scenario: Automatic selection

- **WHEN** the automatic catalog is resolved for a host
- **THEN** opt-in, deprecated, incomplete, unsupported, conflicting, revoked, and unverifiable entries are excluded with machine-readable reasons

#### Scenario: Unknown catalog field

- **WHEN** a catalog entry contains an unknown or structurally invalid field
- **THEN** catalog generation fails before the entry can reach planning

### Requirement: Auditable popularity evidence

The repository SHALL provide a repeatable catalog audit that records metadata completeness, upstream identity, release freshness, GitHub stars when available, maintenance and security signals, AI and web capabilities, lifecycle completeness, support evidence, and a cohort-relative recommendation without making network results required for provisioning or allowing popularity to override safety.

#### Scenario: Offline audit

- **WHEN** the catalog audit runs without network access or a GitHub token
- **THEN** it emits complete local evidence and marks remote popularity and freshness unknown

#### Scenario: Popular option lacks verified recipe

- **WHEN** a highly starred tool lacks immutable provenance or target support evidence
- **THEN** the audit may recommend investigation but automatic provisioning cannot admit it

### Requirement: Tailscale retirement

New desired state SHALL NOT install or configure Tailscale. Existing running installations SHALL NOT be silently uninstalled, stopped, migrated, or treated as authorized network ingress.

#### Scenario: Existing Tailscale service

- **WHEN** provisioning finds an existing Tailscale installation
- **THEN** it records observed unmanaged state, leaves the live service unchanged, and does not select it again

### Requirement: Python tooling

uv SHALL be the default Python project, environment, package, and tool manager when its verified platform recipe applies. Poetry SHALL remain available only for explicit legacy compatibility and SHALL NOT create a competing default environment authority.

#### Scenario: Default Python tooling

- **WHEN** a developer profile is selected
- **THEN** uv is eligible and Poetry is not automatically selected

#### Scenario: Legacy Poetry project

- **WHEN** an explicit compatible project requires Poetry
- **THEN** planning may include Poetry without changing the fleet-wide default

## ADDED Requirements

### Requirement: Catalog lifecycle is verifiable
Every executable entry SHALL define deterministic detect, install, configure, update, verify, and uninstall behavior or explicitly declare an unsupported phase and its operational consequence.

#### Scenario: Update cannot be verified
- **WHEN** an update recipe cannot prove the installed identity and version
- **THEN** the operation remains unverified and cannot advance the host support receipt
