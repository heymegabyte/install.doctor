# Installer Engine CLI command contracts

## ADDED Requirements

### Requirement: Installer Engine CLI source passes strict typed lint

The CLI SHALL pass the shared strict typed lint profile through the standard Installer Engine source lint gate.

#### Scenario: Parse and execute an existing invocation

- **WHEN** the CLI parses or delegates a supported invocation
- **THEN** validation, execution boundaries, delegated payloads, and command output follow the existing contracts.
