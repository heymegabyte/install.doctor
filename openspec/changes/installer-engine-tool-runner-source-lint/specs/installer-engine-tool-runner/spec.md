# Installer Engine process runner and tool adapters

## ADDED Requirements

### Requirement: Process runner and typed tool adapter sources pass strict typed lint

Both modules SHALL pass the shared strict typed lint profile while preserving process cleanup, output redaction, and typed tool validation.

#### Scenario: Settle process and desktop tool operations

- **WHEN** a process exits, times out, or is cancelled, or a desktop tool validates an invocation
- **THEN** process settlement, output handling, and asynchronous tool results follow the existing contracts.
