# Installer Engine broker derivations

## ADDED Requirements

### Requirement: Broker derivation modules pass strict typed lint

The native package and service broker derivations SHALL pass the standard Installer Engine strict source lint gate.

#### Scenario: Derive broker authority from a selected task

- **WHEN** an approved plan is submitted for native package or service broker derivation
- **THEN** candidate selection, schema checks, and authority bindings follow the established contracts.
