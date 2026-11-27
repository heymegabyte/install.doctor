# Installer Engine broker contracts

## ADDED Requirements

### Requirement: Broker contract modules pass strict typed lint

The Installer Engine broker protocol and controller contract modules SHALL pass the regular strict source lint gate.

#### Scenario: Parse broker protocol and controller data

- **WHEN** Installer Engine validates broker timestamps or an optional revocation epoch
- **THEN** accepted values and validation diagnostics follow the established contract.
