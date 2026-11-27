# Installer Engine broker storage

## ADDED Requirements

### Requirement: Broker storage passes strict typed lint

The broker storage module SHALL pass the standard Installer Engine strict source lint gate.

#### Scenario: Persist or retire broker authority

- **WHEN** Installer Engine writes, reads, or retires an approved grant and its authority
- **THEN** protected file access, nonce handling, and retirement follow the established contracts.
