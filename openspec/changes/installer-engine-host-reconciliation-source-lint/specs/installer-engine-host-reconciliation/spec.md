# Installer Engine host reconciliation

## ADDED Requirements

### Requirement: Host reconciliation source passes strict typed lint

Linux host facts, host reconciliation, staged drift repair, and immutable Linux deployment SHALL pass the shared strict typed lint profile while preserving their existing contracts.

#### Scenario: Assess a host and reconcile its desired state

- **WHEN** the Installer Engine reads Linux host facts or evaluates reconciliation leases, staged drift, or immutable deployment evidence
- **THEN** it applies the established input validation, ownership checks, ordering, and activation decisions.
