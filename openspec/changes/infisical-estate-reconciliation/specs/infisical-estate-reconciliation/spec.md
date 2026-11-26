# Infisical estate reconciliation

## ADDED Requirements

### Requirement: Deterministic least-privilege planning

The system SHALL derive explicit per-host and per-repository secret-name allowlists from declared capability groups and repository evidence before decrypting or writing any value.

#### Scenario: Broad workstation profile

- **WHEN** the macOS developer-workstation profile is planned
- **THEN** it includes relevant development, deployment, observability, communication, and infrastructure credentials
- **AND** excludes unrelated personal, recovery, licensing, and destructive administration credentials unless separately evidenced.

### Requirement: Memory-only migration

The system SHALL decrypt only selected legacy values, pass them directly to an authenticated Infisical write operation, and avoid plaintext staging files and value-bearing logs.

#### Scenario: Selected value migration

- **WHEN** apply processes a selected encrypted template
- **THEN** the decrypted value is streamed directly to Infisical
- **AND** no plaintext staging file or value-bearing log is created.

### Requirement: Scoped identities

The system SHALL use repository-and-environment-bound GitHub OIDC identities for CI and independently revocable host identities for host access.

#### Scenario: GitHub production workflow

- **WHEN** a production workflow requests repository secrets
- **THEN** authentication uses claims bound to that repository and production environment.

### Requirement: Safe reconciliation

The system SHALL be idempotent, complete inventory before mutation, mask output, and perform no deletion, revocation, rotation, or permission widening outside the declared plan.

#### Scenario: Repeated reconciliation

- **WHEN** reconciliation is run again against unchanged desired state
- **THEN** it performs no destructive action and preserves the same scoped result.
