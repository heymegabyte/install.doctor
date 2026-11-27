# Installer Engine broker trust validation

## ADDED Requirements

### Requirement: Broker trust validation passes strict typed lint

Release approval delegation and privileged broker authority validation SHALL pass the standard Installer Engine strict source lint gate.

#### Scenario: Validate a signed delegation or service operation triplet

- **WHEN** Installer Engine parses a release approval delegation or verifies native service authority
- **THEN** fixed schema constraints, dynamic authority bindings, and the canonical trust evidence follow the established contracts.
