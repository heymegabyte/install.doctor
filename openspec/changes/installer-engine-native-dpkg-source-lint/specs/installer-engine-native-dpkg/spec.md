# Installer Engine native dpkg transaction

## ADDED Requirements

### Requirement: Native dpkg transaction source passes strict typed lint

The native dpkg transaction SHALL pass the standard Installer Engine strict source lint gate.

#### Scenario: Validate and execute an authorized transaction

- **WHEN** Installer Engine verifies namespace evidence or proceeds through an authorized dpkg transaction
- **THEN** descriptor validation, phase transitions, diagnostics, and cleanup follow the established contracts.
