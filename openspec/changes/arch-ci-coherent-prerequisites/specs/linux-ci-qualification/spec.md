# Linux CI qualification

## ADDED Requirements

### Requirement: Arch prerequisites use a complete rolling upgrade

The Arch structural CI job SHALL install its smoke-test prerequisites in the same transaction as the repository refresh and full system upgrade.

#### Scenario: Base image packages precede the rolling repository snapshot

- **WHEN** the pinned Arch container prepares its smoke-test prerequisites
- **THEN** the package manager resolves those prerequisites and the installed system together with normal signature and dependency verification.
